import { withDb } from '@/lib/db';
import { json, parseId, route } from '@/lib/http';
import { listPayouts } from '@/lib/payouts';
import { getPeriod } from '@/lib/usage';

// CALL close_payout_period: ledger entries + payouts + period closed, in one transaction.
// Its RAISE EXCEPTION messages (already closed, no usage, no active contract) come back as 409.
export const POST = route<{ id: string }>(['admin'], async ({ session, params }) => {
  const id = parseId(params.id, 'Period');
  const result = await withDb(session, async c => {
    await getPeriod(c, id);
    await c.query('CALL close_payout_period($1)', [id]);
    return { period: await getPeriod(c, id), payouts: await listPayouts(c, id) };
  });
  return json(result);
});
