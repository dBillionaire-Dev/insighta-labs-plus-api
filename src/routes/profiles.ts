import { Router, Request, Response } from "express";
import { uuidv7 } from "uuidv7";
import { aggregateName, ExternalApiError } from "../services/aggregator";
import {
    findProfileByName,
    findProfileById,
    findProfiles,
    insertProfile,
    deleteProfileById,
} from "../repositories/profileRepository";
import { parseNaturalLanguageQuery } from "../services/nlpParser";
import { ProfileFilters } from "../types";

const router = Router();

// ─── Helper: parse pagination + sort from query ───
function parsePaginationAndSort(query: any): Partial<ProfileFilters> {
    const result: Partial<ProfileFilters> = {};

    if (query.sort_by) {
        const allowed = ["age", "created_at", "gender_probability"];
        if (!allowed.includes(query.sort_by)) {
            throw new Error("Invalid sort_by value. Use: age, created_at, gender_probability");
        }
        result.sort_by = query.sort_by;
    }

    if (query.order) {
        if (!["asc", "desc"].includes(query.order)) {
            throw new Error("Invalid order value. Use: asc, desc");
        }
        result.order = query.order;
    }

    if (query.page !== undefined) {
        const page = parseInt(query.page);
        if (isNaN(page) || page < 1) throw new Error("page must be a positive integer");
        result.page = page;
    }

    if (query.limit !== undefined) {
        const limit = parseInt(query.limit);
        if (isNaN(limit) || limit < 1 || limit > 50) throw new Error("limit must be between 1 and 50");
        result.limit = limit;
    }

    return result;
}

// ─── GET /api/profiles/search ───
// Must be registered BEFORE /:id to avoid route collision
router.get("/search", async (req: Request, res: Response): Promise<void> => {
    const { q } = req.query;

    if (!q || typeof q !== "string" || q.trim() === "") {
        res.status(400).json({ status: "error", message: "Missing or empty query parameter: q" });
        return;
    }

    try {
        const parsed = parseNaturalLanguageQuery(q as string);

        if (!parsed.interpreted) {
            res.status(422).json({ status: "error", message: "Unable to interpret query" });
            return;
        }

        // Apply pagination/sort from query string too
        const pagination = parsePaginationAndSort(req.query);
        const filters: ProfileFilters = { ...parsed, ...pagination };

        const result = await findProfiles(filters);

        res.status(200).json({
            status: "success",
            page: result.page,
            limit: result.limit,
            total: result.total,
            data: result.data.map(formatProfile),
        });
    } catch (err: any) {
        if (err.message?.includes("Invalid")) {
            res.status(400).json({ status: "error", message: err.message });
            return;
        }
        console.error(err);
        res.status(500).json({ status: "error", message: "Internal server error" });
    }
});

// ─── POST /api/profiles ───
router.post("/", async (req: Request, res: Response): Promise<void> => {
    const { name } = req.body;

    if (name === undefined || name === null || name === "") {
        res.status(400).json({ status: "error", message: "Missing or empty name" });
        return;
    }
    if (typeof name !== "string") {
        res.status(422).json({ status: "error", message: "name must be a string" });
        return;
    }

    const trimmedName = name.trim();
    if (trimmedName === "") {
        res.status(400).json({ status: "error", message: "Missing or empty name" });
        return;
    }

    try {
        const existing = await findProfileByName(trimmedName);
        if (existing) {
            res.status(200).json({
                status: "success",
                message: "Profile already exists",
                data: formatProfile(existing),
            });
            return;
        }

        const aggregated = await aggregateName(trimmedName);
        const id = uuidv7();
        const profile = await insertProfile(id, trimmedName, aggregated);

        res.status(201).json({
            status: "success",
            data: formatProfile(profile),
        });
    } catch (err) {
        if (err instanceof ExternalApiError) {
            res.status(502).json({ status: "502", message: err.message });
            return;
        }
        console.error(err);
        res.status(500).json({ status: "error", message: "Internal server error" });
    }
});

// ─── GET /api/profiles ───
router.get("/", async (req: Request, res: Response): Promise<void> => {
    try {
        const pagination = parsePaginationAndSort(req.query);

        // Validate numeric filters
        const numericFields = ["min_age", "max_age", "min_gender_probability", "min_country_probability"];
        for (const field of numericFields) {
            if (req.query[field] !== undefined) {
                const val = parseFloat(req.query[field] as string);
                if (isNaN(val)) {
                    res.status(422).json({ status: "error", message: `${field} must be a number` });
                    return;
                }
            }
        }

        const filters: ProfileFilters = {
            gender: req.query.gender as string | undefined,
            country_id: req.query.country_id as string | undefined,
            age_group: req.query.age_group as string | undefined,
            min_age: req.query.min_age ? parseFloat(req.query.min_age as string) : undefined,
            max_age: req.query.max_age ? parseFloat(req.query.max_age as string) : undefined,
            min_gender_probability: req.query.min_gender_probability
                ? parseFloat(req.query.min_gender_probability as string)
                : undefined,
            min_country_probability: req.query.min_country_probability
                ? parseFloat(req.query.min_country_probability as string)
                : undefined,
            ...pagination,
        };

        const result = await findProfiles(filters);

        res.status(200).json({
            status: "success",
            page: result.page,
            limit: result.limit,
            total: result.total,
            data: result.data.map(formatProfile),
        });
    } catch (err: any) {
        if (err.message?.includes("Invalid")) {
            res.status(400).json({ status: "error", message: err.message });
            return;
        }
        console.error(err);
        res.status(500).json({ status: "error", message: "Internal server error" });
    }
});

// ─── GET /api/profiles/:id ───
router.get("/:id", async (req: Request, res: Response): Promise<void> => {
    try {
        const profile = await findProfileById(req.params.id);
        if (!profile) {
            res.status(404).json({ status: "error", message: "Profile not found" });
            return;
        }
        res.status(200).json({ status: "success", data: formatProfile(profile) });
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: "error", message: "Internal server error" });
    }
});

// ─── DELETE /api/profiles/:id ───
router.delete("/:id", async (req: Request, res: Response): Promise<void> => {
    try {
        const deleted = await deleteProfileById(req.params.id);
        if (!deleted) {
            res.status(404).json({ status: "error", message: "Profile not found" });
            return;
        }
        res.status(204).send();
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: "error", message: "Internal server error" });
    }
});

// ─── Formatters ───
function formatProfile(p: any) {
    return {
        id: p.id,
        name: p.name,
        gender: p.gender,
        gender_probability: parseFloat(p.gender_probability),
        sample_size: p.sample_size ? parseInt(p.sample_size) : null,
        age: parseInt(p.age),
        age_group: p.age_group,
        country_id: p.country_id,
        country_name: p.country_name ?? null,
        country_probability: parseFloat(p.country_probability),
        created_at: new Date(p.created_at).toISOString(),
    };
}

export default router;