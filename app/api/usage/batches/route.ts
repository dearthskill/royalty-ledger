import { z } from 'zod';
import { withDb } from '@/lib/db';
import { mongoDb } from '@/lib/mongo';
import { json, parseQuery, route } from '@/lib/http';
import { Id } from '@/lib/catalog';
import { getPeriod, listBatches } from '@/lib/usage';

const Query = z.object({ period_id: Id });

export const GET = route(['admin', 'auditor'], async ({ req, session }) => {
  const { period_id } = parseQuery(req, Query);
  await withDb(session, c => getPeriod(c, period_id)); // 404 for an unknown period
  return json({ batches: await listBatches(await mongoDb(), period_id) });
});
