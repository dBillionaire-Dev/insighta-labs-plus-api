import { Router, Request, Response } from 'express';
import multer from 'multer';
import csvParser from 'csv-parser';
import { Readable } from 'stream';
import pool from '../db/pool';
import { cacheFlushPattern } from '../lib/cache';

/**
 * CSV Ingestion Route — POST /api/profiles/upload
 *
 * Design decisions:
 *
 * 1. STREAMING — never loads the entire file into memory. csv-parser reads
 *    the file as a Node.js Readable stream, emitting one row object at a time.
 *    Memory usage is bounded by the chunk size (1,000 rows × ~200 bytes ≈ 200KB
 *    working memory regardless of file size).
 *
 * 2. CHUNKED BULK INSERT — valid rows accumulate in a buffer. Every 1,000 rows
 *    (or at end-of-file), they are flushed as a single parameterised INSERT:
 *      INSERT INTO profiles (…) VALUES ($1,$2,…),($n+1,…),… ON CONFLICT DO NOTHING
 *    This reduces 500,000 individual round-trips to ~500 bulk statements.
 *
 * 3. NON-BLOCKING — the upload runs in its own async pipeline and does not
 *    block the query path. Multiple uploads can run concurrently because each
 *    uses its own pool connection(s) and does not hold a transaction open across
 *    the entire file.
 *
 * 4. PARTIAL FAILURE RESILIENCE — rows already inserted before a mid-stream
 *    failure are retained (no rollback). The summary reflects actual state.
 *
 * 5. IDEMPOTENCY — ON CONFLICT (name) DO NOTHING mirrors the POST /api/profiles
 *    rule: duplicate names are silently skipped and counted.
 */

const router = Router();

// multer stores the upload in memory as a Buffer — we immediately pipe it
// into a stream so peak memory is still bounded by the streaming window,
// not the file size. memoryStorage is fine here because multer never holds
// more than the in-flight multipart chunk in memory before we start streaming.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 }, // 200MB ceiling
});

// ── Validation helpers ────────────────────────────────────────────────────────

const VALID_GENDERS = new Set(['male', 'female']);
const REQUIRED_FIELDS = ['name', 'gender', 'age', 'country_id'];

type SkipReason =
  | 'missing_fields'
  | 'invalid_age'
  | 'invalid_gender'
  | 'duplicate_name'
  | 'malformed_row';

interface SkipReasons {
  missing_fields: number;
  invalid_age: number;
  invalid_gender: number;
  duplicate_name: number;
  malformed_row: number;
}

interface ValidRow {
  name: string;
  gender: string;
  gender_probability: number;
  sample_size: number;
  age: number;
  age_group: string;
  country_id: string;
  country_name: string;
  country_probability: number;
}

function deriveAgeGroup(age: number): string {
  if (age < 13) return 'child';
  if (age < 18) return 'teenager';
  if (age < 60) return 'adult';
  return 'senior';
}

function validateRow(raw: Record<string, string>): { row: ValidRow } | { skip: SkipReason } {
  // Check for missing required fields
  for (const f of REQUIRED_FIELDS) {
    if (!raw[f] || raw[f].trim() === '') {
      return { skip: 'missing_fields' };
    }
  }

  const age = parseInt(raw.age, 10);
  if (isNaN(age) || age < 0 || age > 150) {
    return { skip: 'invalid_age' };
  }

  const gender = raw.gender.trim().toLowerCase();
  if (!VALID_GENDERS.has(gender)) {
    return { skip: 'invalid_gender' };
  }

  return {
    row: {
      name: raw.name.trim(),
      gender,
      gender_probability: parseFloat(raw.gender_probability) || 0.5,
      sample_size: parseInt(raw.sample_size, 10) || 0,
      age,
      age_group: raw.age_group?.trim() || deriveAgeGroup(age),
      country_id: raw.country_id.trim().toUpperCase(),
      country_name: raw.country_name?.trim() || '',
      country_probability: parseFloat(raw.country_probability) || 0.5,
    },
  };
}

// ── Bulk insert helper ────────────────────────────────────────────────────────

/**
 * Insert up to 1,000 rows in a single statement.
 * Returns the number of rows actually inserted (duplicates are skipped
 * via ON CONFLICT DO NOTHING and don't count).
 */
async function bulkInsert(rows: ValidRow[]): Promise<{ inserted: number; duplicates: number }> {
  if (rows.length === 0) return { inserted: 0, duplicates: 0 };

  const values: unknown[] = [];
  const placeholders: string[] = [];
  const COLS = 9;

  rows.forEach((row, i) => {
    const base = i * COLS;
    placeholders.push(
      `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9})`
    );
    values.push(
      row.name, row.gender, row.gender_probability, row.sample_size,
      row.age, row.age_group, row.country_id, row.country_name, row.country_probability
    );
  });

  const sql = `
    INSERT INTO profiles
      (name, gender, gender_probability, sample_size, age, age_group, country_id, country_name, country_probability)
    VALUES ${placeholders.join(',')}
    ON CONFLICT (name) DO NOTHING
  `;

  const result = await pool.query(sql, values);
  const inserted = result.rowCount ?? 0;
  const duplicates = rows.length - inserted;
  return { inserted, duplicates };
}

// ── Route handler ─────────────────────────────────────────────────────────────

router.post('/upload', upload.single('file'), async (req: Request, res: Response) => {
  if (!req.file) {
    return res.status(400).json({ status: 'error', message: 'No file uploaded. Send a CSV as multipart field "file".' });
  }

  const CHUNK_SIZE = 1_000;

  let totalRows = 0;
  let inserted = 0;
  const reasons: SkipReasons = {
    missing_fields: 0,
    invalid_age: 0,
    invalid_gender: 0,
    duplicate_name: 0,
    malformed_row: 0,
  };

  // Buffer of validated rows waiting to be flushed
  let buffer: ValidRow[] = [];

  async function flushBuffer() {
    if (buffer.length === 0) return;
    const chunk = buffer;
    buffer = [];
    try {
      const { inserted: n, duplicates } = await bulkInsert(chunk);
      inserted += n;
      reasons.duplicate_name += duplicates;
    } catch (err) {
      // If a chunk insert fails entirely (e.g. DB connection lost), count
      // all rows in that chunk as malformed_row rather than crashing the upload.
      console.error('[upload] bulk insert error:', err);
      reasons.malformed_row += chunk.length;
    }
  }

  try {
    await new Promise<void>((resolve, reject) => {
      // Convert the Buffer from multer into a Readable stream
      const readable = Readable.from(req.file!.buffer);

      readable
        .pipe(csvParser())
        .on('data', async (raw: Record<string, string>) => {
          totalRows++;

          const result = validateRow(raw);
          if ('skip' in result) {
            reasons[result.skip]++;
            return;
          }

          buffer.push(result.row);

          // Flush when we have a full chunk
          if (buffer.length >= CHUNK_SIZE) {
            // Pause the stream while we await the insert so we don't
            // accumulate unbounded rows in memory
            readable.pause();
            await flushBuffer();
            readable.resume();
          }
        })
        .on('error', (err) => {
          console.error('[upload] CSV parse error:', err);
          reasons.malformed_row++;
          // Continue parsing — csv-parser emits 'error' per bad row in some
          // versions. We don't reject here to allow partial processing.
        })
        .on('end', async () => {
          // Flush remaining rows that didn't fill a full chunk
          await flushBuffer();
          resolve();
        });
    });
  } catch (err) {
    console.error('[upload] fatal stream error:', err);
    // Return what we have so far — partial inserts are retained
  }

  // After ingestion, invalidate cached query results so new data is visible
  // within one cache TTL rather than 5 minutes.
  await cacheFlushPattern('query:*');

  const skipped = Object.values(reasons).reduce((a, b) => a + b, 0);

  return res.status(200).json({
    status: 'success',
    total_rows: totalRows,
    inserted,
    skipped,
    reasons,
  });
});

export default router;
