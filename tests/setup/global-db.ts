// Vitest global setup: a scratch PostgreSQL database built from sql/init/*.sql for this run,
// so API tests never touch the dev data. Dropped again in teardown.
import { readdirSync, readFileSync } from 'node:fs';
import { Client } from 'pg';
import type { TestProject } from 'vitest/node';

const DB = `royalty_vitest_${process.pid}`;

function urlFor(db: string) {
  const u = new URL(process.env.DATABASE_URL!);
  u.pathname = '/' + db;
  return u.toString();
}

async function admin<T>(fn: (c: Client) => Promise<T>) {
  const c = new Client({ connectionString: urlFor('postgres') });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

export async function setup(project: TestProject) {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL missing (.env)');
  await admin(c => c.query(`CREATE DATABASE ${DB}`));
  const c = new Client({ connectionString: urlFor(DB) });
  await c.connect();
  try {
    await c.query(`SET client_min_messages = warning`);
    for (const f of readdirSync('sql/init').filter(f => f.endsWith('.sql')).sort()) {
      await c.query(readFileSync(`sql/init/${f}`, 'utf8'));
    }
  } finally {
    await c.end();
  }
  project.provide('databaseUrl', urlFor(DB));
}

export async function teardown() {
  await admin(c => c.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`));
}

declare module 'vitest' {
  export interface ProvidedContext { databaseUrl: string }
}
