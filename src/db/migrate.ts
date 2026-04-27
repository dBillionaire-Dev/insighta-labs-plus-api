import { pool } from "./pool";

async function migrate() {
    const client = await pool.connect();
    try {
        // ── Profiles table ────────────────────────────────────────────────────────
        await client.query(`
            CREATE TABLE IF NOT EXISTS profiles (
                                                    id                  TEXT PRIMARY KEY,
                                                    name                VARCHAR NOT NULL UNIQUE,
                                                    gender              VARCHAR,
                                                    gender_probability  FLOAT,
                                                    sample_size         INTEGER,
                                                    age                 INTEGER,
                                                    age_group           VARCHAR,
                                                    country_id          VARCHAR(2),
                                                    country_name        VARCHAR,
                                                    country_probability FLOAT,
                                                    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        `);
        await client.query(`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS country_name VARCHAR;`);

        // Indexes for performance
        await client.query(`CREATE INDEX IF NOT EXISTS idx_profiles_gender ON profiles(gender);`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_profiles_age ON profiles(age);`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_profiles_age_group ON profiles(age_group);`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_profiles_country_id ON profiles(country_id);`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_profiles_created_at ON profiles(created_at);`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_profiles_gender_probability ON profiles(gender_probability);`);

        // ── Users table ───────────────────────────────────────────────────────────
        await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id              TEXT PRIMARY KEY,
        github_id       VARCHAR NOT NULL UNIQUE,
        username        VARCHAR NOT NULL,
        email           VARCHAR,
        avatar_url      VARCHAR,
        role            VARCHAR NOT NULL DEFAULT 'analyst',
        is_active       BOOLEAN NOT NULL DEFAULT true,
        last_login_at   TIMESTAMPTZ,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

        // ── Refresh tokens table ──────────────────────────────────────────────────
        await client.query(`
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id          TEXT PRIMARY KEY,
        user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token       TEXT NOT NULL UNIQUE,
        expires_at  TIMESTAMPTZ NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

        await client.query(`CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token ON refresh_tokens(token);`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_users_github_id ON users(github_id);`);

        console.log("Migration complete: all tables ready.");
    } finally {
        client.release();
        await pool.end();
    }
}

migrate().catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
});