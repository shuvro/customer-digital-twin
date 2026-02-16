import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE_URL = process.env.API_URL || 'http://localhost:3000';
const INPUT_DIR = join(process.cwd(), 'dataset', 'unknown-inputs');

async function ingestUnknown(): Promise<void> {
  let files: string[] = [];
  try {
    files = readdirSync(INPUT_DIR)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .map((f) => join(INPUT_DIR, f));
  } catch {
    console.error(`Directory not found: ${INPUT_DIR}`);
    process.exit(1);
  }

  console.log(`Found ${files.length} unknown input files`);
  if (files.length === 0) {
    console.log('Nothing to ingest.');
    return;
  }

  let success = 0;
  let failed = 0;

  for (const file of files) {
    const payload = JSON.parse(readFileSync(file, 'utf-8'));
    const messageId = payload.id;

    try {
      const response = await fetch(`${BASE_URL}/api/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const result = await response.json() as { action?: string; customerId?: string; message?: string };
      if (response.ok) {
        console.log(`✓ ${messageId} -> ${result.action} (customer: ${result.customerId || 'none'})`);
        success++;
      } else {
        console.error(`✗ ${messageId} -> ${response.status}: ${result.message || JSON.stringify(result)}`);
        failed++;
      }
    } catch (err) {
      console.error(`✗ ${messageId} -> ${(err as Error).message}`);
      failed++;
    }
  }

  console.log(`\nDone: ${success} succeeded, ${failed} failed`);
}

ingestUnknown().catch((err) => {
  console.error((err as Error).message);
  process.exit(1);
});
