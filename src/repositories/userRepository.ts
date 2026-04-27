import { pool } from "../db/pool";
import { User } from "../types";

export async function findUserByGithubId(githubId: string): Promise<User | null> {
    const res = await pool.query<User>(
        "SELECT * FROM users WHERE github_id = $1",
        [githubId]
    );
    return res.rows[0] ?? null;
}

export async function findUserById(id: string): Promise<User | null> {
    const res = await pool.query<User>(
        "SELECT * FROM users WHERE id = $1",
        [id]
    );
    return res.rows[0] ?? null;
}

export async function createUser(data: {
    id: string;
    github_id: string;
    username: string;
    email: string | null;
    avatar_url: string | null;
}): Promise<User> {
    const res = await pool.query<User>(
        `INSERT INTO users (id, github_id, username, email, avatar_url, role, is_active, last_login_at, created_at)
     VALUES ($1, $2, $3, $4, $5, 'analyst', true, NOW(), NOW())
     RETURNING *`,
        [data.id, data.github_id, data.username, data.email, data.avatar_url]
    );
    return res.rows[0];
}

export async function updateUserLogin(id: string): Promise<void> {
    await pool.query(
        "UPDATE users SET last_login_at = NOW() WHERE id = $1",
        [id]
    );
}

export async function upsertUser(data: {
    id: string;
    github_id: string;
    username: string;
    email: string | null;
    avatar_url: string | null;
}): Promise<User> {
    const res = await pool.query<User>(
        `INSERT INTO users (id, github_id, username, email, avatar_url, role, is_active, last_login_at, created_at)
     VALUES ($1, $2, $3, $4, $5, 'analyst', true, NOW(), NOW())
     ON CONFLICT (github_id) DO UPDATE SET
       username = EXCLUDED.username,
       email = EXCLUDED.email,
       avatar_url = EXCLUDED.avatar_url,
       last_login_at = NOW()
     RETURNING *`,
        [data.id, data.github_id, data.username, data.email, data.avatar_url]
    );
    return res.rows[0];
}

// ── Refresh tokens ────────────────────────────────────────────────────────────
export async function saveRefreshToken(data: {
    id: string;
    user_id: string;
    token: string;
    expires_at: Date;
}): Promise<void> {
    await pool.query(
        `INSERT INTO refresh_tokens (id, user_id, token, expires_at)
     VALUES ($1, $2, $3, $4)`,
        [data.id, data.user_id, data.token, data.expires_at]
    );
}

export async function findRefreshToken(token: string): Promise<{
    id: string;
    user_id: string;
    expires_at: Date;
} | null> {
    const res = await pool.query(
        `SELECT id, user_id, expires_at FROM refresh_tokens WHERE token = $1`,
        [token]
    );
    return res.rows[0] ?? null;
}

export async function deleteRefreshToken(token: string): Promise<void> {
    await pool.query("DELETE FROM refresh_tokens WHERE token = $1", [token]);
}

export async function deleteAllUserRefreshTokens(userId: string): Promise<void> {
    await pool.query("DELETE FROM refresh_tokens WHERE user_id = $1", [userId]);
}