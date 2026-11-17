import { withDb } from '@/lib/db';
import { json, parseId, route } from '@/lib/http';
import { getPayout } from '@/lib/payouts';

// mark_payout_paid locks the row (SELECT ... FOR UPDATE), so of two concurrent requests
// one pays and the other gets 409 'Payout N is already paid'.
export const POST = route<{ id: string }>(['admin'], async ({ session, params }) => {
  const id = parseId(params.id, 'Payout');
  const payout = await withDb(session, async c => {
    await getPayout(c, id);
    await c.query('SELECT mark_payout_paid($1)', [id]);
    return getPayout(c, id);
  });
  return json({ payout });
});
