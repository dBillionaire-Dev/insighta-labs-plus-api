import { Request, Response, NextFunction } from "express";
import { verifyAccessToken } from "../services/tokenService";
import { findUserById } from "../repositories/userRepository";
import { UserRole } from "../types";

// ── Require authentication ───
export async function requireAuth(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const authHeader: string | undefined = req.headers.authorization;

        // Support both: Authorization: Bearer <token> and cookie-based (web portal)
        let token: string | undefined;

        if (authHeader?.startsWith("Bearer ")) {
            token = authHeader.slice(7);
        } else if (req.cookies?.access_token) {
            token = req.cookies.access_token;
        }

        if (!token) {
            res.status(401).json({ status: "error", message: "Authentication required" });
            return;
        }

        const payload = verifyAccessToken(token);
        const user = await findUserById(payload.sub);

        if (!user) {
            res.status(401).json({ status: "error", message: "User not found" });
            return;
        }

        if (!user.is_active) {
            res.status(403).json({ status: "error", message: "Account is deactivated" });
            return;
        }

        req.user = user;
        next();
    } catch (err: any) {
        if (err.name === "TokenExpiredError") {
            res.status(401).json({ status: "error", message: "Token expired" });
            return;
        }
        res.status(401).json({ status: "error", message: "Invalid token" });
    }
}

// ── Require specific role(s) ──
export function requireRole(...roles: UserRole[]) {
    return (req: Request, res: Response, next: NextFunction): void => {
        if (!req.user) {
            res.status(401).json({ status: "error", message: "Authentication required" });
            return;
        }
        if (!roles.includes(req.user.role)) {
            res.status(403).json({
                status: "error",
                message: "You do not have permission to perform this action",
            });
            return;
        }
        next();
    };
}

// ── Require API version header ──
export function requireApiVersion(
    req: Request,
    res: Response,
    next: NextFunction
): void {
    const version = req.headers["x-api-version"];
    if (!version || version !== "1") {
        res.status(400).json({
            status: "error",
            message: "API version header required",
        });
        return;
    }
    next();
}
