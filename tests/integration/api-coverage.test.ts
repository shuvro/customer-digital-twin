import { describe, it, expect, beforeEach, vi } from 'vitest';

let shouldThrowLLMError = false;

vi.mock('../../src/llm/retry.js', () => ({
  callWithRetryAndFallback: vi.fn(async (opts: { userPrompt: string }) => {
    if (shouldThrowLLMError) {
      const { LLMExtractionError } = await import('../../src/errors.js');
      throw new LLMExtractionError('Model timeout for user m.garcia85@gmail.com request');
    }
    const { mockExtraction } = await import('../helpers/llm-mock.js');
    return JSON.stringify(mockExtraction(opts.userPrompt));
  }),
}));

import { createTestHarness } from '../helpers/setup.js';
import { callWithRetryAndFallback } from '../../src/llm/retry.js';

const mockedLLM = callWithRetryAndFallback as ReturnType<typeof vi.fn>;

const { app, prisma } = createTestHarness();

beforeEach(() => {
  shouldThrowLLMError = false;
  // Restore original mock implementation (undoes any mockImplementation/Once calls)
  mockedLLM.mockImplementation(async (opts: { userPrompt: string }) => {
    if (shouldThrowLLMError) {
      const { LLMExtractionError } = await import('../../src/errors.js');
      throw new LLMExtractionError('Model timeout for user m.garcia85@gmail.com request');
    }
    const { mockExtraction } = await import('../helpers/llm-mock.js');
    return JSON.stringify(mockExtraction(opts.userPrompt));
  });
});

describe('POST /api/messages/batch', () => {
  it('processes multiple messages and returns results array', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/messages/batch',
      payload: {
        messages: [
          {
            id: 'batch-001',
            source: 'email',
            messageDate: '2025-01-15T10:00:00Z',
            body: 'María García López. Tax ID: 12345678A. Spanish. Female.',
          },
          {
            id: 'batch-002',
            source: 'document',
            messageDate: '2025-02-01T00:00:00Z',
            body: 'Thomas Weber. Tax ID: 65 432 187 909. DOB: 22.07.1978. German. Male.',
          },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.results).toHaveLength(2);
    expect(body.results[0].status).toBe('ok');
    expect(body.results[0].action).toBe('CREATE');
    expect(body.results[1].status).toBe('ok');
    expect(body.results[1].action).toBe('CREATE');

    // Two distinct customers should exist
    const customers = await prisma.customer.findMany();
    expect(customers).toHaveLength(2);
  });

  it('continues processing after one message fails in batch', async () => {
    // First succeed, then fail extraction mid-batch, then succeed again
    let callCount = 0;
    mockedLLM.mockImplementation(async (opts: { userPrompt: string }) => {
      callCount++;
      if (callCount === 2) {
        throw new Error('Temporary LLM failure');
      }
      const { mockExtraction } = await import('../helpers/llm-mock.js');
      return JSON.stringify(mockExtraction(opts.userPrompt));
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/messages/batch',
      payload: {
        messages: [
          {
            id: 'batch-ok-1',
            source: 'email',
            messageDate: '2025-01-15T10:00:00Z',
            body: 'María García López. Tax ID: 12345678A.',
          },
          {
            id: 'batch-fail-1',
            source: 'email',
            messageDate: '2025-01-15T10:00:00Z',
            body: 'Thomas Weber. Tax ID: 65 432 187 909.',
          },
          {
            id: 'batch-ok-2',
            source: 'email',
            messageDate: '2025-01-15T10:00:00Z',
            body: 'María García López. Tax ID: 12345678A. Update.',
          },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.results).toHaveLength(3);

    // First and third succeed, second failed
    expect(body.results[0].status).toBe('ok');
    expect(body.results[1].status).toBe('error');
    expect(body.results[2].status).toBe('ok');
  });

  it('returns 400 for invalid batch payload', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/messages/batch',
      payload: { messages: 'not-an-array' },
    });

    expect(response.statusCode).toBe(400);
  });
});

describe('Global error handler', () => {
  it('returns 502 for LLMExtractionError with PII-safe message', async () => {
    shouldThrowLLMError = true;

    const response = await app.inject({
      method: 'POST',
      url: '/api/messages',
      payload: {
        id: 'llm-err-001',
        source: 'email',
        messageDate: '2025-01-15T10:00:00Z',
        body: 'María García López. Tax ID: 12345678A.',
      },
    });

    // LLMExtractionError should return 502
    expect(response.statusCode).toBe(502);
    const body = response.json();
    expect(body.status).toBe('error');
    expect(body.message).toBe('LLM processing failed');
    // The response body should NOT contain the email address from the error
    expect(body.message).not.toContain('m.garcia85@gmail.com');
  });
});

describe('Immutable conflict audit', () => {
  it('records identity conflict when immutable field differs between messages', async () => {
    // First message with nationality = Spanish
    const r1 = await app.inject({
      method: 'POST',
      url: '/api/messages',
      payload: {
        id: 'conflict-001',
        source: 'document',
        messageDate: '2025-01-01T00:00:00Z',
        body: 'María García López. Tax ID: 12345678A. Nationality: Spanish. Female. DOB: 14 March 1985.',
      },
    });
    expect(r1.statusCode).toBe(200);
    const customerId = r1.json().customerId;

    // Verify customer was created with Spanish nationality
    const customerBefore = await prisma.customer.findUnique({ where: { id: customerId } });
    expect(customerBefore!.nationality).toBe('Spanish');

    // Second message claims a different nationality for the same customer
    mockedLLM.mockImplementationOnce(async () => {
      return JSON.stringify({
        persons: [{
          firstName: 'María',
          lastName: 'García López',
          taxId: '12345678A',
          nationality: 'German', // Conflicting nationality
          emails: [],
          phones: [],
          addresses: [],
          hobbies: [],
          needs: [],
          riskIndicators: [],
          communicationPreferences: [],
          familyContext: [],
          notes: [],
        }],
        confidence: { firstName: 1.0, lastName: 1.0 },
      });
    });

    const r2 = await app.inject({
      method: 'POST',
      url: '/api/messages',
      payload: {
        id: 'conflict-002',
        source: 'email',
        messageDate: '2025-06-01T00:00:00Z',
        body: 'María García López. Tax ID: 12345678A. Nationality: German.',
      },
    });
    expect(r2.statusCode).toBe(200);

    // Customer should still have original nationality (immutable — first wins)
    const customerAfter = await prisma.customer.findUnique({ where: { id: customerId } });
    expect(customerAfter!.nationality).toBe('Spanish');

    // identityConflicts should record the conflict
    const conflicts = customerAfter!.identityConflicts as Array<Record<string, string>>;
    expect(conflicts).toBeTruthy();
    expect(conflicts.length).toBeGreaterThanOrEqual(1);

    const nationalityConflict = conflicts.find(c => c.field === 'nationality');
    expect(nationalityConflict).toBeTruthy();
    expect(nationalityConflict!.keptValue).toBe('Spanish');
    expect(nationalityConflict!.rejectedValue).toBe('German');
    expect(nationalityConflict!.existingSourceMessageId).toBe('conflict-001');
    expect(nationalityConflict!.newSourceMessageId).toBe('conflict-002');
  });
});
