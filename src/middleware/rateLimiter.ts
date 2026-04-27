import rateLimit from "express-rate-limit";

// Auth endpoints: 10 requests per minute
export const authRateLimit = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { status: "error", message: "Too many requests, please try again later" },
});

// All other endpoints: 60 requests per minute per user
export const apiRateLimit = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
        // Rate limit by user id if authenticated, otherwise by IP
        return (req as any).user?.id || req.ip || "unknown";
    },
    message: { status: "error", message: "Too many requests, please try again later" },
});