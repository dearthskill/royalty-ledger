// Route-handler plumbing: role check, body/id parsing and one error mapping for every route
// (see docs/API_CONTRACT.md "Errors").
import { NextResponse } from 'next/server';
import { ZodError, type ZodType } from 'zod';
import { HttpError } from './errors';
import { requireRole, sessionFromRequest, type Role, type Session } from './session';

export { HttpError };

export const ALL_ROLES: readonly Role[] = ['admin', 'artist', 'auditor'];

// PostgreSQL SQLSTATE -> HTTP status. The database message is passed through unchanged.
const PG_STATUS: Record<string, number> = {
  P0001: 409, // RAISE EXCEPTION in a trigger / function / procedure
  '23505': 409, // unique_violation
  '23503': 409, // foreign_key_violation
  '23P01': 409, // exclusion_violation (overlapping periods)
  '23514': 400, // check_violation
  '22P02': 400, // invalid_text_representation (e.g. bad number)
  '42501': 403, // insufficient_privilege (GRANT / RLS said no)
};

export function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status });
}

export function errorResponse(err: unknown): NextResponse {
  if (err instanceof HttpError) {
    return json({ error: err.message, ...(err.details !== undefined ? { details: err.details } : {}) }, err.status);
  }
  if (err instanceof ZodError) {
    const details = err.issues.map(i => ({ path: i.path.map(String).join('.'), message: i.message }));
    const first = details[0];
    return json({ error: first.path ? `${first.path}: ${first.message}` : first.message, details }, 400);
  }
  const pg = err as { code?: string; message?: string; detail?: string };
  if (pg?.code && PG_STATUS[pg.code]) {
    return json({ error: pg.message, ...(pg.detail ? { details: pg.detail } : {}) }, PG_STATUS[pg.code]);
  }
  console.error(err);
  return json({ error: 'Internal server error' }, 500);
}

type Handler<P> = (ctx: { req: Request; session: Session; params: P }) => Promise<Response>;

// Wraps a handler: checks the session and role first, maps any thrown error to a response.
export function route<P = Record<string, string>>(roles: readonly Role[], fn: Handler<P>) {
  return async (req: Request, ctx?: { params: Promise<P> }): Promise<Response> => {
    try {
      const session = requireRole(await sessionFromRequest(req), roles);
      const params = ctx?.params ? await ctx.params : ({} as P);
      return await fn({ req, session, params });
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export async function parseBody<T>(req: Request, schema: ZodType<T>): Promise<T> {
  let data: unknown;
  try {
    data = await req.json();
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON');
  }
  return schema.parse(data);
}

export function parseQuery<T>(req: Request, schema: ZodType<T>): T {
  return schema.parse(Object.fromEntries(new URL(req.url).searchParams));
}

// Path ids: anything that is not a positive int4 cannot exist.
export function parseId(value: string, what: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 2147483647) throw new HttpError(404, `${what} ${value} not found`);
  return n;
}
