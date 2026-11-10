import { withDb } from '@/lib/db';
import { json, parseId, route } from '@/lib/http';
import { getContract } from '@/lib/contracts';

type P = { id: string };

// activate_contract: exactly 100% or 409; supersedes the old active version in the same transaction.
export const POST = route<P>(['admin'], async ({ session, params }) => {
  const id = parseId(params.id, 'Contract');
  const contract = await withDb(session, async c => {
    await getContract(c, id);   // 404 for unknown ids
    await c.query('SELECT activate_contract($1)', [id]);
    return getContract(c, id);
  });
  return json({ contract });
});
