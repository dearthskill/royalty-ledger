import { withDb } from '@/lib/db';
import { json, parseQuery, route } from '@/lib/http';
import { statement, StatementQuery } from '@/lib/statements';

// Own ledger lines only: enforced by RLS, not by a WHERE clause here.
export const GET = route(['artist'], async ({ req, session }) => {
  const { period_id } = parseQuery(req, StatementQuery);
  return json(await withDb(session, c => statement(c, period_id)));
});
