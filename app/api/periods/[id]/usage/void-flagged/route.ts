import { z } from 'zod';
import { mongoDb } from '@/lib/mongo';
import { json, parseBody, parseId, route } from '@/lib/http';
import { BatchId, MaxPerHour, getBatch, ops, requireOpenPeriod } from '@/lib/usage';

const Body = z.object({ batch_id: BatchId.optional(), max_per_hour: MaxPerHour.optional() });

// UPDATE: void every event of the flagged listener-hours (reason 'bot').
export const POST = route<{ id: string }>(['admin'], async ({ req, session, params }) => {
  const id = parseId(params.id, 'Period');
  const b = await parseBody(req, Body);
  await requireOpenPeriod(session, id);
  const db = await mongoDb();
  if (b.batch_id) await getBatch(db, b.batch_id, id);
  const r = await ops.voidFlagged(db, {
    ...(b.batch_id ? { batchId: b.batch_id } : { periodId: id }),
    userId: session.user_id,
    maxPlaysPerHour: b.max_per_hour ?? ops.DEFAULT_BOT_PLAYS_PER_HOUR,
  });
  return json({ voided: r.voided, listeners: r.listeners });
});
