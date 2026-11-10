import { withDb } from '@/lib/db';
import { HttpError, json, parseId, route } from '@/lib/http';
import { getContract } from '@/lib/contracts';

type P = { id: string };

export const GET = route<P>(['admin', 'auditor'], async ({ session, params }) => {
  const id = parseId(params.id, 'Contract');
  return json({ contract: await withDb(session, c => getContract(c, id)) });
});

// Only drafts can be deleted; the trigger refuses anything else (409, database message).
export const DELETE = route<P>(['admin'], async ({ session, params }) => {
  const id = parseId(params.id, 'Contract');
  await withDb(session, async c => {
    const { rowCount } = await c.query('DELETE FROM contract WHERE contract_id = $1', [id]);
    if (!rowCount) throw new HttpError(404, `Contract ${id} not found`);
  });
  return new Response(null, { status: 204 });
});
