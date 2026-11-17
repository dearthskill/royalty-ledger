import { withDb } from '@/lib/db';
import { json, route } from '@/lib/http';
import { listPayouts } from '@/lib/payouts';

// Same query as GET /api/payouts; as rl_artist the payout_artist policy leaves only own rows.
export const GET = route(['artist'], async ({ session }) => {
  return json({ payouts: await withDb(session, c => listPayouts(c)) });
});
