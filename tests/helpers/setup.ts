import { beforeAll, afterAll, beforeEach } from 'vitest';
import { buildApp } from '../../src/app.js';
import { cleanDatabase, disconnectTestDb, getTestPrisma } from './db.js';

export function createTestHarness() {
  const app = buildApp();
  const prisma = getTestPrisma();

  beforeAll(async () => { await app.ready(); });
  afterAll(async () => { await app.close(); await disconnectTestDb(); });
  beforeEach(async () => { await cleanDatabase(); });

  return { app, prisma };
}
