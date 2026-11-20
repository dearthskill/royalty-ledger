import { withDb } from '@/lib/db';
import { json, parseBody, parseId, route } from '@/lib/http';
import { ArtistTrackCreate, getArtist, getTrack, listArtistTracks } from '@/lib/catalog';
import { getContract } from '@/lib/contracts';

type P = { id: string };

// Contract shares are not visible to artists, so this list is for admin and auditor only.
export const GET = route<P>(['admin', 'auditor'], async ({ session, params }) => {
  const id = parseId(params.id, 'Artist');
  return json({ tracks: await withDb(session, c => listArtistTracks(c, id)) });
});

// Adds a track from the artist's profile, in ONE transaction:
// INSERT track -> create_contract_draft (version 1) -> INSERT the contributors' splits
// -> optionally activate_contract (the database refuses unless the splits total exactly 100%).
// Any error rolls everything back, so a failed activation leaves no half-made track behind.
export const POST = route<P>(['admin'], async ({ req, session, params }) => {
  const id = parseId(params.id, 'Artist');
  const b = await parseBody(req, ArtistTrackCreate);
  const result = await withDb(session, async c => {
    await getArtist(c, id);   // 404 first
    const { rows } = await c.query(
      `INSERT INTO track (title, isrc, primary_artist_id, released_on) VALUES ($1, $2, $3, $4) RETURNING track_id`,
      [b.title, b.isrc, id, b.released_on ?? null]);
    const trackId: number = rows[0].track_id;
    const contractId: number = (await c.query('SELECT create_contract_draft($1) AS id', [trackId])).rows[0].id;
    for (const s of b.splits) {
      await c.query('INSERT INTO contract_split (contract_id, artist_id, share_pct) VALUES ($1, $2, $3)',
        [contractId, s.artist_id, s.share_pct]);
    }
    if (b.activate) await c.query('SELECT activate_contract($1)', [contractId]);
    return { track: await getTrack(c, session, trackId), contract: await getContract(c, contractId) };
  });
  return json(result, 201);
});
