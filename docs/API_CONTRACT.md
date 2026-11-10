# API contract (Next.js Route Handlers)

Agreed up front so both members can build against it in parallel. Changes need both members' agreement
(change this file in the same PR as the code).

## Conventions
* JSON in and out (`Content-Type: application/json`), except the CSV upload (multipart, see usage import).
* Ids: PostgreSQL ids are integers; MongoDB batch ids are 24-character hex strings.
* Dates: `YYYY-MM-DD` for calendar dates, ISO 8601 (`2026-09-12T14:05:00Z`) for timestamps. Money is returned as a
  string with the database's scale (`"260.00"`, ledger lines `"35.0000"`), never a float.
* Session: `POST /api/auth/login` sets an httpOnly, `SameSite=Lax` cookie `rl_session` holding an HS256 JWT
  (`AUTH_SECRET`, 8 h) with claims `{ sub: user_id, email, role, artist_id }`.
* Roles: **A** admin, **R** artist, **U** auditor, **\*** any logged-in user, **public** no session needed.
* Every database call goes through `withDb(session, fn)` in `lib/db.ts`:
  `BEGIN` -> `SET LOCAL ROLE rl_<role>` -> `set_config('app.user_id', ..., true)` (+ `app.artist_id` for artists)
  -> queries -> `COMMIT` / `ROLLBACK`. So the database enforces the role too (GRANTs + row-level security).
  Only login reads `app_user`, as the owner role.

### Errors
Body is always `{ "error": "<message>" }` (plus `details` where noted).

| Situation | Status | `error` |
|---|---|---|
| zod validation failed | 400 | first issue, `details`: all issues `[{path, message}]` |
| not logged in / bad session | 401 | `Not logged in` |
| logged in, wrong role | 403 | `Forbidden` |
| unknown id | 404 | e.g. `Track 99 not found` |
| business rule (`RAISE EXCEPTION`, SQLSTATE `P0001`) | 409 | the database message, verbatim |
| unique violation `23505` | 409 | database message |
| foreign-key violation `23503` | 409 | database message |
| check violation `23514` | 400 | database message |
| insufficient privilege `42501` | 403 | database message |

The UI shows `error` as is, so database messages such as
`Splits of contract 8 total 90 percent, must be exactly 100` reach the user unchanged.

## Interface between MongoDB and PostgreSQL
`aggregateUsage(db, periodId)` in `mongo/pipelines/usage_ops.js` returns the valid plays of a period, excluding
disputed batches, as:
```json
[ { "track_id": 1, "platform": "spotify", "plays": 789 } ]
```
`POST /api/periods/:id/aggregate` validates every `track_id` against `track` and every `platform` against
`platform.code`; any unknown value -> 400 listing the offending values, nothing written. Otherwise it replaces the
period's `usage_summary (period_id, track_id, platform_code, plays)` rows in one transaction.

---------------------------------------------------------------------------------------------------

## Auth (WP1, Member A)
| Method | Path | Role | Request | Response |
|---|---|---|---|---|
| POST | /api/auth/login | public | `{ email, password }` | 200 `{ user }` + cookie; 401 `Invalid email or password` |
| POST | /api/auth/logout | public | | 200 `{ ok: true }`, cookie cleared |
| GET | /api/auth/me | \* | | 200 `{ user }` |

`user` = `{ user_id, email, role, artist_id }` (`artist_id` is `null` unless role is `artist`).

Pages are guarded by `proxy.ts` / `middleware.ts`: no session -> redirect to `/login`; `/admin/*` needs admin,
`/me` artist, `/audit` auditor or admin.

## Catalogue (WP3, Member A)
| Method | Path | Role | Request | Response |
|---|---|---|---|---|
| GET | /api/artists | \* | `?kind=solo\|group` | `{ artists: [artist] }` sorted by name |
| POST | /api/artists | A | `{ name, kind, email? }` | 201 `{ artist }` |
| GET | /api/artists/:id | \* | | `{ artist }`; 404 |
| PATCH | /api/artists/:id | A | `{ name?, email? }` (kind cannot change) | `{ artist }` |
| DELETE | /api/artists/:id | A | | 204; 409 if still referenced (tracks, splits, logins) |
| GET | /api/artists/:id/members | A, U | | `{ members: [{ member_id, name, kind, share_pct }], total_pct }` |
| PUT | /api/artists/:id/members | A | `{ members: [{ member_id, share_pct }] }` | `{ members, total_pct }`; replaces the whole set in one transaction; 409 on sum != 100, cycle, not a group |
| GET | /api/tracks | \* | | `{ tracks: [track] }` sorted by title |
| POST | /api/tracks | A | `{ title, isrc, primary_artist_id, released_on? }` | 201 `{ track }` |
| GET | /api/tracks/:id | \* | | `{ track }`; 404 |
| PATCH | /api/tracks/:id | A | `{ title?, isrc?, primary_artist_id?, released_on? }` | `{ track }` |
| DELETE | /api/tracks/:id | A | | 204; 409 if it has contracts or usage |
| GET | /api/search | \* | `?q=` | `{ results: [{ kind: 'track'\|'artist', id, label, rank }] }` (`search_catalog`, prefix match) |

`artist` = `{ artist_id, name, kind, email, created_at }`.
`track` = `{ track_id, title, isrc, primary_artist_id, primary_artist_name, released_on, active_version }`
(`active_version` is `null` without an active contract).

## Contracts (WP4, Member A)
| Method | Path | Role | Request | Response |
|---|---|---|---|---|
| GET | /api/tracks/:id/contracts | A, U | | `{ contracts: [contract] }` newest version first |
| POST | /api/tracks/:id/contracts | A | | 201 `{ contract }`: new draft via `create_contract_draft` (copies the active splits); 409 if a draft exists |
| PUT | /api/contracts/:id/splits | A | `{ splits: [{ artist_id, share_pct }] }` | `{ contract }`; replaces the set; a draft may total less or more than 100; 409 if not a draft |
| POST | /api/contracts/:id/activate | A | | `{ contract }` via `activate_contract`; 409 if not a draft or total != 100 |
| DELETE | /api/contracts/:id | A | | 204; 409 if not a draft |
| GET | /api/tracks/:id/effective-split | A, U | | `{ track_id, contract_id, version, split: [{ artist_id, name, effective_pct, share_path }] }` via `resolve_split`; 409 without an active contract |
| GET | /api/tracks/:id/history | A, U | | `{ entries: [audit] }` for the track's contracts and splits, newest first |

`contract` = `{ contract_id, track_id, version, status, activated_at, created_at, total_share_pct,
splits: [{ artist_id, name, kind, share_pct }] }`.

## Periods and usage: MongoDB read / update / delete (WP2, Member B)
| Method | Path | Role | Request | Response |
|---|---|---|---|---|
| GET | /api/periods | A, U | | `{ periods: [period] }` newest first |
| POST | /api/periods | A | `{ label, starts_on, ends_on }` | 201 `{ period }`; 409 on overlap / duplicate label |
| GET | /api/periods/:id | A, U | | `{ period }`; 404 |
| POST | /api/periods/:id/usage/import | A | see below | 201 `{ batch_id, row_count }` |
| GET | /api/usage/batches | A, U | `?period_id=` (required) | `{ batches: [batch] }` newest first |
| GET | /api/periods/:id/usage/duplicates | A | `?batch_id=` optional (default: whole period, finds cross-batch resends) | `{ groups: [{ track_id, platform, listener_hash, played_at, count }], extra_rows }` |
| POST | /api/periods/:id/usage/void-duplicates | A | `{ batch_id? }` | `{ voided }` |
| GET | /api/periods/:id/usage/flagged | A | `?batch_id=&max_per_hour=` (default 20) | `{ listeners: [{ platform, listener_hash, hour, plays }] }` |
| POST | /api/periods/:id/usage/void-flagged | A | `{ batch_id?, max_per_hour? }` | `{ voided, listeners }` |
| DELETE | /api/periods/:id/usage/voided | A | `?batch_id=` optional | `{ deleted }` (`purgeVoided`) |
| POST | /api/usage/batches/:batchId/dispute | A | `{ note }` | `{ batch }`; 409 if aggregated |
| POST | /api/usage/batches/:batchId/resolve | A | `{ note }` | `{ batch }`; 409 if not disputed |

Every usage write refuses with 409 `Period <label> is closed` once the period is closed.

`period` = a `v_period_totals` row: `{ period_id, label, starts_on, ends_on, status, closed_at, tracks_with_usage,
total_plays, ledger_total, payout_total, payouts_paid, payouts_total }`.
`batch` = `{ batch_id, period_id, platform, source_file, uploaded_by, uploaded_at, row_count, status, notes,
counts: { valid: { events, plays }, void: { events, plays } } }`; `status` is `uploaded | cleaned | disputed | aggregated`.

### Usage import
Either `multipart/form-data` with fields `platform` and `file` (`.csv` or `.json`), or JSON
`{ platform, source_file, rows: [...] }`.
* Row fields: `track_id` (int > 0), `plays` (int >= 1), `listener_hash` (non-empty), `played_at` (ISO timestamp inside
  the period), `device` (optional). Any other CSV column / JSON key goes into `raw` unchanged.
* CSV: header row required; columns in any order.
* `platform` must exist in `platform`; every `track_id` must exist in `track`.
* All-or-nothing: if any row is invalid, nothing is stored and the response is
  400 `{ error: "3 invalid rows", details: [{ row: 2, message: "plays: must be >= 1" }, ...] }`
  (`row` is 1-based, counting data rows, not the header).

## Aggregate, close, ledger, payouts (WP5, Member B)
| Method | Path | Role | Request | Response |
|---|---|---|---|---|
| POST | /api/periods/:id/aggregate | A | `{ preview?: boolean }` | `{ rows: [{ track_id, title, platform, plays }], total_plays, written: boolean }`; 409 if closed or a batch is disputed; 400 on unknown ids |
| POST | /api/periods/:id/close | A | | `{ period, payouts: [payout] }` via `CALL close_payout_period`; 409 with the database message |
| GET | /api/periods/:id/ledger | A, U | `?artist_id=&track_id=` | `{ entries: [{ entry_id, track_id, title, artist_id, artist_name, platform_code, plays, effective_pct, amount, share_path }] }` |
| GET | /api/payouts | A, U, R | `?period_id=` | `{ payouts: [payout] }`; an artist gets only their own (RLS) |
| POST | /api/payouts/:id/pay | A | | `{ payout }` via `mark_payout_paid`; 409 `Payout 3 is already paid` |

`payout` = `{ payout_id, period_id, period_label, artist_id, artist_name, amount, status, paid_at }`.

## Artist self-service and audit (WP8, Member B)
| Method | Path | Role | Request | Response |
|---|---|---|---|---|
| GET | /api/me/statement | R | `?period_id=` optional | `{ lines: [v_artist_statement row], total }` (own rows only, by RLS) |
| GET | /api/me/payouts | R | | `{ payouts: [payout] }` |
| GET | /api/audit | U, A | `?table=&row_pk=&actor=&from=&to=&limit=` (limit default 100, max 500) | `{ entries: [audit] }` newest first |

`audit` = `{ audit_id, table_name, op, row_pk, before, after, actor, at }`.

## Pages
`/login` · Admin: `/admin/artists`, `/admin/tracks`, `/admin/tracks/[id]` (WP6), `/admin/periods`,
`/admin/periods/[id]` (WP7) · Artist: `/me` (WP8) · Auditor: `/audit` (WP8).
