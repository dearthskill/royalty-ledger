// Aggregate (MongoDB -> usage_summary), close, ledger and payouts.
// The money rules live in PostgreSQL (close_payout_period, mark_payout_paid, triggers, RLS);
// these helpers only call them and shape the results.
import type { PoolClient } from 'pg';
import type { Db } from 'mongodb';
import { z } from 'zod';
import { withDb } from './db';
import { HttpError } from './errors';
import { Id } from './catalog';
import { getPeriod, ops } from './usage';
import type { Session } from './session';

export const AggregateBody = z.object({ preview: z.boolean().optional() });
export const LedgerQuery = z.object({ artist_id: Id.optional(), track_id: Id.optional() });
export const PayoutQuery = z.object({ period_id: Id.optional() });

type UsageRow = { track_id: number; platform: string; plays: number };

// Checks the { track_id, platform, plays } rows from MongoDB against the catalogue.
// Returns the rows with track titles; any unknown id -> 400 listing the offending values.
async function checkUsage(c: PoolClient, rows: UsageRow[]) {
  const { rows: tracks } = await c.query<{ track_id: number; title: string }>(
    'SELECT track_id, title FROM track WHERE track_id = ANY($1::int[])', [[...new Set(rows.map(r => r.track_id))]]);
  const { rows: plats } = await c.query<{ code: string }>(
    'SELECT code FROM platform WHERE code = ANY($1::text[])', [[...new Set(rows.map(r => r.platform))]]);
  const title = new Map(tracks.map(t => [t.track_id, t.title]));
  const codes = new Set(plats.map(p => p.code));
  const badTracks = [...new Set(rows.filter(r => !title.has(r.track_id)).map(r => r.track_id))];
  const badPlatforms = [...new Set(rows.filter(r => !codes.has(r.platform)).map(r => r.platform))];
  if (badTracks.length || badPlatforms.length) {
    const parts = [badTracks.length && `unknown track_id ${badTracks.join(', ')}`,
                   badPlatforms.length && `unknown platform ${badPlatforms.join(', ')}`].filter(Boolean);
    throw new HttpError(400, `Usage cannot be aggregated: ${parts.join('; ')}`,
      { track_ids: badTracks, platforms: badPlatforms });
  }
  return rows.map(r => ({ track_id: r.track_id, title: title.get(r.track_id)!, platform: r.platform, plays: r.plays }));
}

export async function aggregate(session: Session, db: Db, periodId: number, preview: boolean) {
  const period = await withDb(session, c => getPeriod(c, periodId));
  if (period.status === 'closed') throw new HttpError(409, `Period ${period.label} is closed`);
  const disputed = await db.collection('usage_batches')
    .find({ period_id: periodId, status: 'disputed' }, { projection: { source_file: 1 } }).toArray();
  if (disputed.length) {
    throw new HttpError(409, `Period ${period.label} has disputed batches (${disputed.map(b => b.source_file).join(', ')}); resolve them first`);
  }

  const usage = await ops.aggregateUsage(db, periodId);
  const total_plays = usage.reduce((n, r) => n + r.plays, 0);
  if (preview) {
    const rows = await withDb(session, c => checkUsage(c, usage));
    return { rows, total_plays, written: false };
  }
  if (!usage.length) throw new HttpError(409, `Period ${period.label} has no valid usage to aggregate`);

  const rows = await withDb(session, async c => {
    // Same row lock as close_payout_period, so aggregate and close cannot interleave.
    const { rows: [p] } = await c.query('SELECT status, label FROM payout_period WHERE period_id = $1 FOR UPDATE', [periodId]);
    if (p.status === 'closed') throw new HttpError(409, `Period ${p.label} is closed`);
    const checked = await checkUsage(c, usage);
    // Replace the period's summary in this one transaction (trg_usage_period_open guards closed periods too).
    await c.query('DELETE FROM usage_summary WHERE period_id = $1', [periodId]);
    await c.query(
      `INSERT INTO usage_summary (period_id, track_id, platform_code, plays)
       SELECT $1, * FROM unnest($2::int[], $3::text[], $4::bigint[])`,
      [periodId, usage.map(r => r.track_id), usage.map(r => r.platform), usage.map(r => r.plays)]);
    return checked;
  });
  // After the PostgreSQL commit. If this fails the batches just stay 'cleaned';
  // aggregating again rewrites the same summary, so nothing is counted twice.
  await ops.markAggregated(db, periodId, session.user_id);
  return { rows, total_plays, written: true };
}

// ---------- payouts ----------
const PAYOUT_SELECT = `
  SELECT po.payout_id, po.period_id, pp.label AS period_label, po.artist_id, a.name AS artist_name,
         po.amount, po.status, po.paid_at
  FROM   payout po
  JOIN   payout_period pp ON pp.period_id = po.period_id
  JOIN   artist a         ON a.artist_id  = po.artist_id`;

// For an artist, RLS (policy payout_artist) leaves only their own rows; no WHERE needed here.
export async function listPayouts(c: PoolClient, periodId?: number) {
  const { rows } = await c.query(
    `${PAYOUT_SELECT} WHERE ($1::int IS NULL OR po.period_id = $1) ORDER BY pp.starts_on DESC, a.name`,
    [periodId ?? null]);
  return rows;
}

export async function getPayout(c: PoolClient, id: number) {
  const { rows } = await c.query(`${PAYOUT_SELECT} WHERE po.payout_id = $1`, [id]);
  if (!rows[0]) throw new HttpError(404, `Payout ${id} not found`);
  return rows[0];
}

export async function listLedger(c: PoolClient, periodId: number, q: z.infer<typeof LedgerQuery>) {
  const { rows } = await c.query(
    `SELECT le.entry_id, le.track_id, t.title, le.artist_id, a.name AS artist_name, le.platform_code,
            le.plays, le.effective_pct, le.amount, le.share_path
     FROM   ledger_entry le
     JOIN   track t  ON t.track_id  = le.track_id
     JOIN   artist a ON a.artist_id = le.artist_id
     WHERE  le.period_id = $1
       AND  ($2::int IS NULL OR le.artist_id = $2)
       AND  ($3::int IS NULL OR le.track_id = $3)
     ORDER  BY t.title, le.platform_code, a.name, le.entry_id`,
    [periodId, q.artist_id ?? null, q.track_id ?? null]);
  return rows;
}
