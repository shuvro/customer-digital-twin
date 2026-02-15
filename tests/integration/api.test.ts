import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/llm/retry.js', () => ({
  callWithRetryAndFallback: vi.fn(async (opts: { userPrompt: string }) => {
    const { mockExtraction } = await import('../helpers/llm-mock.js');
    return JSON.stringify(mockExtraction(opts.userPrompt));
  }),
}));

import { createTestHarness } from '../helpers/setup.js';

const { app } = createTestHarness();

describe('POST /api/messages', () => {
  it('returns 200 for valid message', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/messages',
      payload: {
        id: 'test-001',
        source: 'email',
        messageDate: '2025-03-10T09:15:00Z',
        subject: 'Test',
        from: 'm.garcia85@gmail.com',
        body: 'My name is Maria García López and I have tax ID 12345678A. I live in Madrid.',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.status).toBe('ok');
    expect(body.messageId).toBe('test-001');
    expect(body.customerId).toBeTruthy();
  });

  it('returns 400 for missing required fields', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/messages',
      payload: {
        id: 'test-bad',
        source: 'email',
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it('handles duplicate messages idempotently', async () => {
    const payload = {
      id: 'test-dup',
      source: 'email',
      messageDate: '2025-03-10T09:15:00Z',
      body: 'My name is Maria García López. Tax ID: 12345678A.',
    };

    const first = await app.inject({ method: 'POST', url: '/api/messages', payload });
    expect(first.statusCode).toBe(200);
    const firstBody = JSON.parse(first.body);

    const second = await app.inject({ method: 'POST', url: '/api/messages', payload });
    expect(second.statusCode).toBe(200);
    const secondBody = JSON.parse(second.body);

    expect(secondBody.customerId).toBe(firstBody.customerId);
    expect(secondBody.action).toBe('ALREADY_PROCESSED');
  });
});

describe('GET /api/customers', () => {
  it('returns empty list initially', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/customers' });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.customers).toHaveLength(0);
  });

  it('returns customers after ingestion', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/messages',
      payload: {
        id: 'test-cust-001',
        source: 'email',
        messageDate: '2025-03-10T09:15:00Z',
        body: 'My name is Maria García López. Tax ID: 12345678A. DOB: 14 March 1985. I am Spanish and Female.',
      },
    });

    const response = await app.inject({ method: 'GET', url: '/api/customers' });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.customers.length).toBeGreaterThanOrEqual(1);
  });
});

describe('GET /api/customers/:id', () => {
  it('returns 404 for non-existent customer', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/customers/nonexistent' });
    expect(response.statusCode).toBe(404);
  });
});

describe('GET /health', () => {
  it('returns ok', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ status: 'ok' });
  });
});
