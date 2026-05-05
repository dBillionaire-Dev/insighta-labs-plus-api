/**
 * Query Normaliser
 *
 * Problem: "Nigerian females between ages 20 and 45" and
 * "Women aged 20–45 living in Nigeria" produce the same parsed filters
 * but different cache keys if we just JSON.stringify the raw query string
 * or the un-normalised filter object.
 *
 * Solution: Before checking the cache, canonicalise the filter object
 * into a deterministic form, then serialise it. Two queries with the same
 * intent will always produce the same cache key.
 *
 * Rules:
 *  1. Keep only keys that are actually set (skip undefined/null)
 *  2. Sort keys alphabetically
 *  3. Lowercase all string values
 *  4. Ensure numeric values are numbers (not strings) — params come in as
 *     query strings so coerce them
 *  5. Prefix the key so it never collides with other Redis keys
 */

export interface ProfileFilters {
  gender?: string;
  age_group?: string;
  country_id?: string;
  min_age?: number | string;
  max_age?: number | string;
  min_gender_probability?: number | string;
  min_country_probability?: number | string;
  sort_by?: string;
  order?: string;
  page?: number | string;
  limit?: number | string;
  // search query (natural language path)
  q?: string;
}

type NormalisedFilters = Record<string, string | number>;

/**
 * Normalise a filter object into a canonical form and return a cache key.
 *
 * @example
 * normaliseToCacheKey({ gender: 'Female', country_id: 'NG', min_age: '20' })
 * // → 'query:{"country_id":"ng","gender":"female","min_age":20}'
 */
export function normaliseToCacheKey(filters: ProfileFilters): string {
  const numeric = new Set([
    'min_age', 'max_age', 'min_gender_probability',
    'min_country_probability', 'page', 'limit',
  ]);

  const normalised: NormalisedFilters = {};

  for (const [key, value] of Object.entries(filters)) {
    // Skip empty / undefined values
    if (value === undefined || value === null || value === '') continue;

    if (numeric.has(key)) {
      const n = Number(value);
      if (!isNaN(n)) normalised[key] = n;
    } else {
      // Lowercase all string values so 'Female' === 'female' === 'FEMALE'
      normalised[key] = String(value).toLowerCase().trim();
    }
  }

  // Sort keys alphabetically so insertion order doesn't affect the key
  const sorted: NormalisedFilters = {};
  for (const key of Object.keys(normalised).sort()) {
    sorted[key] = normalised[key];
  }

  return `query:${JSON.stringify(sorted)}`;
}
