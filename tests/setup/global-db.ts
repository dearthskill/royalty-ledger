// Vitest global setup: a scratch PostgreSQL database built from sql/init/*.sql and a scratch
// MongoDB database built from mongo/init/01_init.js for this run, so API tests never touch the
// dev data. Both are dropped again in teardown.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { MongoClient } from 'mongodb';
import { Client } from 'pg';
import type { TestProject } from 'vitest/node';

const DB = `royalty_vitest_${process.pid}`;
const MONGO_DB = `royalty_events_vitest_${process.pid}`;

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

  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI missing (.env)');
  execFileSync('mongosh', [process.env.MONGODB_URI, '--quiet', '--eval', `var dbName = '${MONGO_DB}'`, 'mongo/init/01_init.js']);
  project.provide('mongoDbName', MONGO_DB);
}

export async function teardown() {
  await admin(c => c.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`));
  const m = await MongoClient.connect(process.env.MONGODB_URI!);
  try { await m.db(MONGO_DB).dropDatabase(); } finally { await m.close(); }
}

declare module 'vitest' {
  export interface ProvidedContext { databaseUrl: string; mongoDbName: string }
}
