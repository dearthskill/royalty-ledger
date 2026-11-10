import { withDb } from '@/lib/db';
import { json, parseId, route } from '@/lib/http';
import { assertTrack, getContract, listContracts } from '@/lib/contracts';

type P = { id: string };

export const GET = route<P>(['admin', 'auditor'], async ({ session, params }) => {
  const trackId = parseId(params.id, 'Track');
  const contracts = await withDb(session, async c => {
    await assertTrack(c, trackId);
    return listContracts(c, trackId);
  });
  return json({ contracts });
});

// New draft = next version with the active splits copied in (create_contract_draft).
// 409 if the track already has a draft.
export const POST = route<P>(['admin'], async ({ session, params }) => {
  const trackId = parseId(params.id, 'Track');
  const contract = await withDb(session, async c => {
    await assertTrack(c, trackId);
    const { rows } = await c.query('SELECT create_contract_draft($1) AS id', [trackId]);
    return getContract(c, rows[0].id);
  });
  return json({ contract }, 201);
});
