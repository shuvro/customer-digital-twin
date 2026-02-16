import { PrismaClient } from './generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';

const isTest = process.env.NODE_ENV === 'test';

if (!isTest && !process.env.DATABASE_URL) {
  console.error('FATAL: DATABASE_URL environment variable is required but not set.');
  process.exit(1);
}

const connectionString = process.env.DATABASE_URL || 'postgresql://localhost:5432/placeholder';
const adapter = new PrismaPg({ connectionString });
export const prisma = new PrismaClient({ adapter });

export async function disconnectDb(): Promise<void> {
  await prisma.$disconnect();
}
