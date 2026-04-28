import { ProfileFilters } from "../types";

export function buildProfileFilters(filters: ProfileFilters) {
    const conditions: string[] = [];
    const values: (string | number | null)[] = [];
    let idx = 1;

    if (filters.gender) {
        conditions.push(`gender = $${idx++}`);
        values.push(filters.gender.toLowerCase());
    }

    if (filters.country_id) {
        conditions.push(`country_id = $${idx++}`);
        values.push(filters.country_id.toLowerCase());
    }

    if (filters.age_group) {
        conditions.push(`age_group = $${idx++}`);
        values.push(filters.age_group.toLowerCase());
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

    return {
        where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "",
        values,
        nextIndex: idx
    };
}