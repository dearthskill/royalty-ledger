import { z } from 'zod';
import { withDb } from '@/lib/db';
import { ALL_ROLES, json, parseBody, parseQuery, route } from '@/lib/http';
import { ArtistCreate, listArtists } from '@/lib/catalog';

export const GET = route(ALL_ROLES, async ({ req, session }) => {
  const { kind } = parseQuery(req, z.object({ kind: z.enum(['solo', 'group']).optional() }));
  return json({ artists: await withDb(session, c => listArtists(c, kind)) });
});

export const POST = route(['admin'], async ({ req, session }) => {
  const body = await parseBody(req, ArtistCreate);
  const artist = await withDb(session, async c => (await c.query(
    `INSERT INTO artist (name, kind, email) VALUES ($1, $2, $3)
     RETURNING artist_id, name, kind, email, created_at`, [body.name, body.kind, body.email ?? null])).rows[0]);
  return json({ artist }, 201);
});
