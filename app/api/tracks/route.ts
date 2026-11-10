import { withDb } from '@/lib/db';
import { ALL_ROLES, json, parseBody, route } from '@/lib/http';
import { getTrack, TrackCreate, trackSelect } from '@/lib/catalog';

export const GET = route(ALL_ROLES, async ({ session }) => {
  const tracks = await withDb(session, async c => (await c.query(`${trackSelect(session)} ORDER BY t.title`)).rows);
  return json({ tracks });
});

export const POST = route(['admin'], async ({ req, session }) => {
  const b = await parseBody(req, TrackCreate);
  const track = await withDb(session, async c => {
    const { rows } = await c.query(
      `INSERT INTO track (title, isrc, primary_artist_id, released_on) VALUES ($1, $2, $3, $4) RETURNING track_id`,
      [b.title, b.isrc, b.primary_artist_id, b.released_on ?? null]);
    return getTrack(c, session, rows[0].track_id);
  });
  return json({ track }, 201);
});
