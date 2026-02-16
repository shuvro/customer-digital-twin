import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/llm/retry.js', () => ({
  callWithRetryAndFallback: vi.fn(async (opts: { userPrompt: string }) => {
    const { mockExtraction } = await import('../helpers/llm-mock.js');
    return JSON.stringify(mockExtraction(opts.userPrompt));
  }),
}));

import { createTestHarness } from '../helpers/setup.js';

const { app } = createTestHarness();

describe('GET /dashboard', () => {
  it('returns 200 with HTML content type', async () => {
    const response = await app.inject({ method: 'GET', url: '/dashboard' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
  });

  it('contains expected structural elements', async () => {
    const response = await app.inject({ method: 'GET', url: '/dashboard' });
    const body = response.body;

    expect(body).toContain('Customer Digital Twin');
    expect(body).toContain('customer-list');
    expect(body).toContain('metricsBar');
    expect(body).toContain('/metrics');
    expect(body).toContain('/customers');
  });

  it('contains three-layer data model sections', async () => {
    const response = await app.inject({ method: 'GET', url: '/dashboard' });
    const body = response.body;

    expect(body).toContain('Identity (Immutable)');
    expect(body).toContain('Attributes (Mutable)');
    expect(body).toContain('Insights (Inferred)');
  });

  it('contains merge UI elements', async () => {
    const response = await app.inject({ method: 'GET', url: '/dashboard' });
    const body = response.body;

    expect(body).toContain('customers/merge');
    expect(body).toContain('customers/duplicates');
    expect(body).toContain('Potential Duplicates');
  });
});
