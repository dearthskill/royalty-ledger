// Runs in every test worker: point lib/db.ts at this run's scratch database.
import { inject } from 'vitest';

process.env.DATABASE_URL = inject('databaseUrl');
