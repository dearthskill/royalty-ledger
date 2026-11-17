import { mongoDb } from '@/lib/mongo';
import { json, parseBody, parseId, route } from '@/lib/http';
import { aggregate, AggregateBody } from '@/lib/payouts';

// MongoDB aggregateUsage -> { track_id, platform, plays } -> usage_summary (or just a preview).
export const POST = route<{ id: string }>(['admin'], async ({ req, session, params }) => {
  const id = parseId(params.id, 'Period');
  const { preview } = await parseBody(req, AggregateBody);
  return json(await aggregate(session, await mongoDb(), id, preview ?? false));
});
