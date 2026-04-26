import express, {type Application, type Request, type Response, type NextFunction} from "express";
import profilesRouter from "./routes/profiles";

const app: Application = express();

app.use(express.json());

app.use((_req: Request, res: Response, next: NextFunction): void => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (_req.method === "OPTIONS") {
        res.sendStatus(204);
        return;
    }

    next();
});

// ─── Routes ───
app.use("/api/profiles", profilesRouter);

// ─── 404 fallback ───
app.use((_req: Request, res: Response): void => {
  res.status(404).json({ status: "error", message: "Route not found" });
});

export default app;
