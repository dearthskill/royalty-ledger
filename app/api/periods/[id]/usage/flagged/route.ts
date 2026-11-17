import { z } from 'zod';
import { withDb } from '@/lib/db';
import { mongoDb } from '@/lib/mongo';
import { json, parseId, parseQuery, route } from '@/lib/http';
import { BatchId, MaxPerHour, getBatch, getPeriod, ops } from '@/lib/usage';

const Query = z.object({ batch_id: BatchId.optional(), max_per_hour: MaxPerHour.optional() });

// Preview of the bot heuristic: listener-hours with more than max_per_hour plays (default 20).
export const GET = route<{ id: string }>(['admin'], async ({ req, session, params }) => {
  const id = parseId(params.id, 'Period');
  const q = parseQuery(req, Query);
  await withDb(session, c => getPeriod(c, id));
  const db = await mongoDb();
  if (q.batch_id) await getBatch(db, q.batch_id, id);
  const found = await ops.findFlagged(db, {
    ...(q.batch_id ? { batchId: q.batch_id } : { periodId: id }),
    maxPlaysPerHour: q.max_per_hour ?? ops.DEFAULT_BOT_PLAYS_PER_HOUR,
  });
  return json({ listeners: found.map(({ platform, listener_hash, hour, plays }) => ({ platform, listener_hash, hour, plays })) });
});
