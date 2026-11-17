import { withDb } from '@/lib/db';
import { json, parseId, route } from '@/lib/http';
import { getPeriod } from '@/lib/usage';

export const GET = route<{ id: string }>(['admin', 'auditor'], async ({ session, params }) => {
  const id = parseId(params.id, 'Period');
  return json({ period: await withDb(session, c => getPeriod(c, id)) });
});
