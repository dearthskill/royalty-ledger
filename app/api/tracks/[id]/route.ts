import { withDb } from '@/lib/db';
import { ALL_ROLES, HttpError, json, parseBody, parseId, route } from '@/lib/http';
import { getTrack, TrackPatch } from '@/lib/catalog';

type P = { id: string };

export const GET = route<P>(ALL_ROLES, async ({ session, params }) => {
  const id = parseId(params.id, 'Track');
  return json({ track: await withDb(session, c => getTrack(c, session, id)) });
});

export const PATCH = route<P>(['admin'], async ({ req, session, params }) => {
  const id = parseId(params.id, 'Track');
  const b = await parseBody(req, TrackPatch);
  const track = await withDb(session, async c => {
    await getTrack(c, session, id);
    await c.query(
      `UPDATE track
       SET    title             = COALESCE($2, title),
              isrc              = COALESCE($3, isrc),
              primary_artist_id = COALESCE($4, primary_artist_id),
              released_on       = CASE WHEN $5 THEN $6::date ELSE released_on END
       WHERE  track_id = $1`,
      [id, b.title ?? null, b.isrc ?? null, b.primary_artist_id ?? null, b.released_on !== undefined, b.released_on ?? null]);
    return getTrack(c, session, id);
  });
  return json({ track });
});

// 409 (foreign key) once the track has contracts or usage.
export const DELETE = route<P>(['admin'], async ({ session, params }) => {
  const id = parseId(params.id, 'Track');
  await withDb(session, async c => {
    const { rowCount } = await c.query('DELETE FROM track WHERE track_id = $1', [id]);
    if (!rowCount) throw new HttpError(404, `Track ${id} not found`);
  });
  return new Response(null, { status: 204 });
});
