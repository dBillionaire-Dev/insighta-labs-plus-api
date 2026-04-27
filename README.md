# Insighta Labs+ — Backend API

A secure, multi-interface demographic intelligence platform built on top of the Profile Intelligence System from Stage 2. Supports GitHub OAuth authentication, role-based access control, natural language querying, CSV export, and serves both a CLI tool and a web portal from a single backend.

---

## System Architecture

```
                        ┌─────────────────────────┐
                        │     Insighta Labs+       │
                        │       Backend API        │
                        │   (Node.js + Express)    │
                        └────────────┬────────────┘
                                     │
               ┌─────────────────────┼─────────────────────┐
               │                     │                     │
        ┌──────▼──────┐      ┌───────▼──────┐     ┌───────▼──────┐
        │  CLI Tool   │      │  Web Portal  │     │   Grader /   │
        │  (insighta) │      │  (React/SPA) │     │  Direct API  │
        │ Bearer token│      │ HTTP-only    │     │   clients    │
        └─────────────┘      │   cookies    │     └─────────────┘
                             └─────────────┘

                        ┌─────────────────────────┐
                        │      PostgreSQL DB        │
                        │  profiles | users |       │
                        │  refresh_tokens           │
                        └─────────────────────────┘
```

Three separate repositories share one backend:
- **Backend** — Express API, PostgreSQL, JWT auth, OAuth
- **CLI** — globally installable `insighta` terminal tool
- **Web Portal** — browser interface with HTTP-only cookies

---

## Tech Stack

- **Runtime**: Node.js + TypeScript
- **Framework**: Express
- **Database**: PostgreSQL
- **Auth**: GitHub OAuth 2.0 with PKCE
- **Tokens**: JSON Web Tokens (JWT)
- **Deployment**: Railway

---

## Local Setup

### Prerequisites
- Node.js 18+
- PostgreSQL running locally

### Steps

```bash
git clone <your-repo-url>
cd profiles-api
npm install
cp .env.example .env       # fill in all values
npm run build
npm run migrate            # creates all tables + indexes
npm run seed               # seeds 2026 profiles
npm run dev
```

### Environment Variables

| Variable | Description |
|---|---|
| `PORT` | Server port (default 3000) |
| `DATABASE_URL` | PostgreSQL connection string |
| `NODE_ENV` | `development` or `production` |
| `GITHUB_CLIENT_ID` | From GitHub OAuth App settings |
| `GITHUB_CLIENT_SECRET` | From GitHub OAuth App settings |
| `GITHUB_CALLBACK_URL` | Must match exactly what's registered on GitHub |
| `JWT_ACCESS_SECRET` | Long random string for signing access tokens |
| `JWT_REFRESH_SECRET` | Long random string for signing refresh tokens |
| `FRONTEND_URL` | Web portal origin (for CORS + cookie redirect) |
| `CSRF_SECRET` | Secret for CSRF token generation |

---

## Authentication Flow

### GitHub OAuth — Web Portal

```
Browser → GET /auth/github
       ← Redirect to GitHub login page
       → User approves → GitHub redirects to /auth/github/callback?code=...
       ← Backend exchanges code for GitHub token
       ← Fetches GitHub user profile
       ← Creates/updates user in DB
       ← Sets HTTP-only access_token + refresh_token cookies
       ← Redirects browser to /dashboard
```

### GitHub OAuth — CLI (PKCE Flow)

```
CLI generates code_verifier + code_challenge (SHA-256)
CLI opens browser → GET /auth/github?code_challenge=...&code_verifier=...
GitHub redirects → /auth/github/callback?code=...&code_verifier=...
Backend verifies PKCE, exchanges code, returns JSON:
  { access_token, refresh_token, user }
CLI saves tokens to ~/.insighta/credentials.json
```

PKCE prevents token interception — the code_verifier is never sent to GitHub, only the challenge hash. The backend verifies them match before issuing tokens.

---

## Token Handling

| Token | Expiry | Storage (CLI) | Storage (Web) |
|---|---|---|---|
| Access token | 3 minutes | `~/.insighta/credentials.json` | HTTP-only cookie |
| Refresh token | 5 minutes | `~/.insighta/credentials.json` | HTTP-only cookie |

**Rotation:** Every time a refresh token is used, it is immediately deleted from the database and a new pair is issued. Reusing an old refresh token returns 401.

**Auto-refresh:** The CLI automatically calls `POST /auth/refresh` when it receives a 401, retries the original request with the new access token, and saves the new tokens to disk.

---

## Role Enforcement

Two roles exist: `admin` and `analyst`. New users are assigned `analyst` by default on first login.

| Endpoint | analyst | admin |
|---|---|---|
| `GET /api/profiles` | ✅ | ✅ |
| `GET /api/profiles/:id` | ✅ | ✅ |
| `GET /api/profiles/search` | ✅ | ✅ |
| `GET /api/profiles/export` | ✅ | ✅ |
| `POST /api/profiles` | ❌ | ✅ |
| `DELETE /api/profiles/:id` | ❌ | ✅ |

Role is encoded in the JWT payload and verified on every request by the `requireRole()` middleware. It is also cross-checked against the database on every request via `requireAuth`.

---

## API Versioning

Every request to `/api/*` must include the header:

```
X-API-Version: 1
```

Missing or incorrect version returns:
```json
{ "status": "error", "message": "API version header required" }
```

---

## API Endpoints

### Auth

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/auth/github` | Redirect to GitHub OAuth |
| `GET` | `/auth/github/callback` | OAuth callback — issues tokens |
| `POST` | `/auth/refresh` | Refresh access + refresh tokens |
| `POST` | `/auth/logout` | Invalidate refresh token |
| `GET` | `/auth/me` | Get current user profile |

### Profiles (all require auth + `X-API-Version: 1`)

| Method | Endpoint | Role | Description |
|---|---|---|---|
| `GET` | `/api/profiles` | any | List with filtering, sorting, pagination |
| `GET` | `/api/profiles/search?q=` | any | Natural language search |
| `GET` | `/api/profiles/export` | any | Download CSV |
| `GET` | `/api/profiles/:id` | any | Get single profile |
| `POST` | `/api/profiles` | admin | Create profile |
| `DELETE` | `/api/profiles/:id` | admin | Delete profile |

### Filtering Params (`GET /api/profiles`)

| Param | Type | Example |
|---|---|---|
| `gender` | string | `male` |
| `age_group` | string | `adult` |
| `country_id` | string | `NG` |
| `min_age` | number | `25` |
| `max_age` | number | `40` |
| `min_gender_probability` | float | `0.8` |
| `min_country_probability` | float | `0.5` |
| `sort_by` | string | `age` / `created_at` / `gender_probability` |
| `order` | string | `asc` / `desc` |
| `page` | number | `1` |
| `limit` | number | `10` (max 50) |

### Pagination Response Shape

```json
{
  "status": "success",
  "page": 1,
  "limit": 10,
  "total": 2026,
  "total_pages": 203,
  "data": [...]
}
```

---

## Natural Language Parsing

Endpoint: `GET /api/profiles/search?q=<query>`

Rule-based parsing — no AI, no LLMs.

| Query | Parsed filters |
|---|---|
| `young males from nigeria` | gender=male, min_age=16, max_age=24, country_id=NG |
| `females above 30` | gender=female, min_age=30 |
| `adult males from kenya` | gender=male, age_group=adult, country_id=KE |
| `seniors from ghana` | age_group=senior, country_id=GH |
| `people between 20 and 40` | min_age=20, max_age=40 |

**Rules:**
- `young` → min_age=16, max_age=24 (parsing only — not a stored age group)
- `above/over X` → min_age=X
- `below/under X` → max_age=X
- `between X and Y` → min_age=X, max_age=Y
- Gender words: male/man/men/boy → male; female/woman/women/girl → female
- Country names → ISO 2-letter code (65 countries mapped)
- Age group words: child/kids, teen/teenager, adult, senior/elderly/old

Uninterpretable queries return:
```json
{ "status": "error", "message": "Unable to interpret query" }
```

---

## Rate Limiting

| Route | Limit |
|---|---|
| `/auth/*` | 10 requests/minute |
| `/api/*` | 60 requests/minute per user |

---

## Request Logging

Every request logs: `[timestamp] METHOD /path STATUS_CODE duration_ms`

Example:
```
[2026-04-27T08:00:00.000Z] GET /api/profiles 200 12ms
```

---

## CSV Export

`GET /api/profiles/export` — supports all filter params, streams a `.csv` file with headers:

```
id, name, gender, gender_probability, age, age_group, country_id, country_name, country_probability, created_at
```

---

## Database Schema

```sql
-- profiles
id, name, gender, gender_probability, sample_size, age, age_group,
country_id, country_name, country_probability, created_at

-- users
id, github_id, username, email, avatar_url, role,
is_active, last_login_at, created_at

-- refresh_tokens
id, user_id, token, expires_at, created_at
```

---

## Deployment (Railway)

Start command:
```bash
npm run build && npm run migrate && npm run seed && npm start
```

Required environment variables on Railway:
```
DATABASE_URL          (auto-injected from Postgres plugin)
NODE_ENV=production
GITHUB_CLIENT_ID
GITHUB_CLIENT_SECRET
GITHUB_CALLBACK_URL
JWT_ACCESS_SECRET
JWT_REFRESH_SECRET
FRONTEND_URL
CSRF_SECRET
```