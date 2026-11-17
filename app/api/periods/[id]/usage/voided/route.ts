import { z } from 'zod';
import { mongoDb } from '@/lib/mongo';
import { json, parseId, parseQuery, route } from '@/lib/http';
import { BatchId, getBatch, ops, requireOpenPeriod } from '@/lib/usage';

const Query = z.object({ batch_id: BatchId.optional() });

// DELETE: permanently remove voided events (they never count towards money).
export const DELETE = route<{ id: string }>(['admin'], async ({ req, session, params }) => {
  const id = parseId(params.id, 'Period');
  const { batch_id } = parseQuery(req, Query);
  await requireOpenPeriod(session, id);
  const db = await mongoDb();
  if (batch_id) await getBatch(db, batch_id, id);
  const r = await ops.purgeVoided(db,
    batch_id ? { batchId: batch_id, userId: session.user_id } : { periodId: id, userId: session.user_id });
  return json({ deleted: r.deleted });
});
