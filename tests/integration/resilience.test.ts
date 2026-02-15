import { describe, it, expect, beforeEach, vi } from 'vitest';

// Flags to control mock behavior per test
let shouldFailExtraction = false;
let shouldFailSearch = false;

vi.mock('../../src/llm/retry.js', () => ({
  callWithRetryAndFallback: vi.fn(async (opts: { userPrompt: string }) => {
    if (shouldFailExtraction) {
      throw new Error('LLM service unavailable');
    }
    const { mockExtraction } = await import('../helpers/llm-mock.js');
    return JSON.stringify(mockExtraction(opts.userPrompt));
  }),
}));

// Conditionally fail search
vi.mock('../../src/pipeline/search.js', async (importOriginal) => {
  const original = await importOriginal() as Record<string, unknown>;
  return {
    ...original,
    searchCustomers: vi.fn(async (...args: unknown[]) => {
      if (shouldFailSearch) {
        throw new Error('Search database connection lost');
      }
      return (original.searchCustomers as (...a: unknown[]) => unknown)(...args);
    }),
  };
});

import { createTestHarness } from '../helpers/setup.js';

const { app, prisma } = createTestHarness();

beforeEach(() => {
  shouldFailExtraction = false;
  shouldFailSearch = false;
});

describe('Resilience: markFailed on extraction error', () => {
  it('marks message as FAILED when LLM extraction throws', async () => {
    shouldFailExtraction = true;

    const response = await app.inject({
      method: 'POST',
      url: '/api/messages',
      payload: {
        id: 'fail-extract-001',
        source: 'email',
        messageDate: '2025-01-15T10:00:00Z',
        body: 'María García López. Tax ID: 12345678A.',
      },
    });

    // The error handler returns 500
    expect(response.statusCode).toBe(500);

    // Message should be persisted as FAILED
    const msg = await prisma.message.findUnique({ where: { id: 'fail-extract-001' } });
    expect(msg).toBeTruthy();
    expect(msg!.status).toBe('FAILED');
    expect(msg!.errorMessage).toContain('LLM service unavailable');
  });
});

describe('Resilience: markFailed on search error', () => {
  it('marks message as FAILED when search stage throws', async () => {
    shouldFailSearch = true;

    const response = await app.inject({
      method: 'POST',
      url: '/api/messages',
      payload: {
        id: 'fail-search-001',
        source: 'email',
        messageDate: '2025-01-15T10:00:00Z',
        body: 'María García López. Tax ID: 12345678A.',
      },
    });

    expect(response.statusCode).toBe(500);

    const msg = await prisma.message.findUnique({ where: { id: 'fail-search-001' } });
    expect(msg).toBeTruthy();
    expect(msg!.status).toBe('FAILED');
    expect(msg!.errorMessage).toContain('Search database connection lost');
  });
});

describe('Resilience: FAILED message retry', () => {
  it('retries a previously FAILED message successfully', async () => {
    // First attempt — fail extraction
    shouldFailExtraction = true;
    await app.inject({
      method: 'POST',
      url: '/api/messages',
      payload: {
        id: 'retry-001',
        source: 'email',
        messageDate: '2025-01-15T10:00:00Z',
        body: 'María García López. Tax ID: 12345678A. Spanish. Female.',
      },
    });

    const failedMsg = await prisma.message.findUnique({ where: { id: 'retry-001' } });
    expect(failedMsg!.status).toBe('FAILED');

    // Second attempt — extraction works now
    shouldFailExtraction = false;
    const response = await app.inject({
      method: 'POST',
      url: '/api/messages',
      payload: {
        id: 'retry-001',
        source: 'email',
        messageDate: '2025-01-15T10:00:00Z',
        body: 'María García López. Tax ID: 12345678A. Spanish. Female.',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.action).toBe('CREATE');
    expect(body.customerId).toBeTruthy();

    // Message should now be COMPLETED
    const completedMsg = await prisma.message.findUnique({ where: { id: 'retry-001' } });
    expect(completedMsg!.status).toBe('COMPLETED');
  });
});

describe('Resilience: stale PROCESSING reclaim', () => {
  it('reclaims a message stuck in PROCESSING beyond stale threshold', async () => {
    // Manually insert a stale PROCESSING message (created 10 minutes ago)
    const staleDate = new Date(Date.now() - 10 * 60 * 1000);
    await prisma.message.create({
      data: {
        id: 'stale-001',
        source: 'email',
        messageDate: new Date('2025-01-15T10:00:00Z'),
        rawPayload: {
          id: 'stale-001',
          source: 'email',
          messageDate: '2025-01-15T10:00:00Z',
          body: 'María García López. Tax ID: 12345678A. Spanish. Female. Madrid.',
        },
        status: 'PROCESSING',
        createdAt: staleDate,
        processedAt: staleDate,
      },
    });

    // Verify it's in PROCESSING
    const before = await prisma.message.findUnique({ where: { id: 'stale-001' } });
    expect(before!.status).toBe('PROCESSING');

    // Now process the same message — should reclaim it
    const response = await app.inject({
      method: 'POST',
      url: '/api/messages',
      payload: {
        id: 'stale-001',
        source: 'email',
        messageDate: '2025-01-15T10:00:00Z',
        body: 'María García López. Tax ID: 12345678A. Spanish. Female. Madrid.',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.action).toBe('CREATE');

    // Message should now be COMPLETED
    const after = await prisma.message.findUnique({ where: { id: 'stale-001' } });
    expect(after!.status).toBe('COMPLETED');
  });
});

describe('Resilience: ALREADY_PROCESSING for active message', () => {
  it('returns ALREADY_PROCESSING for a fresh PROCESSING message', async () => {
    // Insert a fresh PROCESSING message (just now)
    await prisma.message.create({
      data: {
        id: 'active-001',
        source: 'email',
        messageDate: new Date('2025-01-15T10:00:00Z'),
        rawPayload: {
          id: 'active-001',
          source: 'email',
          messageDate: '2025-01-15T10:00:00Z',
          body: 'María García López. Tax ID: 12345678A.',
        },
        status: 'PROCESSING',
        // createdAt defaults to now() — fresh, not stale
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/messages',
      payload: {
        id: 'active-001',
        source: 'email',
        messageDate: '2025-01-15T10:00:00Z',
        body: 'María García López. Tax ID: 12345678A.',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.action).toBe('ALREADY_PROCESSING');
    expect(body.customerId).toBeNull();

    // Message should still be PROCESSING (not touched)
    const msg = await prisma.message.findUnique({ where: { id: 'active-001' } });
    expect(msg!.status).toBe('PROCESSING');
  });
});

describe('Resilience: concurrent requests with advisory lock', () => {
  it('parallel requests for same message produce exactly one customer', async () => {
    const payload = {
      id: 'concurrent-001',
      source: 'email',
      messageDate: '2025-01-15T10:00:00Z',
      body: 'María García López. Tax ID: 12345678A. Spanish. Female. Madrid.',
    };

    // Fire 5 concurrent requests for the same message
    const promises = Array.from({ length: 5 }, () =>
      app.inject({ method: 'POST', url: '/api/messages', payload })
    );

    const responses = await Promise.all(promises);

    // All should succeed
    for (const r of responses) {
      expect(r.statusCode).toBe(200);
    }

    const bodies = responses.map(r => r.json());

    // Exactly one CREATE, rest should be ALREADY_PROCESSED or ALREADY_PROCESSING
    const creates = bodies.filter(b => b.action === 'CREATE');
    const processed = bodies.filter(b => b.action === 'ALREADY_PROCESSED');
    const processing = bodies.filter(b => b.action === 'ALREADY_PROCESSING');

    expect(creates.length).toBe(1);
    expect(processed.length + processing.length).toBe(4);

    // Only one customer should exist
    const customers = await prisma.customer.findMany();
    expect(customers).toHaveLength(1);

    // Only one message record
    const messages = await prisma.message.findMany({ where: { id: 'concurrent-001' } });
    expect(messages).toHaveLength(1);
    expect(messages[0].status).toBe('COMPLETED');
  });
});
