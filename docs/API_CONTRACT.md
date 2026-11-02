# API contract (Next.js Route Handlers)

Agreed up front so both teammates can build against it in parallel. JSON in/out.
Errors: `{ "error": "<message>" }` with 400 (validation), 401 (not logged in), 403 (wrong role),
404, 409 (conflict, e.g. database rejected a rule). Database error text from triggers/procedures
(e.g. "must be exactly 100") is passed through in `error`.

Every database request opens a transaction and runs:
```sql
SET LOCAL ROLE rl_<admin|artist|auditor>;
SET LOCAL app.user_id   = '<user_id>';
SET LOCAL app.artist_id = '<artist_id>';   -- artists only
```
Credentials come only from environment variables (`.env.example`).

## Interface between PostgreSQL and MongoDB (the one thing both sides must agree on)
`aggregateUsage(db, periodStart, periodEnd)` in `mongo/pipelines/usage_ops.js` returns:
```json
[ { "track_id": 1, "platform": "spotify", "plays": 1234567 } ]
```
`POST /api/periods/:id/aggregate` maps `platform` -> `platform.platform_id` (via `platform.code`)
and upserts into `usage_summary (period_id, track_id, platform_id, plays)`.
Unknown platform codes or track ids -> 400 listing the offending values; nothing is written.

## Routes
Roles: **A** admin, **R** artist, **U** auditor, **\*** any logged-in user.

### Auth
| Method | Path | Role | Body / notes |
|---|---|---|---|
| POST | /api/auth/login | public | `{email, password}` -> sets session cookie; returns `{user_id, role, display_name, artist_id?}` |
| POST | /api/auth/logout | * | |
| GET | /api/auth/me | * | current user |

### Catalogue (Member A slice)
| Method | Path | Role | Notes |
|---|---|---|---|
| GET/POST | /api/artists | A (GET: *) | `{stage_name, kind}` |
| PATCH/DELETE | /api/artists/:id | A | |
| GET/PUT | /api/artists/:id/members | A | group members `[{member_id, share_pct}]`; the set must total 100, so `PUT` replaces the whole set in one transaction |
| GET/POST | /api/tracks | A (GET: *) | `{isrc, title, release_date}` |
| PATCH/DELETE | /api/tracks/:id | A | |
| GET | /api/search?q= | * | calls `search_catalog(q)` |
| GET | /api/tracks/:id/contracts | A, U | versions with status, from `v_contract_overview` |
| POST | /api/tracks/:id/contracts | A | creates draft via `create_contract_draft`, body `{splits:[{artist_id, share_pct}]}` |
| PUT | /api/contracts/:id/splits | A | replace draft splits (409 if not draft) |
| POST | /api/contracts/:id/activate | A | `activate_contract` (409 if total != 100) |
| DELETE | /api/contracts/:id | A | drafts only |
| GET | /api/tracks/:id/effective-split | A, U | from `v_active_split` |

### Usage (MongoDB) and payouts (Member B slice)
| Method | Path | Role | Notes |
|---|---|---|---|
| GET/POST | /api/periods | A (GET: A,U) | `{period_start, period_end}` |
| GET | /api/periods/:id | A, U | from `v_period_summary` |
| POST | /api/periods/:id/usage/import | A | `{platform, file_name, events:[{event_id, source_ref?, track_id, occurred_at, plays, country?, platform_payload?, flags?}]}` -> `ingestBatch`; returns `{batch_id, count}` |
| GET | /api/usage/batches?period_id= | A, U | batch list with status and notes |
| GET | /api/usage/batches/:batchId/duplicates | A | `findDuplicates` |
| POST | /api/usage/batches/:batchId/void-duplicates | A | -> `{voided: n}` |
| POST | /api/usage/batches/:batchId/void-flagged | A | `{flag:"bot", reason}` -> `{voided: n}` |
| DELETE | /api/usage/batches/:batchId/voided | A | `purgeVoided` -> `{deleted: n}` |
| POST | /api/usage/batches/:batchId/dispute | A | `{text}`; events held out of aggregation |
| POST | /api/usage/batches/:batchId/resolve | A | `{text}` |
| POST | /api/periods/:id/aggregate | A | runs `aggregateUsage`, upserts `usage_summary`; replaces earlier rows of that period; 409 if period closed |
| POST | /api/periods/:id/close | A | `CALL close_payout_period(:id, :user_id)`; returns `{payouts:[...]}` |
| GET | /api/periods/:id/ledger | A, U | rows of `ledger_entry` |
| GET | /api/payouts?period_id= | A, U | R gets only their own (row-level security) |
| POST | /api/payouts/:id/pay | A | `mark_payout_paid` (409 if already paid) |

### Artist self-service
| Method | Path | Role | Notes |
|---|---|---|---|
| GET | /api/me/statements?period_id= | R | `v_artist_statement` |
| GET | /api/me/payouts | R | |

### Audit
| Method | Path | Role | Notes |
|---|---|---|---|
| GET | /api/audit?table=&row_pk=&limit= | U, A | from `audit_log`, newest first |

## Pages (suggested)
`/login` · Admin: `/admin/artists`, `/admin/tracks`, `/admin/tracks/[id]` (contracts + effective split),
`/admin/periods`, `/admin/periods/[id]` (upload, clean, aggregate, close) · Artist: `/me` (statements, payouts) ·
Auditor: `/audit` (ledger + audit trail).
