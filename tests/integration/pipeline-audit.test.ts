import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/llm/retry.js', () => ({
  callWithRetryAndFallback: vi.fn(async (opts: { userPrompt: string }) => {
    const { mockExtraction } = await import('../helpers/llm-mock.js');
    return JSON.stringify(mockExtraction(opts.userPrompt));
  }),
}));

import { createTestHarness } from '../helpers/setup.js';

const { app, prisma } = createTestHarness();

describe('Pipeline Audit Log', () => {
  it('creates pipeline log entries for a CREATE flow', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/messages',
      payload: {
        id: 'audit-001',
        source: 'email',
        messageDate: '2025-01-15T10:30:00Z',
        body: 'My name is María García López. Tax ID: 12345678A. DOB: 14 March 1985. Spanish. Female.',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().action).toBe('CREATE');

    // Check pipeline logs
    const logs = await prisma.pipelineLog.findMany({
      where: { messageId: 'audit-001' },
      orderBy: { sequence: 'asc' },
    });

    // Should have EXTRACT, SEARCH, RE_EXTRACT, DECIDE, PERSIST stages
    expect(logs.length).toBeGreaterThanOrEqual(4);
    expect(logs[0].stage).toBe('EXTRACT');
    expect(logs[0].sequence).toBe(0);
    expect(logs[1].stage).toBe('SEARCH');
    expect(logs[1].sequence).toBe(1);

    // Sequences should be monotonically increasing
    for (let i = 1; i < logs.length; i++) {
      expect(logs[i].sequence).toBeGreaterThan(logs[i - 1].sequence);
    }

    // EXTRACT log should have meaningful output with correct shape
    const extractOutput = logs[0].output as Record<string, unknown>;
    expect(extractOutput.personCount).toBe(1);
    expect(extractOutput.fieldsExtracted).toEqual(expect.any(Array));
    expect((extractOutput.fieldsExtracted as string[]).length).toBeGreaterThan(0);
  });

  it('creates pipeline log entries for an UPDATE flow with re-extraction', async () => {
    // First create the customer
    await app.inject({
      method: 'POST',
      url: '/api/messages',
      payload: {
        id: 'audit-010',
        source: 'document',
        messageDate: '2025-01-01T00:00:00Z',
        body: 'María García López. Tax ID: 12345678A. DOB: 14 March 1985. Spanish. Female. Madrid.',
      },
    });

    // Second message that matches via taxId — should trigger re-extraction
    const response = await app.inject({
      method: 'POST',
      url: '/api/messages',
      payload: {
        id: 'audit-011',
        source: 'email',
        messageDate: '2025-03-01T00:00:00Z',
        body: 'María García López. Tax ID: 12345678A. Now married. Email: m.garcia85@gmail.com. Working at TechCorp.',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().action).toBe('UPDATE');

    const logs = await prisma.pipelineLog.findMany({
      where: { messageId: 'audit-011' },
      orderBy: { sequence: 'asc' },
    });

    // Should have EXTRACT, SEARCH, RE_EXTRACT, DECIDE, PERSIST
    const stages = logs.map(l => l.stage);
    expect(stages).toContain('EXTRACT');
    expect(stages).toContain('SEARCH');
    expect(stages).toContain('RE_EXTRACT');
    expect(stages).toContain('DECIDE');
    expect(stages).toContain('PERSIST');

    // DECIDE log should contain decision code
    const decideLog = logs.find(l => l.stage === 'DECIDE')!;
    const decideOutput = decideLog.output as Record<string, unknown>;
    expect(decideOutput.action).toBe('UPDATE');
    expect(decideOutput.decisionCode).toBe('TAXID_MATCH');

    // RE_EXTRACT should have been triggered
    const reExtractLog = logs.find(l => l.stage === 'RE_EXTRACT')!;
    const reExtractOutput = reExtractLog.output as Record<string, unknown>;
    expect(reExtractOutput.triggered).toBe(true);
  });

  it('stores decisionReasoning and decisionCode on Message', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/messages',
      payload: {
        id: 'audit-020',
        source: 'email',
        messageDate: '2025-01-15T10:30:00Z',
        body: 'Thomas Weber. Tax ID: 65 432 187 909. DOB: 22.07.1978. German. Male.',
      },
    });

    const msg = await prisma.message.findUnique({ where: { id: 'audit-020' } });
    expect(msg).not.toBeNull();
    expect(msg!.decisionCode).toBe('NO_CANDIDATES');
    expect(msg!.decisionReasoning).toContain('No existing customers matched');
  });

  it('logs pipeline even for SKIP (no persons extracted)', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/messages',
      payload: {
        id: 'audit-030',
        source: 'email',
        messageDate: '2025-01-01T00:00:00Z',
        body: 'Hello, this message has no customer info at all.',
      },
    });

    const logs = await prisma.pipelineLog.findMany({
      where: { messageId: 'audit-030' },
      orderBy: { sequence: 'asc' },
    });

    // Should have at least the EXTRACT log entry
    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs[0].stage).toBe('EXTRACT');
  });

  it('pipeline log output never contains PII values', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/messages',
      payload: {
        id: 'audit-040',
        source: 'email',
        messageDate: '2025-01-15T10:30:00Z',
        body: 'María García López. Tax ID: 12345678A. DOB: 14 March 1985. Email: m.garcia85@gmail.com. Phone: +34 612 345 678. Madrid.',
      },
    });

    const logs = await prisma.pipelineLog.findMany({
      where: { messageId: 'audit-040' },
    });

    // Validate audit log shape: output should have expected summary fields, not raw PII
    for (const log of logs) {
      const output = log.output as Record<string, unknown>;

      // Every log entry must have a structured output (not raw text dump)
      expect(output).toEqual(expect.any(Object));

      const inputStr = JSON.stringify(log.input ?? {});
      const outputStr = JSON.stringify(output);
      const combined = inputStr + outputStr;

      // Must not contain actual customer PII values
      expect(combined).not.toContain('María');
      expect(combined).not.toContain('García');
      expect(combined).not.toContain('12345678A');
      expect(combined).not.toContain('m.garcia85@gmail.com');
      expect(combined).not.toContain('+34 612 345 678');
      expect(combined).not.toContain('Calle Gran Vía');
      // Must not contain raw LLM prompt markers
      expect(combined).not.toContain('MESSAGE BODY');
    }
  });
}, 30000);

describe('GET /api/messages/:id/pipeline', () => {
  it('returns full pipeline audit trail for a processed message', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/messages',
      payload: {
        id: 'audit-api-001',
        source: 'email',
        messageDate: '2025-01-15T10:30:00Z',
        body: 'Thomas Weber. Tax ID: 65 432 187 909. DOB: 22.07.1978. German. Male. Berlin.',
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/messages/audit-api-001/pipeline',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.messageId).toBe('audit-api-001');
    expect(body.status).toBe('COMPLETED');
    expect(body.decisionCode).toEqual(expect.any(String));
    expect(body.decisionReasoning).toEqual(expect.any(String));
    expect(body.pipeline).toEqual(expect.any(Array));
    expect(body.pipeline.length).toBeGreaterThanOrEqual(4);

    // Pipeline entries should be ordered by sequence
    for (let i = 1; i < body.pipeline.length; i++) {
      expect(body.pipeline[i].sequence).toBeGreaterThan(body.pipeline[i - 1].sequence);
    }

    // Each entry should have the required shape
    for (const entry of body.pipeline) {
      expect(entry).toEqual(expect.objectContaining({
        stage: expect.any(String),
        sequence: expect.any(Number),
        timestamp: expect.any(String),
        summary: expect.any(String),
      }));
    }
  });

  it('returns 404 for non-existent message', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/messages/non-existent-id/pipeline',
    });

    expect(response.statusCode).toBe(404);
  });
}, 30000);
