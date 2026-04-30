import express, { Request, Response, NextFunction, Application } from "express";
import cookieParser from "cookie-parser";
import { requestLogger } from "./middleware/logger";
import authRouter from "./routes/authRoutes";
import profilesRouter from "./routes/profiles";

const app: Application = express();

app.set("trust proxy", 1);

const FRONTEND_URL = process.env.FRONTEND_URL!;

app.use(express.json());
app.use(cookieParser());
app.use(requestLogger);

// ── CORS ──
const allowedOrigins = [
    "https://insighta-labs-nez.vercel.app",
    "http://localhost:5173"
];

app.use((req: Request, res: Response, next: NextFunction): void => {
    const origin = req.headers.origin;

    if (origin && allowedOrigins.includes(origin)) {
        res.setHeader("Access-Control-Allow-Origin", origin);
    }

    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, X-API-Version, X-CSRF-Token"
    );

    if (req.method === "OPTIONS") {
        res.sendStatus(204);
        return;
    }

    next();
});

// ── Routes ──
app.use("/auth", authRouter);
app.use("/api/profiles", profilesRouter);

app.get("/health", (_req: Request, res: Response): void => {
    res.json({ status: "ok", version: "3.0.0" });
});

app.use((_req: Request, res: Response): void => {
    res.status(404).json({ status: "error", message: "Route not found" });
});

export default app;