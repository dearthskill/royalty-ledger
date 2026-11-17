// Artist self-service (statement, payouts) and the audit trail.
// None of the artist queries filter by artist_id: row-level security on ledger_entry / payout
// (policies ledger_artist, payout_artist; app.artist_id set by withDb) returns only the caller's rows.
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { Id } from './catalog';

export const StatementQuery = z.object({ period_id: Id.optional() });

export async function statement(c: PoolClient, periodId?: number) {
  const { rows } = await c.query(
    `SELECT s.period_id, s.period_label, s.track_id, s.title, s.platform_code, s.plays, s.effective_pct, s.amount, s.share_path
     FROM   v_artist_statement s
     JOIN   payout_period pp ON pp.period_id = s.period_id
     WHERE  ($1::int IS NULL OR s.period_id = $1)
     ORDER  BY pp.starts_on DESC, s.title, s.platform_code, s.share_path`, [periodId ?? null]);
  const { rows: [t] } = await c.query(
    `SELECT COALESCE(SUM(amount), 0)::numeric(14,4) AS total FROM v_artist_statement WHERE ($1::int IS NULL OR period_id = $1)`,
    [periodId ?? null]);
  return { lines: rows, total: t.total as string };
}

// ---------- audit ----------
// Tables with the generic audit trigger (fn_audit); also the whitelist for the `table` filter.
export const AUDITED = ['contract', 'contract_split', 'group_member', 'payout', 'payout_period'] as const;
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');

export const AuditQuery = z.object({
  table: z.enum(AUDITED).optional(),
  row_pk: z.string().trim().min(1).max(100).optional(),
  actor: z.string().trim().min(1).max(200).optional(),
  from: Day.optional(),
  to: Day.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

// `to` is inclusive: everything before the start of the next day.
export async function listAudit(c: PoolClient, q: z.infer<typeof AuditQuery>) {
  const { rows } = await c.query(
    `SELECT audit_id, table_name, op, row_pk, before, after, actor, at
     FROM   audit_log
     WHERE  ($1::text IS NULL OR table_name = $1)
       AND  ($2::text IS NULL OR row_pk = $2)
       AND  ($3::text IS NULL OR actor ILIKE '%' || $3 || '%')
       AND  ($4::date IS NULL OR at >= $4::date)
       AND  ($5::date IS NULL OR at <  $5::date + 1)
     ORDER  BY audit_id DESC
     LIMIT  $6`,
    [q.table ?? null, q.row_pk ?? null, q.actor ?? null, q.from ?? null, q.to ?? null, q.limit]);
  return rows;
}
