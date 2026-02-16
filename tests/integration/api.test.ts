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
});

describe('GET /api/customers', () => {
  it('returns empty list initially', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/customers' });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.customers).toHaveLength(0);
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
