import express, {Request, Response, NextFunction, Application} from "express";
import cookieParser from "cookie-parser";
import { requestLogger } from "./middleware/logger";
import { requireAuth } from "./middleware/authMiddleware";
import { apiRateLimit } from "./middleware/rateLimiter";
import authRouter from "./routes/authRoutes";
import profilesRouter from "./routes/profiles";

const app: Application = express();
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

// ── Global middleware ──
app.use(express.json());
app.use(cookieParser());
app.use(requestLogger);

// ── CORS ──
app.use((req: Request, res: Response, next: NextFunction): void => {
    const origin: string | undefined = req.headers.origin;
    // Allow web portal origin with credentials, and all others without
    if (origin === FRONTEND_URL) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Access-Control-Allow-Credentials", "true");
    } else {
        res.setHeader("Access-Control-Allow-Origin", "*");
    }
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-API-Version, X-CSRF-Token");
    next();
});

app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method === "OPTIONS") {
        return res.sendStatus(204);
    }
    next();
});

// ── Routes ──
app.use("/auth", authRouter);
app.use("/api", requireAuth, apiRateLimit);
app.use("/api/profiles", profilesRouter);

// ── Health check ──
app.get("/health", (_req: Request, res: Response): void => {
    res.json({ status: "ok", version: "2.0.0" });
});

// ── 404 fallback ──
app.use((_req: Request, res: Response): void => {
    res.status(404).json({ status: "error", message: "Route not found" });
});

export default app;