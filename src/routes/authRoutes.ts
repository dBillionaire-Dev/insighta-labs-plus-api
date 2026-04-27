import { Router, Request, Response } from "express";
import axios from "axios";
import { uuidv7 } from "uuidv7";
import {
    upsertUser,
    findUserById,
    saveRefreshToken,
    findRefreshToken,
    deleteRefreshToken,
    deleteAllUserRefreshTokens,
} from "../repositories/userRepository";
import {
    issueAccessToken,
    issueRefreshToken,
    verifyRefreshToken,
    getRefreshTokenExpiry,
} from "../services/tokenService";
import { requireAuth } from "../middleware/authMiddleware";
import { authRateLimit } from "../middleware/rateLimiter";

const router: Router = Router();

const GITHUB_CLIENT_ID: string = process.env.GITHUB_CLIENT_ID!;
const GITHUB_CLIENT_SECRET: string = process.env.GITHUB_CLIENT_SECRET!;
const GITHUB_CALLBACK_URL: string = process.env.GITHUB_CALLBACK_URL!;
const FRONTEND_URL: string = process.env.FRONTEND_URL || "http://localhost:5173";
const IS_PRODUCTION: boolean = process.env.NODE_ENV === "production";

// Apply rate limiting to all auth routes
router.use(authRateLimit);

// ── GET /auth/github ──
// Redirects to GitHub OAuth. Accepts optional code_challenge for CLI PKCE flow.
router.get("/github", (req: Request, res: Response) => {
    const { code_challenge, code_challenge_method, state } = req.query;

    const params = new URLSearchParams({
        client_id: GITHUB_CLIENT_ID,
        redirect_uri: GITHUB_CALLBACK_URL,
        scope: "read:user user:email",
        state: (state as string) || uuidv7(),
    });

    // PKCE support for CLI
    if (code_challenge) {
        params.set("code_challenge", code_challenge as string);
        params.set("code_challenge_method", (code_challenge_method as string) || "S256");
    }

    res.redirect(`https://github.com/login/oauth/authorize?${params.toString()}`);
});

// ── GET /auth/github/callback ───
router.get("/github/callback", async (req: Request, res: Response): Promise<void> => {
    const { code, state, code_verifier } = req.query;

    if (!code) {
        res.status(400).json({ status: "error", message: "Missing OAuth code" });
        return;
    }

    try {
        // Exchange code for GitHub access token
        const tokenPayload: Record<string, string> = {
            client_id: GITHUB_CLIENT_ID,
            client_secret: GITHUB_CLIENT_SECRET,
            code: code as string,
            redirect_uri: GITHUB_CALLBACK_URL,
        };

        // Include code_verifier for PKCE (CLI flow)
        if (code_verifier) {
            tokenPayload.code_verifier = code_verifier as string;
        }

        const tokenRes = await axios.post(
            "https://github.com/login/oauth/access_token",
            tokenPayload,
            { headers: { Accept: "application/json" } }
        );

        const githubAccessToken = tokenRes.data.access_token;
        if (!githubAccessToken) {
            res.status(502).json({ status: "error", message: "Failed to get GitHub access token" });
            return;
        }

        // Fetch GitHub user profile
        const [userRes, emailRes] = await Promise.all([
            axios.get("https://api.github.com/user", {
                headers: { Authorization: `Bearer ${githubAccessToken}` },
            }),
            axios.get("https://api.github.com/user/emails", {
                headers: { Authorization: `Bearer ${githubAccessToken}` },
            }).catch(() => ({ data: [] })),
        ]);

        const githubUser = userRes.data;
        const primaryEmail =
            emailRes.data.find((e: any) => e.primary && e.verified)?.email ||
            githubUser.email ||
            null;

        // Create or update user in DB
        const user = await upsertUser({
            id: uuidv7(),
            github_id: String(githubUser.id),
            username: githubUser.login,
            email: primaryEmail,
            avatar_url: githubUser.avatar_url,
        });

        // Issue tokens
        const accessToken: string = issueAccessToken(user);
        const refreshTokenStr: string = issueRefreshToken(user);

        await saveRefreshToken({
            id: uuidv7(),
            user_id: user.id,
            token: refreshTokenStr,
            expires_at: getRefreshTokenExpiry(),
        });

        // ── CLI flow: code_verifier present → return JSON ───
        if (code_verifier) {
            res.json({
                status: "success",
                access_token: accessToken,
                refresh_token: refreshTokenStr,
                user: {
                    id: user.id,
                    username: user.username,
                    email: user.email,
                    role: user.role,
                    avatar_url: user.avatar_url,
                },
            });
            return;
        }

        // ── Web portal flow: set HTTP-only cookies ──
        res.cookie("access_token", accessToken, {
            httpOnly: true,
            secure: IS_PRODUCTION,
            sameSite: "lax",
            maxAge: 3 * 60 * 1000, // 3 minutes
        });

        res.cookie("refresh_token", refreshTokenStr, {
            httpOnly: true,
            secure: IS_PRODUCTION,
            sameSite: "lax",
            maxAge: 5 * 60 * 1000, // 5 minutes
        });

        // Redirect to web portal dashboard
        res.redirect(`${FRONTEND_URL}/dashboard`);
    } catch (err) {
        console.error("OAuth callback error:", err);
        res.status(500).json({ status: "error", message: "Authentication failed" });
    }
});

// ── POST /auth/refresh ──
router.post("/refresh", async (req: Request, res: Response): Promise<void> => {
    try {
        // Accept refresh token from body (CLI) or cookie (web)
        const token = req.body.refresh_token || req.cookies?.refresh_token;

        if (!token) {
            res.status(400).json({ status: "error", message: "Refresh token required" });
            return;
        }

        // Verify JWT signature + expiry
        let payload: { sub: string };
        try {
            payload = verifyRefreshToken(token);
        } catch {
            res.status(401).json({ status: "error", message: "Invalid or expired refresh token" });
            return;
        }

        // Verify token exists in DB (prevents reuse after logout)
        const stored = await findRefreshToken(token);
        if (!stored) {
            res.status(401).json({ status: "error", message: "Refresh token not found or already used" });
            return;
        }

        // Check DB expiry as extra safety net
        if (new Date() > new Date(stored.expires_at)) {
            await deleteRefreshToken(token);
            res.status(401).json({ status: "error", message: "Refresh token expired" });
            return;
        }

        const user = await findUserById(stored.user_id);
        if (!user || !user.is_active) {
            res.status(403).json({ status: "error", message: "User not found or deactivated" });
            return;
        }

        // Invalidate old token immediately (rotation)
        await deleteRefreshToken(token);

        // Issue new pair
        const newAccessToken: string = issueAccessToken(user);
        const newRefreshToken: string = issueRefreshToken(user);

        await saveRefreshToken({
            id: uuidv7(),
            user_id: user.id,
            token: newRefreshToken,
            expires_at: getRefreshTokenExpiry(),
        });

        // Web portal: update cookies
        if (req.cookies?.refresh_token) {
            res.cookie("access_token", newAccessToken, {
                httpOnly: true,
                secure: IS_PRODUCTION,
                sameSite: "lax",
                maxAge: 3 * 60 * 1000,
            });
            res.cookie("refresh_token", newRefreshToken, {
                httpOnly: true,
                secure: IS_PRODUCTION,
                sameSite: "lax",
                maxAge: 5 * 60 * 1000,
            });
        }

        res.json({
            status: "success",
            access_token: newAccessToken,
            refresh_token: newRefreshToken,
        });
    } catch (err) {
        console.error("Refresh error:", err);
        res.status(500).json({ status: "error", message: "Internal server error" });
    }
});

// ── POST /auth/logout ──
router.post("/logout", requireAuth, async (req: Request, res: Response): Promise<void> => {
    try {
        const token = req.body.refresh_token || req.cookies?.refresh_token;

        if (token) {
            await deleteRefreshToken(token);
        }

        // Clear cookies for web portal
        res.clearCookie("access_token");
        res.clearCookie("refresh_token");

        res.json({ status: "success", message: "Logged out successfully" });
    } catch (err) {
        console.error("Logout error:", err);
        res.status(500).json({ status: "error", message: "Internal server error" });
    }
});

// ── GET /auth/me ───
router.get("/me", requireAuth, (req: Request, res: Response): void => {
    const user = req.user!;
    res.json({
        status: "success",
        data: {
            id: user.id,
            username: user.username,
            email: user.email,
            avatar_url: user.avatar_url,
            role: user.role,
            last_login_at: user.last_login_at,
            created_at: user.created_at,
        },
    });
});

export default router;