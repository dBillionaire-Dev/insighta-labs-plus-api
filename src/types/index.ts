// ── Profile ───
export interface Profile {
    id: string;
    name: string;
    gender: string | null;
    gender_probability: number | null;
    sample_size: number | null;
    age: number | null;
    age_group: string | null;
    country_id: string | null;
    country_name: string | null;
    country_probability: number | null;
    created_at: string;
}

export interface GenderizeResponse {
    name: string;
    gender: string | null;
    probability: number;
    count: number;
}

export interface AgifyResponse {
    name: string;
    age: number | null;
    count: number;
}

export interface NationalizeResponse {
    name: string;
    country: Array<{ country_id: string; probability: number }>;
}

export interface AggregatedData {
    gender: string;
    gender_probability: number;
    sample_size: number;
    age: number;
    age_group: string;
    country_id: string;
    country_probability: number;
}

export interface ProfileFilters {
    gender?: string;
    country_id?: string;
    age_group?: string;
    min_age?: number;
    max_age?: number;
    min_gender_probability?: number;
    min_country_probability?: number;
    sort_by?: "age" | "created_at" | "gender_probability";
    order?: "asc" | "desc";
    page?: number;
    limit?: number;
}

export interface PaginatedResult {
    data: Profile[];
    total: number;
    total_pages: number;
    page: number;
    limit: number;
}

// ── User ──
export type UserRole = "user" | "admin" | "analyst";

export interface User {
    id: string;
    github_id: string;
    username: string;
    email: string | null;
    avatar_url: string | null;
    role: UserRole;
    is_active: boolean;
    last_login_at: string | null;
    created_at: string;
}

export interface TokenPayload {
    sub: string;       // user id
    username: string;
    role: UserRole;
    iat?: number;
    exp?: number;
}

// ── Express augmentation ───
declare global {
    namespace Express {
        interface Request {
            user?: User;
        }
    }
}