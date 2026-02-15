import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const BASE_URL = process.env.API_URL || 'http://localhost:3000';
const DATASET_DIR = join(process.cwd(), 'dataset');

async function ingestAll(): Promise<void> {
  const files: string[] = [];

  for (const subdir of ['emails', 'messages', 'documents']) {
    const dirPath = join(DATASET_DIR, subdir);
    try {
      const entries = readdirSync(dirPath).filter(f => f.endsWith('.json'));
      for (const entry of entries) {
        files.push(join(dirPath, entry));
      }
    } catch {
      console.warn(`Directory not found: ${dirPath}`);
    }
  }

  console.log(`Found ${files.length} dataset files`);

  let success = 0;
  let failed = 0;

  for (const file of files) {
    const data = JSON.parse(readFileSync(file, 'utf-8'));
    const messageId = data.id;

    try {
      const response = await fetch(`${BASE_URL}/api/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      const result = await response.json() as { action?: string; customerId?: string };

      if (response.ok) {
        console.log(`✓ ${messageId} → ${result.action} (customer: ${result.customerId || 'none'})`);
        success++;
      } else {
        console.error(`✗ ${messageId} → ${response.status}: ${JSON.stringify(result)}`);
        failed++;
      }
    } catch (err) {
      console.error(`✗ ${messageId} → ${(err as Error).message}`);
      failed++;
    }
  }

  console.log(`\nDone: ${success} succeeded, ${failed} failed out of ${files.length} total`);

  // Show customer summary
  try {
    const response = await fetch(`${BASE_URL}/api/customers`);
    const data = await response.json() as { customers: Array<{ id: string; firstName: string; lastName: string; taxId: string }> };
    console.log(`\nCustomers (${data.customers.length}):`);
    for (const c of data.customers) {
      console.log(`  ${c.id}: ${c.firstName} ${c.lastName} (taxId: ${c.taxId})`);
    }
  } catch {
    console.warn('Could not fetch customer summary');
  }
}

ingestAll().catch(console.error);
