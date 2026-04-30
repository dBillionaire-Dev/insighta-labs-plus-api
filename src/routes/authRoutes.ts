import { Router, Request, Response } from "express";
import axios from "axios";
import { uuidv7 } from "uuidv7";

import {
    upsertUser,
    findUserById,
    saveRefreshToken,
    findRefreshToken,
    deleteRefreshToken,
} from "../repositories/userRepository";

import {
    issueAccessToken,
    issueRefreshToken,
    verifyRefreshToken,
    getRefreshTokenExpiry,
} from "../services/tokenService";

import { requireAuth } from "../middleware/authMiddleware";
import { authRateLimit } from "../middleware/rateLimiter";

const router = Router();

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID!;
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET!;
const GITHUB_CALLBACK_URL = process.env.GITHUB_CALLBACK_URL!;

// ─────────────────────────────
// In-memory OAuth state store
// ─────────────────────────────
const oauthStateStore = new Map<string, number>();
const STATE_TTL = 5 * 60 * 1000;

// ─────────────────────────────
// GitHub OAuth Start
// ─────────────────────────────
router.get("/github", authRateLimit, (req: Request, res: Response) => {
    const generatedState = uuidv7();

    oauthStateStore.set(generatedState, Date.now());

    const params = new URLSearchParams({
        client_id: GITHUB_CLIENT_ID,
        redirect_uri: GITHUB_CALLBACK_URL,
        scope: "read:user user:email",
        state: generatedState,
    });

    res.redirect(`https://github.com/login/oauth/authorize?${params.toString()}`);
});

// ─────────────────────────────
// OAuth Callback (STRICT VALIDATION)
// ─────────────────────────────
router.get("/github/callback", authRateLimit, async (req: Request, res: Response): Promise<void> => {
    const { code, state, code_verifier } = req.query;

    // 🔥 REQUIRED VALIDATION
    if (!code || !state) {
        res.status(400).json({
            status: "error",
            message: "Missing OAuth parameters",
        });
        return;
    }

    if (typeof state !== "string" || !oauthStateStore.has(state)) {
        res.status(400).json({
            status: "error",
            message: "Invalid OAuth state",
        });
        return;
    }

    const createdAt = oauthStateStore.get(state)!;

    if (Date.now() - createdAt > STATE_TTL) {
        oauthStateStore.delete(state);
        res.status(400).json({
            status: "error",
            message: "Expired OAuth state",
        });
        return;
    }

    // one-time use
    oauthStateStore.delete(state);

    // PKCE validation (basic)
    if (code_verifier && typeof code_verifier !== "string") {
        res.status(400).json({
            status: "error",
            message: "Invalid PKCE verifier",
        });
        return;
    }

    try {
        const tokenRes = await axios.post(
            "https://github.com/login/oauth/access_token",
            {
                client_id: GITHUB_CLIENT_ID,
                client_secret: GITHUB_CLIENT_SECRET,
                code: code as string,
                redirect_uri: GITHUB_CALLBACK_URL,
            },
            { headers: { Accept: "application/json" } }
        );

        const githubAccessToken = tokenRes.data.access_token;

        if (!githubAccessToken) {
            res.status(502).json({
                status: "error",
                message: "Failed to get GitHub access token",
            });
            return;
        }

        const [userRes, emailRes] = await Promise.all([
            axios.get("https://api.github.com/user", {
                headers: { Authorization: `Bearer ${githubAccessToken}` },
            }),
            axios
                .get("https://api.github.com/user/emails", {
                    headers: { Authorization: `Bearer ${githubAccessToken}` },
                })
                .catch(() => ({ data: [] })),
        ]);

        const githubUser = userRes.data;

        const primaryEmail =
            emailRes.data.find((e: any) => e.primary && e.verified)?.email ||
            githubUser.email ||
            null;

        // 🔥 ROLE MUST BE EXPLICIT
        const user = await upsertUser({
            id: uuidv7(),
            github_id: String(githubUser.id),
            username: githubUser.login,
            email: primaryEmail,
            avatar_url: githubUser.avatar_url,
            role: "user",
        });

        const accessToken = issueAccessToken(user);
        const refreshTokenStr = issueRefreshToken(user);

        await saveRefreshToken({
            id: uuidv7(),
            user_id: user.id,
            token: refreshTokenStr,
            expires_at: getRefreshTokenExpiry(),
        });

        // 🔥 ALWAYS RETURN JSON (NO REDIRECT)
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
    } catch (err) {
        console.error("OAuth callback error:", err);
        res.status(500).json({
            status: "error",
            message: "Authentication failed",
        });
    }
});

// ─────────────────────────────
// Refresh Token
// ─────────────────────────────
router.post("/refresh", authRateLimit, async (req: Request, res: Response): Promise<void> => {
    const token = req.body.refresh_token || req.cookies?.refresh_token;

    if (!token) {
        res.status(400).json({
            status: "error",
            message: "Refresh token required",
        });
        return;
    }

    try {
        verifyRefreshToken(token);
    } catch {
        res.status(401).json({
            status: "error",
            message: "Invalid or expired refresh token",
        });
        return;
    }

    const stored = await findRefreshToken(token);

    if (!stored) {
        res.status(401).json({
            status: "error",
            message: "Refresh token not found",
        });
        return;
    }

    if (new Date() > new Date(stored.expires_at)) {
        await deleteRefreshToken(token);
        res.status(401).json({
            status: "error",
            message: "Refresh token expired",
        });
        return;
    }

    const user = await findUserById(stored.user_id);

    if (!user || !user.is_active) {
        res.status(403).json({
            status: "error",
            message: "User not found or inactive",
        });
        return;
    }

    await deleteRefreshToken(token);

    const newAccessToken = issueAccessToken(user);
    const newRefreshToken = issueRefreshToken(user);

    await saveRefreshToken({
        id: uuidv7(),
        user_id: user.id,
        token: newRefreshToken,
        expires_at: getRefreshTokenExpiry(),
    });

    res.json({
        status: "success",
        access_token: newAccessToken,
        refresh_token: newRefreshToken,
    });
});

// ─────────────────────────────
// Logout
// ─────────────────────────────
router.post("/logout", requireAuth, async (req: Request, res: Response): Promise<void> => {
    const token = req.body.refresh_token || req.cookies?.refresh_token;

    if (token) {
        await deleteRefreshToken(token);
    }

    res.json({
        status: "success",
        message: "Logged out successfully",
    });
});

// ─────────────────────────────
// Me
// ─────────────────────────────
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