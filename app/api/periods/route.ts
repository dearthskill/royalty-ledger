import { withDb } from '@/lib/db';
import { json, parseBody, route } from '@/lib/http';
import { getPeriod, PeriodCreate } from '@/lib/usage';

export const GET = route(['admin', 'auditor'], async ({ session }) => {
  const periods = await withDb(session, async c =>
    (await c.query('SELECT * FROM v_period_totals ORDER BY starts_on DESC')).rows);
  return json({ periods });
});

// Overlapping dates (EXCLUDE constraint), a duplicate label (UNIQUE) or ends_on <= starts_on (CHECK)
// are rejected by PostgreSQL; the error mapping turns them into 409 / 400 with the database message.
export const POST = route(['admin'], async ({ req, session }) => {
  const b = await parseBody(req, PeriodCreate);
  const period = await withDb(session, async c => {
    const { rows } = await c.query(
      'INSERT INTO payout_period (label, starts_on, ends_on) VALUES ($1, $2, $3) RETURNING period_id',
      [b.label, b.starts_on, b.ends_on]);
    return getPeriod(c, rows[0].period_id);
  });
  return json({ period }, 201);
});
