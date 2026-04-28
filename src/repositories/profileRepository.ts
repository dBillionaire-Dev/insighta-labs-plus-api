import { pool } from "../db/pool";
import { Profile, ProfileFilters, PaginatedResult } from "../types";
import { buildProfileFilters } from "./buildProfileFilters";

const SELECT_FIELDS = `
id,
name,
gender,
gender_probability,
sample_size,
age,
age_group,
country_id,
country_name,
country_probability,
created_at
`;

// Find profile by name (case-insensitive but index-friendly)
export async function findProfileByName(name: string): Promise<Profile | null> {
    const normalized = name.toLowerCase();

    const res = await pool.query<Profile>(
        `SELECT ${SELECT_FIELDS} FROM profiles WHERE name = $1`,
        [normalized]
    );

    return res.rows[0] ?? null;
}

// Find profile by ID
export async function findProfileById(id: string): Promise<Profile | null> {
    const res = await pool.query<Profile>(
        `SELECT ${SELECT_FIELDS} FROM profiles WHERE id = $1`,
        [id]
    );

    return res.rows[0] ?? null;
}

// Get paginated profiles with filters, sorting, and pagination
export async function findProfiles(
    filters: ProfileFilters
): Promise<PaginatedResult> {
    const { where, values } = buildProfileFilters(filters);

    const allowedSortFields = [
        "age",
        "created_at",
        "gender_probability"
    ];

    const sortBy =
        filters.sort_by && allowedSortFields.includes(filters.sort_by)
            ? filters.sort_by
            : "created_at";

    const order = filters.order === "asc" ? "ASC" : "DESC";

    const page = Math.max(1, filters.page ?? 1);
    const limit = Math.min(50, Math.max(1, filters.limit ?? 10));
    const offset = (page - 1) * limit;

    // Total count query
    const countRes = await pool.query(
        `SELECT COUNT(*) FROM profiles ${where}`,
        values
    );

    const total = parseInt(countRes.rows[0].count, 10);
    const total_pages = Math.ceil(total / limit);

    // Data query
    const dataRes = await pool.query<Profile>(
        `
            SELECT ${SELECT_FIELDS}
            FROM profiles
                     ${where}
            ORDER BY ${sortBy} ${order}
            LIMIT $${values.length + 1}
            OFFSET $${values.length + 2}
        `,
        [...values, limit, offset]
    );

    return {
        data: dataRes.rows,
        total,
        total_pages,
        page,
        limit
    };
}

// Insert a new profile
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
        `
            INSERT INTO profiles (
                id,
                name,
                gender,
                gender_probability,
                sample_size,
                age,
                age_group,
                country_id,
                country_name,
                country_probability,
                created_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
            RETURNING ${SELECT_FIELDS}
        `,
        [
            id,
            name.toLowerCase(),
            data.gender.toLowerCase(),
            data.gender_probability,
            data.sample_size,
            data.age,
            data.age_group.toLowerCase(),
            data.country_id.toLowerCase(),
            data.country_name?.toLowerCase() ?? null,
            data.country_probability
        ]
    );

    return res.rows[0];
}

// Delete profile by ID
export async function deleteProfileById(id: string): Promise<boolean> {
    const res = await pool.query(
        "DELETE FROM profiles WHERE id = $1",
        [id]
    );

    return (res.rowCount ?? 0) > 0;
}

// Export profiles (no pagination)
export async function findProfilesForExport(
    filters: ProfileFilters
): Promise<Profile[]> {
    const { where, values } = buildProfileFilters(filters);

    const res = await pool.query<Profile>(
        `
            SELECT ${SELECT_FIELDS}
            FROM profiles
                     ${where}
            ORDER BY created_at DESC
        `,
        values
    );

    return res.rows;
}