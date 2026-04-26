import { pool } from "./pool";
import { uuidv7 } from "uuidv7";
import seedData from "./seed_profiles.json";

async function seed(): Promise<void> {
    const client = await pool.connect();
    try {
        const profiles = seedData.profiles;
        console.log(`Seeding ${profiles.length} profiles...`);

        let inserted: number = 0;
        let skipped: number = 0;

        for (const profile of profiles) {
            const result = await client.query(
                `INSERT INTO profiles
          (id, name, gender, gender_probability, age, age_group, country_id, country_name, country_probability, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
         ON CONFLICT (name) DO NOTHING`,
                [
                    uuidv7(),
                    profile.name,
                    profile.gender,
                    profile.gender_probability,
                    profile.age,
                    profile.age_group,
                    profile.country_id,
                    profile.country_name,
                    profile.country_probability,
                ]
            );
            if ((result.rowCount ?? 0) > 0) {
                inserted++;
            } else {
                skipped++;
            }
        }

        console.log(`Seed complete: ${inserted} inserted, ${skipped} skipped (duplicates).`);
    } finally {
        client.release();
        await pool.end();
    }
}

seed().catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
});