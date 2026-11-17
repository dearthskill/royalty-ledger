import { withDb } from '@/lib/db';
import { json, parseId, parseQuery, route } from '@/lib/http';
import { LedgerQuery, listLedger } from '@/lib/payouts';
import { getPeriod } from '@/lib/usage';

export const GET = route<{ id: string }>(['admin', 'auditor'], async ({ req, session, params }) => {
  const id = parseId(params.id, 'Period');
  const q = parseQuery(req, LedgerQuery);
  const entries = await withDb(session, async c => {
    await getPeriod(c, id);
    return listLedger(c, id, q);
  });
  return json({ entries });
});
