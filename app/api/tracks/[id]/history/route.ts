import { withDb } from '@/lib/db';
import { json, parseId, route } from '@/lib/http';
import { assertTrack } from '@/lib/contracts';

type P = { id: string };

// Audit entries of the track's contracts and their splits (also of drafts deleted since), newest first.
export const GET = route<P>(['admin', 'auditor'], async ({ session, params }) => {
  const trackId = parseId(params.id, 'Track');
  const entries = await withDb(session, async c => {
    await assertTrack(c, trackId);
    const { rows } = await c.query(
      `WITH ids AS (
           SELECT DISTINCT row_pk FROM audit_log
           WHERE  table_name = 'contract' AND COALESCE(after, before) ->> 'track_id' = $1::text)
       SELECT audit_id, table_name, op, row_pk, before, after, actor, at
       FROM   audit_log
       WHERE  (table_name = 'contract'       AND row_pk IN (SELECT row_pk FROM ids))
          OR  (table_name = 'contract_split' AND COALESCE(after, before) ->> 'contract_id' IN (SELECT row_pk FROM ids))
       ORDER  BY audit_id DESC
       LIMIT  500`, [trackId]);
    return rows;
  });
  return json({ entries });
});
