import { z } from 'zod';
import { mongoDb } from '@/lib/mongo';
import { json, parseBody, parseId, route } from '@/lib/http';
import { BatchId, getBatch, ops, requireOpenPeriod } from '@/lib/usage';

const Body = z.object({ batch_id: BatchId.optional() });

// UPDATE: mark every duplicate except the first-inserted event as void (reason 'duplicate').
export const POST = route<{ id: string }>(['admin'], async ({ req, session, params }) => {
  const id = parseId(params.id, 'Period');
  const { batch_id } = await parseBody(req, Body);
  await requireOpenPeriod(session, id);
  const db = await mongoDb();
  if (batch_id) await getBatch(db, batch_id, id);
  const r = await ops.voidDuplicates(db,
    batch_id ? { batchId: batch_id, userId: session.user_id } : { periodId: id, userId: session.user_id });
  return json({ voided: r.voided });
});
