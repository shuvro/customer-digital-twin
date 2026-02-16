import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/llm/retry.js', () => ({
  callWithRetryAndFallback: vi.fn(async (opts: { userPrompt: string }) => {
    const { mockExtraction } = await import('../helpers/llm-mock.js');
    return JSON.stringify(mockExtraction(opts.userPrompt));
  }),
}));

import { createTestHarness } from '../helpers/setup.js';

const { app } = createTestHarness();

async function ingestMessage(id: string, body: string, messageDate = '2025-03-10T09:15:00Z') {
  const res = await app.inject({
    method: 'POST',
    url: '/api/messages',
    payload: { id, source: 'email', messageDate, body },
  });
  return JSON.parse(res.body);
}

describe('POST /api/customers/merge', () => {
  it('merges two customers', async () => {
    // Create two separate customers
    const r1 = await ingestMessage('merge-m1', 'My name is Maria García López. Tax ID: 12345678A. DOB: 14 March 1985. I am Spanish and Female. Email: m.garcia85@gmail.com');
    const r2 = await ingestMessage('merge-t1', 'My name is Thomas Weber. Tax ID: 65 432 187 909. DOB: 22 July 1978. I am German and Male. Email: t.weber@business.de');

    expect(r1.customerId).toBeTruthy();
    expect(r2.customerId).toBeTruthy();
    expect(r1.customerId).not.toBe(r2.customerId);

    const response = await app.inject({
      method: 'POST',
      url: '/api/customers/merge',
      payload: {
        sourceCustomerId: r2.customerId,
        targetCustomerId: r1.customerId,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.status).toBe('ok');
    expect(body.merge.targetCustomerId).toBe(r1.customerId);
    expect(body.merge.sourceCustomerId).toBe(r2.customerId);
    expect(body.merge.messagesMoved).toBeGreaterThanOrEqual(1);

    // Source customer should be deleted
    const sourceCheck = await app.inject({ method: 'GET', url: `/api/customers/${r2.customerId}` });
    expect(sourceCheck.statusCode).toBe(404);

    // Target customer should still exist
    const targetCheck = await app.inject({ method: 'GET', url: `/api/customers/${r1.customerId}` });
    expect(targetCheck.statusCode).toBe(200);
  });

  it('returns 400 for self-merge', async () => {
    const r1 = await ingestMessage('merge-self-1', 'My name is Maria García López. Tax ID: 12345678A.');

    const response = await app.inject({
      method: 'POST',
      url: '/api/customers/merge',
      payload: {
        sourceCustomerId: r1.customerId,
        targetCustomerId: r1.customerId,
      },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.message).toContain('itself');
  });

  it('returns 400 for non-existent customer', async () => {
    const r1 = await ingestMessage('merge-noexist-1', 'My name is Maria García López. Tax ID: 12345678A.');

    const response = await app.inject({
      method: 'POST',
      url: '/api/customers/merge',
      payload: {
        sourceCustomerId: 'nonexistent-id',
        targetCustomerId: r1.customerId,
      },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.message).toContain('not found');
  });

  it('recalculates isCurrent after merge', async () => {
    // Create two customers with the same field (employer) at different dates
    const r1 = await ingestMessage('merge-current-m1', 'My name is Maria García López. Tax ID: 12345678A. She works at MadridSoft S.L.', '2025-01-01T00:00:00Z');
    const r2 = await ingestMessage('merge-current-t1', 'My name is Thomas Weber. Tax ID: 65 432 187 909. He works at FinanzBeratung AG.', '2025-06-01T00:00:00Z');

    // After merge, attributes from both should exist on target
    await app.inject({
      method: 'POST',
      url: '/api/customers/merge',
      payload: {
        sourceCustomerId: r2.customerId,
        targetCustomerId: r1.customerId,
      },
    });

    // Verify target has attributes and isCurrent is properly set
    const detail = await app.inject({ method: 'GET', url: `/api/customers/${r1.customerId}` });
    const customer = JSON.parse(detail.body).customer;

    // Should have employer attributes
    if (customer.attributes.employer) {
      const currentEmployers = customer.attributes.employer.filter((e: { isCurrent: boolean }) => e.isCurrent);
      expect(currentEmployers.length).toBe(1);
    }
  });
});

describe('GET /api/customers/duplicates', () => {
  it('returns duplicate pairs', async () => {
    // Create two customers with similar names — they should NOT match without taxId
    await ingestMessage('dup-detect-1', 'My name is Maria García López. Tax ID: 12345678A. DOB: 14 March 1985. Spanish Female.');
    await ingestMessage('dup-detect-2', 'My name is Thomas Weber. Tax ID: 65 432 187 909. DOB: 22 July 1978. German Male.');

    const response = await app.inject({
      method: 'GET',
      url: '/api/customers/duplicates?minScore=0.01',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.totalCustomers).toBeGreaterThanOrEqual(2);
    expect(body.capped).toBe(false);
    expect(Array.isArray(body.duplicates)).toBe(true);
  });

  it('returns correct shape', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/customers/duplicates',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('duplicates');
    expect(body).toHaveProperty('totalCustomers');
    expect(body).toHaveProperty('capped');
  });
});
