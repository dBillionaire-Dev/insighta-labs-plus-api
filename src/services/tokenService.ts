import jwt from "jsonwebtoken";
import { TokenPayload, User } from "../types";

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || "access_secret_change_me";
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || "refresh_secret_change_me";

// Access token: 3 minutes as per spec
const ACCESS_EXPIRY = "3m";
// Refresh token: 5 minutes as per spec
const REFRESH_EXPIRY = "5m";
const REFRESH_EXPIRY_MS = 5 * 60 * 1000;

export function issueAccessToken(user: User): string {
    const payload: TokenPayload = {
        sub: user.id,
        username: user.username,
        role: user.role,
    };
    return jwt.sign(payload, ACCESS_SECRET, { expiresIn: ACCESS_EXPIRY });
}

export function issueRefreshToken(user: User): string {
    return jwt.sign({ sub: user.id }, REFRESH_SECRET, { expiresIn: REFRESH_EXPIRY });
}

export function getRefreshTokenExpiry(): Date {
    return new Date(Date.now() + REFRESH_EXPIRY_MS);
}

export function verifyAccessToken(token: string): TokenPayload {
    return jwt.verify(token, ACCESS_SECRET) as TokenPayload;
}

export function verifyRefreshToken(token: string): { sub: string } {
    return jwt.verify(token, REFRESH_SECRET) as { sub: string };
}