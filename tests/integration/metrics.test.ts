import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/llm/retry.js', () => ({
  callWithRetryAndFallback: vi.fn(async (opts: { userPrompt: string }) => {
    const { mockExtraction } = await import('../helpers/llm-mock.js');
    return JSON.stringify(mockExtraction(opts.userPrompt));
  }),
}));

import { createTestHarness } from '../helpers/setup.js';
import { metrics } from '../../src/observability/metrics.js';

const { app } = createTestHarness();

beforeEach(() => {
  metrics.reset();
});

describe('GET /api/metrics', () => {
  it('returns correct shape', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/metrics' });
    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.body);
    expect(body.pipeline).toBeDefined();
    expect(body.pipeline.messagesReceived).toBeTypeOf('number');
    expect(body.pipeline.messagesProcessed).toBeTypeOf('number');
    expect(body.pipeline.messagesFailed).toBeTypeOf('number');
    expect(body.timings).toBeDefined();
    expect(body.timings.total).toBeDefined();
    expect(body.timings.total.avg).toBeTypeOf('number');
    expect(body.errorRate).toBeTypeOf('number');
    expect(body.database).toBeDefined();
    expect(body.database.customers).toBeTypeOf('number');
    expect(body.database.messages).toBeTypeOf('number');
  });

  it('counters update after message ingestion', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/messages',
      payload: {
        id: 'metrics-test-001',
        source: 'email',
        messageDate: '2025-03-10T09:15:00Z',
        body: 'My name is Maria García López. Tax ID: 12345678A.',
      },
    });

    const response = await app.inject({ method: 'GET', url: '/api/metrics' });
    const body = JSON.parse(response.body);

    expect(body.pipeline.messagesReceived).toBeGreaterThanOrEqual(1);
    expect(body.pipeline.messagesProcessed).toBeGreaterThanOrEqual(1);
    expect(body.timings.total.count).toBeGreaterThanOrEqual(1);
  });
});

describe('x-request-id header', () => {
  it('returns x-request-id in response headers', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/metrics',
    });

    expect(response.headers['x-request-id']).toBeDefined();
    expect(response.headers['x-request-id']).toBeTruthy();
  });

  it('echoes provided x-request-id', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/metrics',
      headers: { 'x-request-id': 'my-custom-id-123' },
    });

    expect(response.headers['x-request-id']).toBe('my-custom-id-123');
  });

  it('includes requestId in POST /api/messages response body', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/messages',
      headers: { 'x-request-id': 'req-trace-test' },
      payload: {
        id: 'metrics-reqid-001',
        source: 'email',
        messageDate: '2025-03-10T09:15:00Z',
        body: 'My name is Maria García López. Tax ID: 12345678A.',
      },
    });

    const body = JSON.parse(response.body);
    expect(body.requestId).toBe('req-trace-test');
  });
});
