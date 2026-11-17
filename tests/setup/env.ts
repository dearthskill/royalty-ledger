// Runs in every test worker: point lib/db.ts and lib/mongo.ts at this run's scratch databases.
import { inject } from 'vitest';

process.env.DATABASE_URL = inject('databaseUrl');
process.env.MONGODB_DB = inject('mongoDbName');
