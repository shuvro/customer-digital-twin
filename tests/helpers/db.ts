import { PrismaClient } from '../../src/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';

let testPrisma: PrismaClient | null = null;

export function getTestPrisma(): PrismaClient {
  if (!testPrisma) {
    const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
    testPrisma = new PrismaClient({ adapter });
  }
  return testPrisma;
}

export async function cleanDatabase(): Promise<void> {
  const prisma = getTestPrisma();
  // Use raw SQL to truncate all tables in the correct order
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE "CustomerInsight", "CustomerAttribute", "CustomerIdentity", "Message", "Customer" CASCADE
  `);
}

export async function disconnectTestDb(): Promise<void> {
  if (testPrisma) {
    await testPrisma.$disconnect();
    testPrisma = null;
  }
}
