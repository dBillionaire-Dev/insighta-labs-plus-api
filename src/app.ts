import express, {Request, Response, NextFunction, Application} from "express";
import cookieParser from "cookie-parser";
import { requestLogger } from "./middleware/logger";
import authRouter from "./routes/authRoutes";
import profilesRouter from "./routes/profiles";

const app: Application = express();
const FRONTEND_URL = process.env.FRONTEND_URL !;

// ── Global middleware ──
app.use(express.json());
app.use(cookieParser());
app.use(requestLogger);

// ── CORS ──
app.use((req: Request, res: Response, next: NextFunction): void => {
    const origin = req.headers.origin;

    // Reflect origin dynamically
    if (origin) {
        res.setHeader("Access-Control-Allow-Origin", origin);
    }

    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, X-API-Version, X-CSRF-Token"
    );

    next();
});

// ── Routes ──
app.use("/auth", authRouter);
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
