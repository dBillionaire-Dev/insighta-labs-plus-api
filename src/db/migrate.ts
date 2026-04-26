import { pool } from "./pool";

async function migrate() {
    const client = await pool.connect();
    try {
        // Create table with full Stage 2 schema
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

        await client.query(`
      ALTER TABLE profiles ADD COLUMN IF NOT EXISTS country_name VARCHAR;
    `);

        // Indexes for filtering and sorting performance
        await client.query(`CREATE INDEX IF NOT EXISTS idx_profiles_gender ON profiles(gender);`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_profiles_age ON profiles(age);`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_profiles_age_group ON profiles(age_group);`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_profiles_country_id ON profiles(country_id);`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_profiles_created_at ON profiles(created_at);`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_profiles_gender_probability ON profiles(gender_probability);`);

        console.log("Migration complete: profiles table ready.");
    } finally {
        client.release();
        await pool.end();
    }
}

migrate().catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
});