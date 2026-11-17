import { withDb } from '@/lib/db';
import { mongoDb } from '@/lib/mongo';
import { json, parseBody, parseId, route } from '@/lib/http';
import { ImportJson, ops, readUpload, requireOpenPeriod, validateImport, type ImportInput } from '@/lib/usage';

// Upload one platform report (CSV / JSON file, or a JSON body) as a new usage batch.
// Every row is validated first; one bad row rejects the whole batch with row numbers.
export const POST = route<{ id: string }>(['admin'], async ({ req, session, params }) => {
  const id = parseId(params.id, 'Period');
  const period = await requireOpenPeriod(session, id);
  const input: ImportInput = (req.headers.get('content-type') ?? '').includes('multipart/form-data')
    ? await readUpload(await req.formData())
    : await parseBody(req, ImportJson);
  const rows = await withDb(session, c => validateImport(c, period, input));
  const r = await ops.ingest(await mongoDb(),
    { period_id: id, platform: input.platform, source_file: input.source_file, uploaded_by: session.user_id }, rows);
  return json({ batch_id: r.batch_id.toHexString(), row_count: r.row_count }, 201);
});
