import { pool } from "../db/pool";
import { Profile, ProfileFilters, PaginatedResult } from "../types";

export async function findProfileByName(name: string): Promise<Profile | null> {
    const res = await pool.query<Profile>(
        "SELECT * FROM profiles WHERE LOWER(name) = LOWER($1)",
        [name]
    );
    return res.rows[0] ?? null;
}

export async function findProfileById(id: string): Promise<Profile | null> {
    const res = await pool.query<Profile>(
        "SELECT * FROM profiles WHERE id = $1",
        [id]
    );
    return res.rows[0] ?? null;
}

export async function findProfiles(filters: ProfileFilters): Promise<PaginatedResult> {
    const conditions: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (filters.gender) {
        conditions.push(`LOWER(gender) = LOWER($${idx++})`);
        values.push(filters.gender);
    }
    if (filters.country_id) {
        conditions.push(`LOWER(country_id) = LOWER($${idx++})`);
        values.push(filters.country_id);
    }
    if (filters.age_group) {
        conditions.push(`LOWER(age_group) = LOWER($${idx++})`);
        values.push(filters.age_group);
    }
    if (filters.min_age !== undefined) {
        conditions.push(`age >= $${idx++}`);
        values.push(filters.min_age);
    }
    if (filters.max_age !== undefined) {
        conditions.push(`age <= $${idx++}`);
        values.push(filters.max_age);
    }
    if (filters.min_gender_probability !== undefined) {
        conditions.push(`gender_probability >= $${idx++}`);
        values.push(filters.min_gender_probability);
    }
    if (filters.min_country_probability !== undefined) {
        conditions.push(`country_probability >= $${idx++}`);
        values.push(filters.min_country_probability);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    // Sorting
    const allowedSortFields = ["age", "created_at", "gender_probability"];
    const sortBy = filters.sort_by && allowedSortFields.includes(filters.sort_by)
        ? filters.sort_by
        : "created_at";
    const order = filters.order === "asc" ? "ASC" : "DESC";

    // Pagination
    const page = Math.max(1, filters.page ?? 1);
    const limit = Math.min(50, Math.max(1, filters.limit ?? 10));
    const offset = (page - 1) * limit;

    // Count query
    const countRes = await pool.query(
        `SELECT COUNT(*) FROM profiles ${where}`,
        values
    );
    const total = parseInt(countRes.rows[0].count);

    // Data query
    const dataRes = await pool.query<Profile>(
        `SELECT * FROM profiles ${where}
     ORDER BY ${sortBy} ${order}
     LIMIT $${idx++} OFFSET $${idx++}`,
        [...values, limit, offset]
    );

    return {
        data: dataRes.rows,
        total,
        page,
        limit,
    };
}

export async function insertProfile(
    id: string,
    name: string,
    data: {
        gender: string;
        gender_probability: number;
        sample_size: number;
        age: number;
        age_group: string;
        country_id: string;
        country_name?: string;
        country_probability: number;
    }
): Promise<Profile> {
    const res = await pool.query<Profile>(
        `INSERT INTO profiles
         (id, name, gender, gender_probability, sample_size, age, age_group, country_id, country_name, country_probability, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
         RETURNING *`,
        [
            id,
            name,
            data.gender,
            data.gender_probability,
            data.sample_size,
            data.age,
            data.age_group,
            data.country_id,
            data.country_name ?? null,
            data.country_probability,
        ]
    );
    return res.rows[0];
}

export async function deleteProfileById(id: string): Promise<boolean> {
    const res = await pool.query("DELETE FROM profiles WHERE id = $1", [id]);
    return (res.rowCount ?? 0) > 0;
}