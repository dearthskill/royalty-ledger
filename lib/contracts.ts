// Contract queries shared by the contract routes. Business rules (100%, draft-only edits,
// one active contract) live in the database; these helpers only read and call it.
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { HttpError } from './errors';
import { Id, SharePct } from './catalog';

export const SplitsPut = z.object({
  splits: z.array(z.object({ artist_id: Id, share_pct: SharePct })),
}).refine(b => new Set(b.splits.map(s => s.artist_id)).size === b.splits.length,
  { message: 'each artist may appear only once', path: ['splits'] });

// One contract with its splits (share_pct as text, like every other NUMERIC we return).
const CONTRACT_SELECT = `
  SELECT o.contract_id, o.track_id, o.version, o.status, o.activated_at, o.created_at, o.total_share_pct,
         COALESCE((SELECT json_agg(json_build_object('artist_id', cs.artist_id, 'name', a.name, 'kind', a.kind,
                                                     'share_pct', cs.share_pct::text)
                                   ORDER BY cs.share_pct DESC, a.name)
                   FROM contract_split cs JOIN artist a ON a.artist_id = cs.artist_id
                   WHERE cs.contract_id = o.contract_id), '[]'::json) AS splits
  FROM   v_contract_overview o`;

export async function getContract(c: PoolClient, id: number) {
  const { rows } = await c.query(`${CONTRACT_SELECT} WHERE o.contract_id = $1`, [id]);
  if (!rows[0]) throw new HttpError(404, `Contract ${id} not found`);
  return rows[0];
}

export async function listContracts(c: PoolClient, trackId: number) {
  return (await c.query(`${CONTRACT_SELECT} WHERE o.track_id = $1 ORDER BY o.version DESC`, [trackId])).rows;
}

export async function assertTrack(c: PoolClient, trackId: number) {
  const { rowCount } = await c.query('SELECT 1 FROM track WHERE track_id = $1', [trackId]);
  if (!rowCount) throw new HttpError(404, `Track ${trackId} not found`);
}
