import { prisma } from '../db.js';
import { logger } from '../logger.js';
import { extractFromMessage } from './extract.js';
import { searchCustomers } from './search.js';
import { decideAction } from './decide.js';
import { persistExtraction } from './persist.js';
import type { InboundMessage } from '../types/message.js';
import type { PipelineContext } from '../types/pipeline.js';
import { Prisma } from '../generated/prisma/client.js';
import { metrics } from '../observability/metrics.js';
import { hashText } from '../utils/hash.js';
import type { Logger } from 'pino';

// If a message has been PROCESSING for longer than this, treat it as abandoned
// (process crash, kill, timeout) and allow re-processing.
const STALE_PROCESSING_MS = 5 * 60 * 1000; // 5 minutes

export interface PipelineResult {
  messageId: string;
  customerId: string | null;
  action: string;
  score: number;
  signals: string[];
}

export async function processMessage(message: InboundMessage, requestId?: string): Promise<PipelineResult> {
  const messageId = message.id;
  const pipelineStart = Date.now();
  const log: Logger = requestId ? logger.child({ requestId }) : logger;

  // Fast-path idempotency check (no lock needed)
  const existing = await prisma.message.findUnique({ where: { id: messageId } });
  if (existing?.status === 'COMPLETED') {
    log.info({ messageId }, 'Message already processed, returning cached result');
    return {
      messageId,
      customerId: existing.customerId,
      action: 'ALREADY_PROCESSED',
      score: existing.matchScore ?? 0,
      signals: (existing.matchSignals as string[]) ?? [],
    };
  }

  const lockKey = hashText(messageId);

  // --- Phase 1: Short transaction to acquire lock + claim message as PROCESSING ---
  // Uses pg_advisory_xact_lock (auto-releases on commit/rollback).
  const claimResult = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${lockKey})`);

    const afterLock = await tx.message.findUnique({ where: { id: messageId } });

    if (afterLock?.status === 'COMPLETED') {
      return { alreadyDone: true as const, record: afterLock };
    }

    if (afterLock?.status === 'PROCESSING') {
      // Check if the PROCESSING record is stale (abandoned by crashed process)
      const age = Date.now() - afterLock.createdAt.getTime();
      const updatedAge = afterLock.processedAt
        ? Date.now() - afterLock.processedAt.getTime()
        : age;
      const effectiveAge = Math.min(age, updatedAge);

      if (effectiveAge < STALE_PROCESSING_MS) {
        // Still fresh — another request is actively processing
        return { alreadyDone: true as const, record: afterLock };
      }

      // Stale PROCESSING — reclaim by falling through to upsert below
      log.warn({ messageId, ageMs: effectiveAge }, 'Reclaiming stale PROCESSING message');
    }

    if (afterLock?.status === 'FAILED') {
      // Previously failed — allow retry by falling through to upsert below
      log.info({ messageId }, 'Retrying previously FAILED message');
    }

    // Claim the message (create or reclaim)
    await tx.message.upsert({
      where: { id: messageId },
      create: {
        id: messageId,
        source: message.source,
        messageDate: new Date(message.messageDate),
        rawPayload: message as unknown as Prisma.InputJsonValue,
        status: 'PROCESSING',
      },
      update: {
        status: 'PROCESSING',
        errorMessage: null,
        processedAt: new Date(), // Update timestamp so staleness resets
      },
    });

    return { alreadyDone: false as const };
  });

  // Handle already-processed / currently-processing
  if (claimResult.alreadyDone) {
    const record = claimResult.record;
    if (record.status === 'COMPLETED') {
      return {
        messageId,
        customerId: record.customerId,
        action: 'ALREADY_PROCESSED',
        score: record.matchScore ?? 0,
        signals: (record.matchSignals as string[]) ?? [],
      };
    }
    // PROCESSING by another active request — return early
    return {
      messageId,
      customerId: record.customerId,
      action: 'ALREADY_PROCESSING',
      score: 0,
      signals: [],
    };
  }

  // --- Phase 2: Extract + Search + Decide + Persist ---
  // We only count messagesReceived once we've claimed exclusive processing.
  // Idempotent/concurrent duplicates exit above without inflating counters.
  metrics.increment('messagesReceived');

  // Entire post-claim pipeline is wrapped in try/catch so any failure
  // (extraction, search, decide, or persist) marks the message as FAILED.
  try {
    // LLM extraction (outside any transaction — no DB connection held)
    const extractStart = Date.now();
    const extraction = await extractFromMessage(message);
    metrics.recordTiming('extract', Date.now() - extractStart);

    // No persons extracted → mark completed, no customer
    if (extraction.persons.length === 0) {
      await prisma.message.update({
        where: { id: messageId },
        data: {
          status: 'COMPLETED',
          extractionResult: extraction as unknown as Prisma.InputJsonValue,
          confidence: 0,
          processedAt: new Date(),
        },
      });
      metrics.increment('messagesSkipped');
      metrics.increment('messagesProcessed');
      metrics.recordTiming('total', Date.now() - pipelineStart);
      return { messageId, customerId: null, action: 'SKIP', score: 0, signals: [] };
    }

    const person = extraction.persons[0];
    const ctx: PipelineContext = { message, extraction, person, requestId };

    // Search + Decide (reads from DB, pure logic)
    const searchStart = Date.now();
    const searchResult = await searchCustomers(ctx);
    metrics.recordTiming('search', Date.now() - searchStart);

    const decideStart = Date.now();
    const decision = decideAction(ctx, searchResult);
    metrics.recordTiming('decide', Date.now() - decideStart);
    ctx.decision = decision;

    if (decision.action === 'SKIP') {
      await prisma.message.update({
        where: { id: messageId },
        data: {
          status: 'COMPLETED',
          extractionResult: extraction as unknown as Prisma.InputJsonValue,
          confidence: extractionConfidence(extraction),
          processedAt: new Date(),
        },
      });
      metrics.increment('messagesSkipped');
      metrics.increment('messagesProcessed');
      metrics.recordTiming('total', Date.now() - pipelineStart);
      return { messageId, customerId: null, action: 'SKIP', score: 0, signals: [] };
    }

    // --- Phase 3: Short transaction to persist + mark COMPLETED ---
    const persistStart = Date.now();
    const customerId = await prisma.$transaction(async (tx) => {
      const cid = await persistExtraction(ctx, tx);

      await tx.message.update({
        where: { id: messageId },
        data: {
          status: 'COMPLETED',
          customerId: cid,
          extractionResult: extraction as unknown as Prisma.InputJsonValue,
          confidence: extractionConfidence(extraction),
          matchScore: decision.score,
          matchSignals: decision.signals as unknown as Prisma.InputJsonValue,
          processedAt: new Date(),
        },
      });

      return cid;
    }, { timeout: 30000 });
    metrics.recordTiming('persist', Date.now() - persistStart);

    if (decision.action === 'CREATE') metrics.increment('customersCreated');
    else if (decision.action === 'UPDATE') metrics.increment('customersUpdated');

    metrics.increment('messagesProcessed');
    metrics.recordTiming('total', Date.now() - pipelineStart);

    log.info({ messageId, customerId, action: decision.action }, 'Pipeline completed');

    return {
      messageId,
      customerId,
      action: decision.action,
      score: decision.score,
      signals: decision.signals,
    };
  } catch (err) {
    metrics.increment('messagesFailed');
    metrics.recordTiming('total', Date.now() - pipelineStart);
    // Any failure in extract/search/decide/persist → mark FAILED outside transaction
    await markFailed(log, messageId, message, err);
    throw err;
  }
}

/**
 * Mark a message as FAILED outside any transaction so the status persists
 * even when the main transaction rolled back.
 */
async function markFailed(log: Logger, messageId: string, message: InboundMessage, err: unknown): Promise<void> {
  const errorMsg = err instanceof Error ? err.message : String(err);
  try {
    await prisma.message.upsert({
      where: { id: messageId },
      create: {
        id: messageId,
        source: message.source,
        messageDate: new Date(message.messageDate),
        rawPayload: message as unknown as Prisma.InputJsonValue,
        status: 'FAILED',
        errorMessage: errorMsg.slice(0, 500),
      },
      update: {
        status: 'FAILED',
        errorMessage: errorMsg.slice(0, 500),
      },
    });
  } catch {
    log.error({ messageId }, 'Failed to mark message as FAILED');
  }
}

function extractionConfidence(extraction: { confidence: Record<string, number> }): number {
  const values = Object.values(extraction.confidence);
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}
