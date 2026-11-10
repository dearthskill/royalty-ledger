import { z } from 'zod';
import { withDb } from '@/lib/db';
import { ALL_ROLES, json, parseQuery, route } from '@/lib/http';

// Full-text search over tracks and artists (search_catalog: prefix match, ranked).
export const GET = route(ALL_ROLES, async ({ req, session }) => {
  const { q } = parseQuery(req, z.object({ q: z.string().max(200).default('') }));
  const results = await withDb(session, async c =>
    (await c.query('SELECT kind, id, label, rank FROM search_catalog($1) LIMIT 20', [q])).rows);
  return json({ results });
});
