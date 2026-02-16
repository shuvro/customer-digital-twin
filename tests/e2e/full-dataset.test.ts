import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

vi.mock('../../src/llm/retry.js', () => ({
  callWithRetryAndFallback: vi.fn(async (opts: { userPrompt: string }) => {
    const { mockExtraction } = await import('../helpers/llm-mock.js');
    return JSON.stringify(mockExtraction(opts.userPrompt));
  }),
}));

import { createTestHarness } from '../helpers/setup.js';

const { app, prisma } = createTestHarness();
const DATASET_DIR = join(process.cwd(), 'dataset');

function loadDatasetMessages(): Array<Record<string, unknown>> {
  const messages: Array<Record<string, unknown>> = [];
  for (const subdir of ['emails', 'messages', 'documents']) {
    const dirPath = join(DATASET_DIR, subdir);
    try {
      const files = readdirSync(dirPath).filter(f => f.endsWith('.json'));
      for (const file of files) {
        messages.push(JSON.parse(readFileSync(join(dirPath, file), 'utf-8')));
      }
    } catch {
      // skip
    }
  }
  return messages;
}

describe('Full Dataset E2E', () => {
  it('ingests all 15 messages and produces exactly 2 customers', async () => {
    const messages = loadDatasetMessages();
    expect(messages.length).toBe(15);

    // Shuffle to test non-chronological arrival
    const shuffled = [...messages].sort(() => Math.random() - 0.5);

    for (const msg of shuffled) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/messages',
        payload: msg,
      });
      expect(response.statusCode).toBe(200);
    }

    // Verify exactly 2 customers
    const customers = await prisma.customer.findMany({
      include: {
        identities: true,
        attributes: true,  // All attributes (current + history)
        insights: true,
      },
    });

    expect(customers).toHaveLength(2);

    // Find Maria and Thomas
    const maria = customers.find(c => c.firstName === 'María');
    const thomas = customers.find(c => c.firstName === 'Thomas');

    expect(maria).toBeTruthy();
    expect(thomas).toBeTruthy();

    // === María's Identity (Immutable) ===
    expect(maria!.lastName).toBe('García López');
    expect(maria!.taxId).toBe('12345678A');
    expect(maria!.nationality).toBe('Spanish');
    expect(maria!.gender).toBe('Female');
    expect(maria!.dateOfBirth).toBeTruthy();
    expect(maria!.dateOfBirth!.toISOString()).toContain('1985-03-14');

    // === María's Mutable Attributes (latest messageDate wins) ===
    const mariaEmails = maria!.attributes.filter(a => a.field === 'email' && a.isCurrent);
    expect(mariaEmails).toHaveLength(1);
    expect(mariaEmails[0].value).toBe('maria.garcia@email.com');

    const mariaPhones = maria!.attributes.filter(a => a.field === 'phone' && a.isCurrent);
    expect(mariaPhones).toHaveLength(1);
    // Latest phone from doc-003 (Jul 2025)
    expect(mariaPhones[0].value).toContain('+49');

    const mariaAddresses = maria!.attributes.filter(a => a.field === 'address' && a.isCurrent);
    expect(mariaAddresses.length).toBeGreaterThanOrEqual(1);

    // Scalar mutable: latest messageDate wins
    const mariaMarital = maria!.attributes.filter(a => a.field === 'maritalStatus' && a.isCurrent);
    expect(mariaMarital).toHaveLength(1);
    expect(mariaMarital[0].value).toBe('Married');

    const mariaOccupation = maria!.attributes.filter(a => a.field === 'occupation' && a.isCurrent);
    if (mariaOccupation.length > 0) {
      expect(mariaOccupation[0].value).toBe('Senior Software Engineer');
    }

    const mariaEmployer = maria!.attributes.filter(a => a.field === 'employer' && a.isCurrent);
    if (mariaEmployer.length > 0) {
      expect(mariaEmployer[0].value).toBe('TechCorp GmbH');
    }

    // === María's Insights (accumulated) ===
    const mariaHobbies = maria!.insights.filter(i => i.field === 'hobbies').map(i => i.value);
    expect(mariaHobbies).toContain('hiking');
    expect(mariaHobbies).toContain('cooking');

    const mariaNeeds = maria!.insights.filter(i => i.field === 'needs').map(i => i.value);
    expect(mariaNeeds.length).toBeGreaterThanOrEqual(1);
    expect(mariaNeeds).toContain('life insurance');

    // === Thomas's Identity (Immutable) ===
    expect(thomas!.lastName).toBe('Weber');
    expect(thomas!.taxId).toBe('65 432 187 909');
    expect(thomas!.nationality).toBe('German');
    expect(thomas!.gender).toBe('Male');
    expect(thomas!.dateOfBirth).toBeTruthy();
    expect(thomas!.dateOfBirth!.toISOString()).toContain('1978-07-22');

    // === Thomas's Mutable Attributes ===
    const thomasEmails = thomas!.attributes.filter(a => a.field === 'email' && a.isCurrent);
    if (thomasEmails.length > 0) {
      expect(thomasEmails.map(e => e.value)).toContain('t.weber@business.de');
    }

    const thomasPhones = thomas!.attributes.filter(a => a.field === 'phone' && a.isCurrent);
    expect(thomasPhones.length).toBeGreaterThanOrEqual(1);

    const thomasAddresses = thomas!.attributes.filter(a => a.field === 'address' && a.isCurrent);
    expect(thomasAddresses.length).toBeGreaterThanOrEqual(1);

    const thomasMarital = thomas!.attributes.filter(a => a.field === 'maritalStatus' && a.isCurrent);
    if (thomasMarital.length > 0) {
      expect(thomasMarital[0].value).toBe('Divorced');
    }

    const thomasOccupation = thomas!.attributes.filter(a => a.field === 'occupation' && a.isCurrent);
    if (thomasOccupation.length > 0) {
      expect(thomasOccupation[0].value).toBe('Senior Accountant');
    }

    const thomasEmployer = thomas!.attributes.filter(a => a.field === 'employer' && a.isCurrent);
    if (thomasEmployer.length > 0) {
      expect(thomasEmployer[0].value).toBe('FinanzBeratung AG');
    }

    // === Thomas's Insights (accumulated) ===
    const thomasHobbies = thomas!.insights.filter(i => i.field === 'hobbies').map(i => i.value);
    expect(thomasHobbies).toContain('cycling');
    expect(thomasHobbies).toContain('photography');

    const thomasRisks = thomas!.insights.filter(i => i.field === 'riskIndicators').map(i => i.value);
    expect(thomasRisks).toContain('motorcycle rider');

    const thomasNeeds = thomas!.insights.filter(i => i.field === 'needs').map(i => i.value);
    expect(thomasNeeds.length).toBeGreaterThanOrEqual(1);
    expect(thomasNeeds).toContain('health insurance');

    const thomasFamily = thomas!.insights.filter(i => i.field === 'familyContext').map(i => i.value);
    expect(thomasFamily.length).toBeGreaterThanOrEqual(1);

    // === Attribute History Depth ===
    // Verify history is preserved (more than just current values)
    const allMariaAttrs = maria!.attributes;
    const allThomasAttrs = thomas!.attributes;
    // Multiple messages should generate multiple attribute entries
    expect(allMariaAttrs.length).toBeGreaterThan(mariaEmails.length + mariaPhones.length);
    expect(allThomasAttrs.length).toBeGreaterThan(thomasEmails.length + thomasPhones.length);

    // === Message Integrity ===
    const allMessages = await prisma.message.findMany();
    expect(allMessages).toHaveLength(15);
    for (const msg of allMessages) {
      expect(msg.status).toBe('COMPLETED');
    }

    // Every message should link to a customer
    const linkedMessages = allMessages.filter(m => m.customerId !== null);
    expect(linkedMessages).toHaveLength(15);

    // Messages should be split between the two customers
    const mariaMessages = allMessages.filter(m => m.customerId === maria!.id);
    const thomasMessages = allMessages.filter(m => m.customerId === thomas!.id);
    expect(mariaMessages.length + thomasMessages.length).toBe(15);
    expect(mariaMessages.length).toBeGreaterThanOrEqual(1);
    expect(thomasMessages.length).toBeGreaterThanOrEqual(1);
  }, 60000);
});
