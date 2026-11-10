// Catalogue queries shared by the artist, track and search routes.
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { HttpError } from './errors';
import type { Session } from './session';

// ---------- validation ----------
// Percentages: > 0 and <= 100 with at most 2 decimals (NUMERIC(5,2)); sent on as strings.
export const SharePct = z.union([z.number(), z.string().trim().regex(/^\d+(\.\d+)?$/).transform(Number)])
  .pipe(z.number().gt(0, 'must be greater than 0').lte(100, 'must be at most 100')
    .refine(n => Math.abs(Math.round(n * 100) - n * 100) < 1e-6, 'at most 2 decimals'))
  .transform(n => n.toFixed(2));

export const Id = z.coerce.number().int().positive();
const Email = z.string().trim().toLowerCase().pipe(z.email());
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');

export const ArtistCreate = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.enum(['solo', 'group']),
  email: Email.nullish(),
});
export const ArtistPatch = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  email: Email.nullable().optional(),
}).strict();

export const MembersPut = z.object({
  members: z.array(z.object({ member_id: Id, share_pct: SharePct })),
}).refine(b => new Set(b.members.map(m => m.member_id)).size === b.members.length,
  { message: 'each member may appear only once', path: ['members'] });

export const TrackCreate = z.object({
  title: z.string().trim().min(1).max(200),
  isrc: z.string().trim().toUpperCase().regex(/^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$/, 'must look like INABC2600001'),
  primary_artist_id: Id,
  released_on: IsoDate.nullish(),
});
export const TrackPatch = TrackCreate.partial().strict();

// ---------- artists ----------
const ARTIST_COLS = 'artist_id, name, kind, email, created_at';

export async function listArtists(c: PoolClient, kind?: 'solo' | 'group') {
  const { rows } = await c.query(
    `SELECT ${ARTIST_COLS} FROM artist WHERE ($1::text IS NULL OR kind = $1) ORDER BY name`, [kind ?? null]);
  return rows;
}

export async function getArtist(c: PoolClient, id: number) {
  const { rows } = await c.query(`SELECT ${ARTIST_COLS} FROM artist WHERE artist_id = $1`, [id]);
  if (!rows[0]) throw new HttpError(404, `Artist ${id} not found`);
  return rows[0];
}

export async function listMembers(c: PoolClient, groupId: number) {
  const artist = await getArtist(c, groupId);
  if (artist.kind !== 'group') throw new HttpError(409, `${artist.name} is a solo artist and has no members`);
  const { rows } = await c.query(
    `SELECT gm.member_id, a.name, a.kind, gm.share_pct
     FROM   group_member gm JOIN artist a ON a.artist_id = gm.member_id
     WHERE  gm.group_id = $1
     ORDER  BY gm.share_pct DESC, a.name`, [groupId]);
  const total = rows.reduce((s, r) => s + Number(r.share_pct), 0);
  return { members: rows, total_pct: total.toFixed(2) };
}

// ---------- tracks ----------
// Artists have no access to contracts, so active_version is only looked up for admin/auditor.
export function trackSelect(session: Session) {
  const activeVersion = session.role === 'artist'
    ? 'NULL::int AS active_version'
    : `(SELECT c.version FROM contract c WHERE c.track_id = t.track_id AND c.status = 'active') AS active_version`;
  return `SELECT t.track_id, t.title, t.isrc, t.primary_artist_id, a.name AS primary_artist_name, t.released_on, ${activeVersion}
          FROM   track t JOIN artist a ON a.artist_id = t.primary_artist_id`;
}

export async function getTrack(c: PoolClient, session: Session, id: number) {
  const { rows } = await c.query(`${trackSelect(session)} WHERE t.track_id = $1`, [id]);
  if (!rows[0]) throw new HttpError(404, `Track ${id} not found`);
  return rows[0];
}
