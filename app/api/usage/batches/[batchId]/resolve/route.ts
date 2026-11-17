import { mongoDb } from '@/lib/mongo';
import { json, parseBody, route } from '@/lib/http';
import { changeDispute, NoteBody } from '@/lib/usage';

// UPDATE: resolve the dispute (batch back to 'cleaned') and append the note to its notes[] history ($push).
export const POST = route<{ batchId: string }>(['admin'], async ({ req, session, params }) => {
  const { note } = await parseBody(req, NoteBody);
  return json({ batch: await changeDispute(session, await mongoDb(), params.batchId, 'resolve', note) });
});
