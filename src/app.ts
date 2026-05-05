import express, { Request, Response, NextFunction, Application } from "express";
import cors from "cors"
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
export const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    const allowed = [
      process.env.FRONTEND_URL,
      'http://localhost:3001',
      'http://localhost:5173',
    ].filter(Boolean);

    // Allow requests with no origin (CLI, curl, Postman, server-to-server)
    if (!origin) return callback(null, true);

    if (allowed.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS: origin ${origin} not allowed`));
    }
  },
  credentials: true,         // ← CRITICAL: allows cookies cross-origin
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Version', 'X-CSRF-Token'],
  exposedHeaders: ['X-Cache'],
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions)); // ← preflight for all routes

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
