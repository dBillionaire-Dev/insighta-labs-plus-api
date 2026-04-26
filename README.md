# Profiles API — Stage 2: Intelligence Query Engine

A REST API that aggregates name-based demographic predictions and exposes a queryable intelligence engine with advanced filtering, sorting, pagination, and natural language search.

## Tech Stack

- **Runtime**: Node.js + TypeScript
- **Framework**: Express
- **Database**: PostgreSQL
- **ID generation**: UUID v7
- **HTTP client**: Axios

## Project Structure

```
src/
├── index.ts                          # Entry point
├── app.ts                            # Express app + middleware
├── db/
│   ├── pool.ts                       # PostgreSQL connection pool
│   ├── migrate.ts                    # Creates/upgrades profiles table + indexes
│   ├── seed.ts                       # Seeds 2026 profiles from JSON
│   └── seed_profiles.json            # Seed data
├── routes/
│   └── profiles.ts                   # All endpoints
├── services/
│   ├── aggregator.ts                 # Calls 3 external APIs
│   └── nlpParser.ts                  # Natural language query parser
├── repositories/
│   └── profileRepository.ts          # All DB queries with filtering/pagination
└── types/
    └── index.ts                      # TypeScript interfaces
```

## Local Setup

```bash
git clone <your-repo-url>
cd profiles-api
npm install
cp .env.example .env        # set DATABASE_URL
npm run build
npm run migrate             # create table + indexes
npm run seed                # insert 2026 profiles
npm run dev
```

## Deployment (Railway)

Start command:
```bash
npm run build && npm run migrate && npm run seed && npm start
```

## API Endpoints

### POST /api/profiles
Create a profile from a name. Calls Genderize, Agify, Nationalize.

### GET /api/profiles
List profiles with advanced filtering, sorting, and pagination.

**Filters:**
| Param | Type | Example |
|---|---|---|
| `gender` | string | `male` / `female` |
| `age_group` | string | `adult` / `senior` / `child` / `teenager` |
| `country_id` | string | `NG` |
| `min_age` | number | `25` |
| `max_age` | number | `40` |
| `min_gender_probability` | float | `0.8` |
| `min_country_probability` | float | `0.5` |

**Sorting:**
| Param | Values |
|---|---|
| `sort_by` | `age` / `created_at` / `gender_probability` |
| `order` | `asc` / `desc` |

**Pagination:**
| Param | Default | Max |
|---|---|---|
| `page` | `1` | — |
| `limit` | `10` | `50` |

**Response:**
```json
{
  "status": "success",
  "page": 1,
  "limit": 10,
  "total": 2026,
  "data": [...]
}
```

### GET /api/profiles/search?q=...
Natural language query engine.

**Examples:**
```
/api/profiles/search?q=young males from nigeria
/api/profiles/search?q=females above 30
/api/profiles/search?q=adult males from kenya
/api/profiles/search?q=senior women from ghana
/api/profiles/search?q=teenagers below 18
/api/profiles/search?q=people from angola
```

**How parsing works:**
- `young` → min_age=16, max_age=24
- `male/men/man/boys` → gender=male
- `female/women/woman/girls` → gender=female
- `above/over X` → min_age=X
- `below/under X` → max_age=X
- `between X and Y` → min_age=X, max_age=Y
- Country names → ISO code (e.g. `nigeria` → `NG`)
- Age group words → `child/teenager/adult/senior`

Supports `page` and `limit` params too.

### GET /api/profiles/:id
Get a single profile by UUID.

### DELETE /api/profiles/:id
Delete a profile. Returns `204 No Content`.

## Error Responses

```json
{ "status": "error", "message": "..." }
```

| Status | Cause |
|---|---|
| 400 | Missing/empty parameter |
| 422 | Invalid type or uninterpretable NLP query |
| 404 | Profile not found |
| 502 | External API returned invalid data |
| 500 | Internal server error |
