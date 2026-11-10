import { defineConfig } from 'vitest/config';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Tests talk to the local docker-compose databases; read their URLs from .env.
if (existsSync('.env')) process.loadEnvFile('.env');

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  test: {
    include: ['**/*.test.{js,ts}'],
    exclude: ['node_modules/**', '.next/**'],
    globalSetup: ['tests/setup/global-db.ts'],   // scratch PostgreSQL database per run
    setupFiles: ['tests/setup/env.ts'],
    testTimeout: 20000,
    hookTimeout: 30000,
    fileParallelism: false,
  },
});
