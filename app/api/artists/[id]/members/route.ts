import { withDb } from '@/lib/db';
import { json, parseBody, parseId, route } from '@/lib/http';
import { listMembers, MembersPut } from '@/lib/catalog';

type P = { id: string };

export const GET = route<P>(['admin', 'auditor'], async ({ session, params }) => {
  const id = parseId(params.id, 'Artist');
  return json(await withDb(session, c => listMembers(c, id)));
});

// Replaces the whole member set in one transaction. The database checks, at COMMIT,
// that the shares total exactly 100 and that no cycle is created (errors -> 409).
export const PUT = route<P>(['admin'], async ({ req, session, params }) => {
  const id = parseId(params.id, 'Artist');
  const { members } = await parseBody(req, MembersPut);
  const result = await withDb(session, async c => {
    await listMembers(c, id);   // 404 / 409 for unknown or solo artists
    await c.query('DELETE FROM group_member WHERE group_id = $1', [id]);
    for (const m of members) {
      await c.query('INSERT INTO group_member (group_id, member_id, share_pct) VALUES ($1, $2, $3)',
        [id, m.member_id, m.share_pct]);
    }
    await c.query('SET CONSTRAINTS ALL IMMEDIATE');   // run the deferred 100% check now, inside this handler
    return listMembers(c, id);
  });
  return json(result);
});
