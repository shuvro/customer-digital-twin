import { PrismaClient } from '@prisma/client';

let testPrisma: PrismaClient | null = null;

export function getTestPrisma(): PrismaClient {
  if (!testPrisma) {
    testPrisma = new PrismaClient();
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
