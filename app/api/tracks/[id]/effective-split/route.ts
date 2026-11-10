import { withDb } from '@/lib/db';
import { json, parseId, route } from '@/lib/http';
import { assertTrack } from '@/lib/contracts';

type P = { id: string };

// Who really gets what under the active contract, through nested groups (resolve_split, recursive CTE).
export const GET = route<P>(['admin', 'auditor'], async ({ session, params }) => {
  const trackId = parseId(params.id, 'Track');
  const result = await withDb(session, async c => {
    await assertTrack(c, trackId);
    const { rows } = await c.query(
      `SELECT rs.artist_id, a.name, round(rs.effective_pct, 4)::text AS effective_pct, rs.path AS share_path
       FROM   resolve_split($1) rs JOIN artist a ON a.artist_id = rs.artist_id
       ORDER  BY rs.effective_pct DESC, rs.path`, [trackId]);
    const { rows: [active] } = await c.query(
      `SELECT contract_id, version FROM contract WHERE track_id = $1 AND status = 'active'`, [trackId]);
    return { track_id: trackId, contract_id: active.contract_id, version: active.version, split: rows };
  });
  return json(result);
});
