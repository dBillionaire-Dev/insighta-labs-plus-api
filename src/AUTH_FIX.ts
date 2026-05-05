/**
 * AUTH FIX — CORS + Cookie Configuration
 *
 * ROOT CAUSE of "cookies not being sent or stored":
 * There are two bugs that almost always co-occur:
 *
 * BUG 1 — CORS missing credentials support
 *   When the browser sends a cross-origin request (web portal on one domain,
 *   API on another), cookies are only included if:
 *     a) The request is made with `credentials: 'include'`
 *     b) The server responds with `Access-Control-Allow-Credentials: true`
 *     c) The server does NOT use `Access-Control-Allow-Origin: *`
 *        (wildcard origin blocks credentials by browser spec)
 *
 * BUG 2 — Cookie SameSite/Secure flags wrong for cross-site
 *   For cookies to be sent cross-origin (web portal ↔ Railway API):
 *     SameSite must be 'none' (not 'lax' or 'strict')
 *     Secure must be true (SameSite=None requires HTTPS)
 *   In development (HTTP localhost), SameSite='lax' and Secure=false works
 *   because both origins are localhost.
 *
 * APPLY THESE CHANGES to your existing app.ts:
 */

// ─── 1. CORS config ────────────────────────────────────────────────────────
// Replace your existing cors() call with this:

import cors from 'cors';

export const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    const allowed = [
      process.env.FRONTEND_URL,          // web portal (e.g. https://insighta-web.up.railway.app)
      'http://localhost:3001',            // local web dev
      'http://localhost:5173',            // Vite dev server
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

// Usage in app.ts:
// app.use(cors(corsOptions));
// app.options('*', cors(corsOptions)); // ← preflight for all routes


// ─── 2. Cookie options ────────────────────────────────────────────────────
// Replace your cookie options in the auth callback with this:

const isProduction = process.env.NODE_ENV === 'production';

export const cookieOptions = {
  httpOnly: true,           // not accessible via JS — XSS protection
  secure: isProduction,     // HTTPS only in prod; HTTP ok in dev
  sameSite: (isProduction ? 'none' : 'lax') as 'none' | 'lax',
  // ↑ CRITICAL: 'none' is required for cross-site cookies (prod)
  //             'lax' works for same-site (localhost dev)
  path: '/',
};

// Usage in auth callback:
// res.cookie('access_token', accessToken, {
//   ...cookieOptions,
//   maxAge: 3 * 60 * 1000,         // 3 minutes (matches JWT expiry)
// });
// res.cookie('refresh_token', refreshToken, {
//   ...cookieOptions,
//   maxAge: 5 * 60 * 1000,         // 5 minutes (matches JWT expiry)
// });


// ─── 3. Cookie parser order ───────────────────────────────────────────────
// Make sure cookie-parser comes BEFORE your auth middleware in app.ts:
// app.use(cookieParser());   ← must be before requireAuth
// app.use('/api', requireAuth, profilesRouter);


// ─── 4. Web portal fetch calls ────────────────────────────────────────────
// Every fetch() in the web portal that needs to send cookies must include:
//
// fetch('https://your-api.railway.app/auth/me', {
//   credentials: 'include',   ← CRITICAL: without this, browser never sends cookies
// });
//
// For axios users:
// axios.defaults.withCredentials = true;
//
// For React Query / SWR, set this in your fetcher function.


// ─── 5. CLI — no change needed ───────────────────────────────────────────
// The CLI uses Bearer tokens in the Authorization header, not cookies.
// CLI auth is unaffected by cookie SameSite settings.
// If the CLI is failing, check:
//   a) ~/.insighta/credentials.json exists and has a valid token
//   b) The CLI sends `Authorization: Bearer <token>` on every request
//   c) The API's requireAuth middleware checks req.headers.authorization
//      BEFORE checking req.cookies (so both web and CLI work)


// ─── 6. requireAuth middleware fix ───────────────────────────────────────
// Your requireAuth should check both cookie AND Bearer token:
//
// export function requireAuth(req, res, next) {
//   // CLI path: Authorization: Bearer <token>
//   const authHeader = req.headers.authorization;
//   if (authHeader?.startsWith('Bearer ')) {
//     const token = authHeader.slice(7);
//     try {
//       req.user = jwt.verify(token, process.env.JWT_ACCESS_SECRET!);
//       return next();
//     } catch {}
//   }
//
//   // Web path: HTTP-only cookie
//   const token = req.cookies?.access_token;
//   if (token) {
//     try {
//       req.user = jwt.verify(token, process.env.JWT_ACCESS_SECRET!);
//       return next();
//     } catch {}
//   }
//
//   return res.status(401).json({ status: 'error', message: 'Unauthorised' });
// }
