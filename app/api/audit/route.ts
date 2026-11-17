import { withDb } from '@/lib/db';
import { json, parseQuery, route } from '@/lib/http';
import { AuditQuery, listAudit } from '@/lib/statements';

export const GET = route(['auditor', 'admin'], async ({ req, session }) => {
  const q = parseQuery(req, AuditQuery);
  return json({ entries: await withDb(session, c => listAudit(c, q)) });
});
