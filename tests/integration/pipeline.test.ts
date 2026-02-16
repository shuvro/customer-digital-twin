import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/llm/retry.js', () => ({
  callWithRetryAndFallback: vi.fn(async (opts: { userPrompt: string }) => {
    const { mockExtraction } = await import('../helpers/llm-mock.js');
    return JSON.stringify(mockExtraction(opts.userPrompt));
  }),
}));

import { createTestHarness } from '../helpers/setup.js';

const { app, prisma } = createTestHarness();

describe('Pipeline Integration', () => {
  it('extracts, matches, and creates a new customer from first message', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/messages',
      payload: {
        id: 'pipe-001',
        source: 'email',
        messageDate: '2025-01-15T10:30:00Z',
        body: 'My name is María García López. Tax ID: 12345678A. DOB: 14 March 1985. Nationality: Spanish. Gender: Female. Address in Madrid.',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.action).toBe('CREATE');
    expect(body.customerId).toBeTruthy();

    // Verify customer was created with correct identity fields
    const customer = await prisma.customer.findFirst({ where: { taxId: '12345678A' } });
    expect(customer).toBeTruthy();
    expect(customer!.firstName).toBe('María');
    expect(customer!.lastName).toBe('García López');
    expect(customer!.nationality).toBe('Spanish');
    expect(customer!.gender).toBe('Female');
  });

  it('matches second message to existing customer via taxId', async () => {
    // First message — create
    await app.inject({
      method: 'POST',
      url: '/api/messages',
      payload: {
        id: 'pipe-010',
        source: 'document',
        messageDate: '2025-01-01T00:00:00Z',
        body: 'María García López. Tax ID: 12345678A. DOB: 14 March 1985. Spanish. Female. Madrid.',
      },
    });

    // Second message — same customer, different data
    const response = await app.inject({
      method: 'POST',
      url: '/api/messages',
      payload: {
        id: 'pipe-011',
        source: 'email',
        messageDate: '2025-03-01T00:00:00Z',
        body: 'María García López here. Tax ID 12345678A. Now married. Email: m.garcia85@gmail.com. Working at TechCorp. Enjoys hiking.',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.action).toBe('UPDATE');
    expect(body.matchSignals).toContain('taxId');

    // Verify single customer
    const customers = await prisma.customer.findMany();
    expect(customers).toHaveLength(1);
  });

  it('handles non-chronological message order correctly', async () => {
    // Send newer message first
    await app.inject({
      method: 'POST',
      url: '/api/messages',
      payload: {
        id: 'pipe-020',
        source: 'email',
        messageDate: '2025-06-01T00:00:00Z',
        body: 'Thomas Weber. Tax ID: 65 432 187 909. DOB: 22.07.1978. German. Male. Divorced. Working at FinanzBeratung. Berlin.',
      },
    });

    // Send older message second
    await app.inject({
      method: 'POST',
      url: '/api/messages',
      payload: {
        id: 'pipe-021',
        source: 'document',
        messageDate: '2025-01-01T00:00:00Z',
        body: 'Thomas Weber. Tax ID: 65 432 187 909. DOB: 22.07.1978. German. Male. Berlin.',
      },
    });

    const customers = await prisma.customer.findMany();
    expect(customers).toHaveLength(1);

    // maritalStatus should be from newer message (Divorced)
    const attrs = await prisma.customerAttribute.findMany({
      where: { customerId: customers[0].id, field: 'maritalStatus', isCurrent: true },
    });
    expect(attrs).toHaveLength(1);
    expect(attrs[0].value).toBe('Divorced');
    // The newer messageDate should be the current one
    expect(attrs[0].messageDate.toISOString()).toContain('2025-06-01');
  });

  it('latest messageDate wins for list fields (email, phone)', async () => {
    // Older message with first email/phone
    await app.inject({
      method: 'POST',
      url: '/api/messages',
      payload: {
        id: 'pipe-030',
        source: 'email',
        messageDate: '2025-01-01T00:00:00Z',
        body: 'María García López. Tax ID: 12345678A. Email: m.garcia85@gmail.com. Phone: +34 612 345 678. Madrid.',
      },
    });

    // Newer message with updated email and phone
    await app.inject({
      method: 'POST',
      url: '/api/messages',
      payload: {
        id: 'pipe-031',
        source: 'message',
        messageDate: '2025-03-01T00:00:00Z',
        body: 'María García López. Tax ID: 12345678A. Email: maria.garcia@email.com. Phone: +49 171 2345678.',
      },
    });

    const customer = await prisma.customer.findFirst({ where: { taxId: '12345678A' } });
    expect(customer).toBeTruthy();

    // Only the latest email should be current (latest messageDate wins)
    const currentEmails = await prisma.customerAttribute.findMany({
      where: { customerId: customer!.id, field: 'email', isCurrent: true },
    });
    expect(currentEmails).toHaveLength(1);
    expect(currentEmails[0].value).toBe('maria.garcia@email.com');

    // Only the latest phone should be current
    const currentPhones = await prisma.customerAttribute.findMany({
      where: { customerId: customer!.id, field: 'phone', isCurrent: true },
    });
    expect(currentPhones).toHaveLength(1);
    expect(currentPhones[0].value).toBe('+49 171 2345678');

    // Old values preserved in history
    const allEmails = await prisma.customerAttribute.findMany({
      where: { customerId: customer!.id, field: 'email' },
    });
    expect(allEmails.length).toBeGreaterThanOrEqual(2);
  });

  it('accumulates insights without overwriting', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/messages',
      payload: {
        id: 'pipe-040',
        source: 'email',
        messageDate: '2025-01-01T00:00:00Z',
        body: 'María García López. Tax ID: 12345678A. Enjoys hiking. Needs life insurance.',
      },
    });

    await app.inject({
      method: 'POST',
      url: '/api/messages',
      payload: {
        id: 'pipe-041',
        source: 'message',
        messageDate: '2025-02-01T00:00:00Z',
        body: 'María García López. Tax ID: 12345678A. Enjoys hiking.',
      },
    });

    const customer = await prisma.customer.findFirst({ where: { taxId: '12345678A' } });
    const hobbies = await prisma.customerInsight.findMany({
      where: { customerId: customer!.id, field: 'hobbies' },
    });

    // "hiking" appears in both messages from different sources,
    // unique constraint is (customerId, field, value, sourceMessageId),
    // so both are kept — insights accumulate all mentions with provenance.
    expect(hobbies.length).toBeGreaterThanOrEqual(1);
    expect(hobbies.every(h => h.value === 'hiking')).toBe(true);

    const needs = await prisma.customerInsight.findMany({
      where: { customerId: customer!.id, field: 'needs' },
    });
    // life insurance only appears in the first message
    expect(needs).toHaveLength(1);
    expect(needs[0].value).toBe('life insurance');
  });

  it('returns 400 for invalid messageDate', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/messages',
      payload: {
        id: 'pipe-050',
        source: 'email',
        messageDate: 'not-a-date',
        body: 'Some message body',
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it('message with no extractable persons is marked COMPLETED with no customer', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/messages',
      payload: {
        id: 'pipe-060',
        source: 'email',
        messageDate: '2025-01-01T00:00:00Z',
        body: 'Hello, this message has no customer info at all.',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.action).toBe('SKIP');
    expect(body.customerId).toBeNull();

    const msg = await prisma.message.findUnique({ where: { id: 'pipe-060' } });
    expect(msg!.status).toBe('COMPLETED');
  });
}, 30000);
