import { withDb } from '@/lib/db';
import { ALL_ROLES, json, parseQuery, route } from '@/lib/http';
import { listPayouts, PayoutQuery } from '@/lib/payouts';

// Artists may call this too: row-level security returns only their own payouts.
export const GET = route(ALL_ROLES, async ({ req, session }) => {
  const { period_id } = parseQuery(req, PayoutQuery);
  return json({ payouts: await withDb(session, c => listPayouts(c, period_id)) });
});
