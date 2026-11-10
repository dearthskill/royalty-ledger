import { withDb } from '@/lib/db';
import { HttpError, json, parseBody, parseId, route } from '@/lib/http';
import { getContract, SplitsPut } from '@/lib/contracts';

type P = { id: string };

// Replaces a draft's splits in one transaction. A draft may total anything; the 100% rule
// is enforced on activation. Non-drafts are refused by the database trigger.
export const PUT = route<P>(['admin'], async ({ req, session, params }) => {
  const id = parseId(params.id, 'Contract');
  const { splits } = await parseBody(req, SplitsPut);
  const contract = await withDb(session, async c => {
    const current = await getContract(c, id);
    // an empty draft replaced by an empty list fires no trigger, so say it here too
    if (current.status !== 'draft') {
      throw new HttpError(409, `Contract ${id} is ${current.status}; splits can only be edited on a draft`);
    }
    await c.query('DELETE FROM contract_split WHERE contract_id = $1', [id]);
    for (const s of splits) {
      await c.query('INSERT INTO contract_split (contract_id, artist_id, share_pct) VALUES ($1, $2, $3)',
        [id, s.artist_id, s.share_pct]);
    }
    return getContract(c, id);
  });
  return json({ contract });
});
