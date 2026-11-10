import { withDb } from '@/lib/db';
import { ALL_ROLES, HttpError, json, parseBody, parseId, route } from '@/lib/http';
import { ArtistPatch, getArtist } from '@/lib/catalog';

type P = { id: string };

export const GET = route<P>(ALL_ROLES, async ({ session, params }) => {
  const id = parseId(params.id, 'Artist');
  return json({ artist: await withDb(session, c => getArtist(c, id)) });
});

export const PATCH = route<P>(['admin'], async ({ req, session, params }) => {
  const id = parseId(params.id, 'Artist');
  const body = await parseBody(req, ArtistPatch);
  const artist = await withDb(session, async c => {
    await getArtist(c, id);   // 404 first
    const { rows } = await c.query(
      `UPDATE artist
       SET    name  = COALESCE($2, name),
              email = CASE WHEN $3 THEN $4 ELSE email END
       WHERE  artist_id = $1
       RETURNING artist_id, name, kind, email, created_at`,
      [id, body.name ?? null, body.email !== undefined, body.email ?? null]);
    return rows[0];
  });
  return json({ artist });
});

// Fails with 409 (foreign key) while tracks, splits, ledger rows or a login still refer to the artist.
export const DELETE = route<P>(['admin'], async ({ session, params }) => {
  const id = parseId(params.id, 'Artist');
  await withDb(session, async c => {
    const { rowCount } = await c.query('DELETE FROM artist WHERE artist_id = $1', [id]);
    if (!rowCount) throw new HttpError(404, `Artist ${id} not found`);
  });
  return new Response(null, { status: 204 });
});
