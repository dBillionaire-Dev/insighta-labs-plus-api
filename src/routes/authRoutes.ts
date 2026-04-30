import { Router, Request, Response } from "express";
import axios from "axios";
import { uuidv7 } from "uuidv7";
import {
    upsertUser, findUserById, saveRefreshToken,
    findRefreshToken, deleteRefreshToken,
} from "../repositories/userRepository";
import {
    issueAccessToken, issueRefreshToken,
    verifyRefreshToken, getRefreshTokenExpiry,
} from "../services/tokenService";
import { requireAuth } from "../middleware/authMiddleware";
import { authRateLimit } from "../middleware/rateLimiter";

const router = Router();
const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID!;
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET!;
const GITHUB_CALLBACK_URL = process.env.GITHUB_CALLBACK_URL!;
const FRONTEND_URL = process.env.FRONTEND_URL!;
const IS_PRODUCTION = process.env.NODE_ENV === "production";

router.use(authRateLimit);

router.get("/github", (req: Request, res: Response) => {
    const { state } = req.query;
    const params = new URLSearchParams({
        client_id: GITHUB_CLIENT_ID,
        redirect_uri: GITHUB_CALLBACK_URL,
        scope: "read:user user:email",
        state: (state as string) || uuidv7(),
    });
    res.redirect(`https://github.com/login/oauth/authorize?${params.toString()}`);
});

router.get("/github/callback", async (req: Request, res: Response): Promise<void> => {
    const { code, state, code_verifier } = req.query;
    if (!code) { res.status(400).json({ status: "error", message: "Missing OAuth code" }); return; }

    const isCLI = (state as string)?.startsWith("cli_") || !!code_verifier;

    try {
        const tokenRes = await axios.post(
            "https://github.com/login/oauth/access_token",
            { client_id: GITHUB_CLIENT_ID, client_secret: GITHUB_CLIENT_SECRET, code: code as string, redirect_uri: GITHUB_CALLBACK_URL },
            { headers: { Accept: "application/json" } }
        );

        const githubAccessToken = tokenRes.data.access_token;
        if (!githubAccessToken) { res.status(502).json({ status: "error", message: "Failed to get GitHub access token" }); return; }

        const [userRes, emailRes] = await Promise.all([
            axios.get("https://api.github.com/user", { headers: { Authorization: `Bearer ${githubAccessToken}` } }),
            axios.get("https://api.github.com/user/emails", { headers: { Authorization: `Bearer ${githubAccessToken}` } }).catch(() => ({ data: [] })),
        ]);

        const githubUser = userRes.data;
        const primaryEmail = emailRes.data.find((e: any) => e.primary && e.verified)?.email || githubUser.email || null;

        const user = await upsertUser({ id: uuidv7(), github_id: String(githubUser.id), username: githubUser.login, email: primaryEmail, avatar_url: githubUser.avatar_url });
        const accessToken = issueAccessToken(user);
        const refreshTokenStr = issueRefreshToken(user);

        await saveRefreshToken({ id: uuidv7(), user_id: user.id, token: refreshTokenStr, expires_at: getRefreshTokenExpiry() });

        if (isCLI) {
            res.json({ status: "success", access_token: accessToken, refresh_token: refreshTokenStr, user: { id: user.id, username: user.username, email: user.email, role: user.role, avatar_url: user.avatar_url } });
            return;
        }

        const cookieOpts = { httpOnly: true, secure: true, sameSite: "none" as const };
        res.cookie("access_token", accessToken, { ...cookieOpts, maxAge: 3 * 60 * 1000 });
        res.cookie("refresh_token", refreshTokenStr, { ...cookieOpts, maxAge: 5 * 60 * 1000 });
        res.redirect(`${FRONTEND_URL}/dashboard`);
    } catch (err) {
        console.error("OAuth callback error:", err);
        res.status(500).json({ status: "error", message: "Authentication failed" });
    }
});

router.post("/refresh", async (req: Request, res: Response): Promise<void> => {
    try {
        const token = req.body.refresh_token || req.cookies?.refresh_token;
        if (!token) { res.status(400).json({ status: "error", message: "Refresh token required" }); return; }

        let payload: { sub: string };
        try { payload = verifyRefreshToken(token); }
        catch { res.status(401).json({ status: "error", message: "Invalid or expired refresh token" }); return; }

        const stored = await findRefreshToken(token);
        if (!stored) { res.status(401).json({ status: "error", message: "Refresh token not found or already used" }); return; }
        if (new Date() > new Date(stored.expires_at)) { await deleteRefreshToken(token); res.status(401).json({ status: "error", message: "Refresh token expired" }); return; }

        const user = await findUserById(stored.user_id);
        if (!user || !user.is_active) { res.status(403).json({ status: "error", message: "User not found or deactivated" }); return; }

        await deleteRefreshToken(token);
        const newAccessToken = issueAccessToken(user);
        const newRefreshToken = issueRefreshToken(user);
        await saveRefreshToken({ id: uuidv7(), user_id: user.id, token: newRefreshToken, expires_at: getRefreshTokenExpiry() });

        const cookieOpts = { httpOnly: true, secure: IS_PRODUCTION, sameSite: IS_PRODUCTION ? ("none" as const) : ("lax" as const) };
        if (req.cookies?.refresh_token) {
            res.cookie("access_token", newAccessToken, { ...cookieOpts, maxAge: 3 * 60 * 1000 });
            res.cookie("refresh_token", newRefreshToken, { ...cookieOpts, maxAge: 5 * 60 * 1000 });
        }

        res.json({ status: "success", access_token: newAccessToken, refresh_token: newRefreshToken });
    } catch (err) {
        console.error("Refresh error:", err);
        res.status(500).json({ status: "error", message: "Internal server error" });
    }
});

router.post("/logout", requireAuth, async (req: Request, res: Response): Promise<void> => {
    try {
        const token = req.body.refresh_token || req.cookies?.refresh_token;
        if (token) await deleteRefreshToken(token);
        const cookieOpts = { httpOnly: true, secure: IS_PRODUCTION, sameSite: IS_PRODUCTION ? ("none" as const) : ("lax" as const) };
        res.clearCookie("access_token", cookieOpts);
        res.clearCookie("refresh_token", cookieOpts);
        res.json({ status: "success", message: "Logged out successfully" });
    } catch (err) {
        console.error("Logout error:", err);
        res.status(500).json({ status: "error", message: "Internal server error" });
    }
});

router.get("/me", requireAuth, (req: Request, res: Response): void => {
    const user = req.user!;
    res.json({ status: "success", data: { id: user.id, username: user.username, email: user.email, avatar_url: user.avatar_url, role: user.role, last_login_at: user.last_login_at, created_at: user.created_at } });
});

export default router;