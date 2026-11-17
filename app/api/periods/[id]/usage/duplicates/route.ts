import { z } from 'zod';
import { withDb } from '@/lib/db';
import { mongoDb } from '@/lib/mongo';
import { json, parseId, parseQuery, route } from '@/lib/http';
import { BatchId, getBatch, getPeriod, ops } from '@/lib/usage';

const Query = z.object({ batch_id: BatchId.optional() });

// Preview: groups of valid events reporting the same play (track, platform, listener, timestamp).
// Without batch_id the whole period is searched, so a report uploaded twice is found too.
export const GET = route<{ id: string }>(['admin'], async ({ req, session, params }) => {
  const id = parseId(params.id, 'Period');
  const { batch_id } = parseQuery(req, Query);
  await withDb(session, c => getPeriod(c, id));
  const db = await mongoDb();
  if (batch_id) await getBatch(db, batch_id, id);
  const found = await ops.findDuplicates(db, batch_id ? { batchId: batch_id } : { periodId: id });
  const groups = found.map(({ track_id, platform, listener_hash, played_at, count }) =>
    ({ track_id, platform, listener_hash, played_at, count }));
  return json({ groups, extra_rows: groups.reduce((n, g) => n + g.count - 1, 0) });
});
