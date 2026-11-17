import { withDb } from '@/lib/db';
import { ALL_ROLES, json, route } from '@/lib/http';

export const GET = route(ALL_ROLES, async ({ session }) => {
  const platforms = await withDb(session, async c =>
    (await c.query('SELECT code, name, rate_per_play FROM platform ORDER BY name')).rows);
  return json({ platforms });
});
