// Periods (PostgreSQL) and usage batches (MongoDB) shared by the WP2 routes.
// MongoDB writes are done by mongo/pipelines/usage_ops.js; this file validates input,
// enforces "no usage changes once the period is closed" and shapes the responses.
import type { PoolClient } from 'pg';
import { ObjectId, type Db } from 'mongodb';
import { z } from 'zod';
import * as ops from '@/mongo/pipelines/usage_ops.js';
import { withDb } from './db';
import { HttpError } from './errors';
import { parseCsv } from './csv';
import type { Session } from './session';

// ---------- periods ----------
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');
export const PeriodCreate = z.object({
  label: z.string().trim().min(1).max(40),
  starts_on: IsoDate,
  ends_on: IsoDate,
});

export type Period = { period_id: number; label: string; starts_on: string; ends_on: string; status: 'open' | 'closed' };

// One v_period_totals row (the view also sums usage, ledger and payouts per period).
export async function getPeriod(c: PoolClient, id: number) {
  const { rows } = await c.query('SELECT * FROM v_period_totals WHERE period_id = $1', [id]);
  if (!rows[0]) throw new HttpError(404, `Period ${id} not found`);
  return rows[0] as Period & Record<string, unknown>;
}

// Every usage write calls this first. (usage_summary has its own trigger for closed periods;
// MongoDB has no triggers, so the app checks the PostgreSQL period status before writing.)
export async function requireOpenPeriod(session: Session, id: number): Promise<Period> {
  const period = await withDb(session, c => getPeriod(c, id));
  if (period.status === 'closed') throw new HttpError(409, `Period ${period.label} is closed`);
  return period;
}

// ---------- batches ----------
export const MaxPerHour = z.coerce.number().int().min(1).max(10_000);
export const BatchId = z.string().trim().regex(/^[0-9a-fA-F]{24}$/, 'must be a 24-character batch id');

type Counts = { events: number; plays: number };
type BatchDoc = {
  _id: ObjectId; period_id: number; platform: string; source_file: string; uploaded_by: number;
  uploaded_at: Date; row_count: number; status: string; notes: unknown[];
};

function toBatch(b: BatchDoc, counts?: Record<string, Counts>) {
  const zero = { events: 0, plays: 0 };
  return {
    batch_id: b._id.toHexString(), period_id: b.period_id, platform: b.platform, source_file: b.source_file,
    uploaded_by: b.uploaded_by, uploaded_at: b.uploaded_at, row_count: b.row_count, status: b.status, notes: b.notes,
    counts: { valid: counts?.valid ?? zero, void: counts?.void ?? zero },
  };
}

// Batches of a period, newest first, each with its valid / void event and play counts.
export async function listBatches(db: Db, periodId: number) {
  const [docs, stats] = await Promise.all([ops.listBatches(db, periodId), ops.batchStats(db, periodId)]);
  const byId = new Map(stats.map(s => [s.batch_id.toHexString(), s.by_status]));
  return (docs as unknown as BatchDoc[]).map(b => toBatch(b, byId.get(b._id.toHexString())));
}

export async function getBatch(db: Db, batchId: string, periodId?: number) {
  const bad = new HttpError(404, `Batch ${batchId} not found`);
  if (!BatchId.safeParse(batchId).success) throw bad;
  const doc = await db.collection<BatchDoc>('usage_batches').findOne({ _id: new ObjectId(batchId) });
  if (!doc || (periodId != null && doc.period_id !== periodId)) throw bad;
  const stats = await db.collection('usage_events').aggregate<{ _id: string } & Counts>([
    { $match: { batch_id: doc._id } },
    { $group: { _id: '$status', events: { $sum: 1 }, plays: { $sum: '$plays' } } },
  ]).toArray();
  return toBatch(doc, Object.fromEntries(stats.map(s => [s._id, { events: s.events, plays: s.plays }])));
}

// ---------- import ----------
// Whole numbers arrive as JSON numbers or as CSV text.
const whole = (min: number, max: number) => z.preprocess(
  v => (typeof v === 'string' && /^\s*-?\d+\s*$/.test(v) ? Number(v) : v),
  z.number({ error: 'must be a whole number' }).int('must be a whole number')
    .min(min, `must be >= ${min}`).max(max, `must be <= ${max}`));

const UsageRow = z.object({
  track_id: whole(1, 2147483647),
  plays: whole(1, 1_000_000),
  listener_hash: z.string().trim().min(1, 'is required').max(128),
  played_at: z.string().trim().pipe(z.iso.datetime({ offset: true, error: 'must be an ISO timestamp, e.g. 2026-09-12T14:05:00Z' })),
  device: z.string().trim().max(60).optional(),
});
const KNOWN = Object.keys(UsageRow.shape);
const REQUIRED = ['track_id', 'plays', 'listener_hash', 'played_at'];

export const ImportJson = z.object({
  platform: z.string().trim().min(1),
  source_file: z.string().trim().min(1).max(200),
  rows: z.array(z.record(z.string(), z.unknown())).max(100_000),
});

export type ImportInput = { platform: string; source_file: string; rows: Record<string, unknown>[] };

// Reads a multipart upload (fields `platform`, `file`) into the same shape as the JSON body.
export async function readUpload(form: FormData): Promise<ImportInput> {
  const platform = String(form.get('platform') ?? '').trim();
  const file = form.get('file');
  if (!platform) throw new HttpError(400, 'platform: is required');
  if (!(file instanceof File)) throw new HttpError(400, 'file: is required');
  if (file.size > 10 * 1024 * 1024) throw new HttpError(400, 'file: must be at most 10 MB');
  const text = await file.text();
  const name = file.name || 'upload';
  if (/\.csv$/i.test(name)) return { platform, source_file: name, rows: parseCsv(text).rows };
  if (/\.json$/i.test(name)) {
    let data: unknown;
    try { data = JSON.parse(text); } catch { throw new HttpError(400, 'file: is not valid JSON'); }
    const rows = Array.isArray(data) ? data : (data as { rows?: unknown })?.rows;
    if (!Array.isArray(rows)) throw new HttpError(400, 'file: JSON must be an array of rows or { "rows": [...] }');
    return ImportJson.parse({ platform, source_file: name, rows });
  }
  throw new HttpError(400, 'file: must be a .csv or .json file');
}

type CleanRow = { track_id: number; plays: number; listener_hash: string; played_at: Date; device?: string; raw?: Record<string, unknown> };

// Validates every row against the period and the catalogue. All-or-nothing: any invalid row
// -> 400 listing each bad row (1-based data row numbers), nothing is written.
export async function validateImport(c: PoolClient, period: Period, input: ImportInput): Promise<CleanRow[]> {
  const { rows: plat } = await c.query('SELECT code FROM platform WHERE code = $1', [input.platform]);
  if (!plat[0]) throw new HttpError(400, `platform: unknown platform "${input.platform}"`);
  if (!input.rows.length) throw new HttpError(400, 'The upload has no data rows');

  // Period window: from starts_on 00:00 UTC up to (not including) the day after ends_on.
  const from = new Date(`${period.starts_on}T00:00:00Z`);
  const to = new Date(new Date(`${period.ends_on}T00:00:00Z`).getTime() + 86_400_000);

  const errors: { row: number; message: string }[] = [];
  const clean: CleanRow[] = [];
  input.rows.forEach((r, i) => {
    const missing = REQUIRED.filter(k => r[k] == null || String(r[k]).trim() === '');
    const known = Object.fromEntries(KNOWN.filter(k => r[k] != null && String(r[k]).trim() !== '').map(k => [k, r[k]]));
    const parsed = UsageRow.safeParse(known);
    const msgs = missing.map(k => `${k}: is required`);
    if (!parsed.success) {
      for (const iss of parsed.error.issues) {
        const k = String(iss.path[0] ?? '');
        if (!missing.includes(k)) msgs.push(`${k}: ${iss.message}`);
      }
    }
    if (parsed.success) {
      const at = new Date(parsed.data.played_at);
      if (at < from || at >= to) msgs.push(`played_at: ${parsed.data.played_at} is outside period ${period.label}`);
      const extra = Object.fromEntries(Object.entries(r).filter(([k]) => !KNOWN.includes(k)));
      clean.push({ ...parsed.data, played_at: at, ...(Object.keys(extra).length ? { raw: extra } : {}) });
    }
    if (msgs.length) errors.push({ row: i + 1, message: msgs.join('; ') });
  });

  // Track ids must exist in PostgreSQL (the Mongo -> Postgres boundary is validated on the way in, too).
  if (!errors.length) {
    const ids = [...new Set(clean.map(r => r.track_id))];
    const { rows } = await c.query<{ track_id: number }>('SELECT track_id FROM track WHERE track_id = ANY($1::int[])', [ids]);
    const known = new Set(rows.map(t => t.track_id));
    clean.forEach((r, i) => {
      if (!known.has(r.track_id)) errors.push({ row: i + 1, message: `track_id: track ${r.track_id} does not exist` });
    });
  }

  if (errors.length) {
    throw new HttpError(400, `${errors.length} invalid row${errors.length === 1 ? '' : 's'}`, errors);
  }
  return clean;
}

export { ops };

// ---------- dispute / resolve ----------
export const NoteBody = z.object({ note: z.string().trim().min(1, 'is required').max(1000) });

// The updateOne filter in usage_ops is the guard (status <> 'aggregated' / status = 'disputed'),
// so check and write are one atomic operation. When nothing matched, explain why with a 409.
export async function changeDispute(session: Session, db: Db, batchId: string, action: 'dispute' | 'resolve', note: string) {
  const batch = await getBatch(db, batchId);
  await requireOpenPeriod(session, batch.period_id);
  const r = action === 'dispute'
    ? await ops.disputeBatch(db, batchId, session.user_id, note)
    : await ops.resolveDispute(db, batchId, session.user_id, note);
  if (!r.updated) {
    const now = await getBatch(db, batchId);
    throw new HttpError(409, action === 'dispute'
      ? `Batch ${batchId} is already aggregated and cannot be disputed`
      : `Batch ${batchId} is not disputed (status: ${now.status})`);
  }
  return getBatch(db, batchId);
}
