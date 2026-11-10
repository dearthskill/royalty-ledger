// PostgreSQL access. Every request runs inside withDb(), which switches to the
// database role of the logged-in user, so GRANTs and row-level security apply
// on top of the checks in the route handlers.
import { Pool, types, type PoolClient } from 'pg';
import type { Session } from './session';

// Keep DATE as 'YYYY-MM-DD' (no time-zone shifts) and BIGINT counts as numbers.
// NUMERIC (money, shares) stays a string so no precision is lost.
types.setTypeParser(1082, v => v);
types.setTypeParser(20, v => Number(v));

const globalForPg = globalThis as unknown as { pgPool?: Pool };

export function pool(): Pool {
  if (!globalForPg.pgPool) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
    globalForPg.pgPool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
  }
  return globalForPg.pgPool;
}

// Whitelist: the role name is never taken from input.
const DB_ROLE = { admin: 'rl_admin', artist: 'rl_artist', auditor: 'rl_auditor' } as const;

export async function withDb<T>(session: Session, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const dbRole = DB_ROLE[session.role];
  if (!dbRole) throw new Error(`Unknown role ${session.role}`);
  const client = await pool().connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL ROLE ${dbRole}`);
    // third argument true = local to this transaction
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [String(session.user_id)]);
    if (session.role === 'artist') {
      await client.query(`SELECT set_config('app.artist_id', $1, true)`, [String(session.artist_id)]);
    }
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// The one query that runs as the owner role: looking up a login. App roles cannot read app_user.
export async function findLogin(email: string) {
  const { rows } = await pool().query<{
    user_id: number; email: string; password_hash: string; role: Session['role']; artist_id: number | null;
  }>('SELECT user_id, email, password_hash, role, artist_id FROM app_user WHERE lower(email) = lower($1)', [email]);
  return rows[0] ?? null;
}
