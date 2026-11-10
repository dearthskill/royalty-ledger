import { defineConfig } from 'vitest/config';
import { existsSync } from 'node:fs';

// Tests talk to the local docker-compose databases; read their URLs from .env.
if (existsSync('.env')) process.loadEnvFile('.env');

export default defineConfig({
  test: {
    include: ['**/*.test.{js,ts}'],
    exclude: ['node_modules/**', '.next/**'],
    testTimeout: 20000,
    hookTimeout: 30000,
    fileParallelism: false,
  },
});
