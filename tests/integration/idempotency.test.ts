import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/llm/retry.js', () => ({
  callWithRetryAndFallback: vi.fn(async (opts: { userPrompt: string }) => {
    const { mockExtraction } = await import('../helpers/llm-mock.js');
    return JSON.stringify(mockExtraction(opts.userPrompt));
  }),
}));

import { createTestHarness } from '../helpers/setup.js';

const { app, prisma } = createTestHarness();

describe('Idempotency', () => {
  it('same message twice creates exactly one customer', async () => {
    const payload = {
      id: 'idem-001',
      source: 'document',
      messageDate: '2025-01-15T00:00:00Z',
      body: 'Full Name: María García López\nDate of Birth: 14 March 1985\nTax Identification Number: 12345678A\nNationality: Spanish\nGender: Female\nAddress: Madrid',
    };

    await app.inject({ method: 'POST', url: '/api/messages', payload });
    await app.inject({ method: 'POST', url: '/api/messages', payload });

    const customers = await prisma.customer.findMany();
    expect(customers).toHaveLength(1);

    const messages = await prisma.message.findMany();
    expect(messages).toHaveLength(1);
    expect(messages[0].status).toBe('COMPLETED');
  });

  it('same data from different messages does not duplicate attributes', async () => {
    const payload1 = {
      id: 'idem-a',
      source: 'email',
      messageDate: '2025-01-15T00:00:00Z',
      body: 'My name is Thomas Weber. Tax ID 65 432 187 909. DOB 22.07.1978. German. Male. Address in Berlin.',
    };

    const payload2 = {
      id: 'idem-b',
      source: 'message',
      messageDate: '2025-02-15T00:00:00Z',
      body: 'Thomas Weber here. Tax ID: 65 432 187 909. Still in Berlin.',
    };

    await app.inject({ method: 'POST', url: '/api/messages', payload: payload1 });
    await app.inject({ method: 'POST', url: '/api/messages', payload: payload2 });

    const customers = await prisma.customer.findMany();
    expect(customers).toHaveLength(1);
    expect(customers[0].firstName).toBe('Thomas');
    expect(customers[0].lastName).toBe('Weber');
  });
});
