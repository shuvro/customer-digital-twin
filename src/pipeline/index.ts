import { prisma } from '../db.js';
import { logger } from '../logger.js';
import { extractFromMessage, reExtractWithContext } from './extract.js';
import { searchCustomers, type SearchResult } from './search.js';
import { decideAction } from './decide.js';
import { persistExtraction } from './persist.js';
import { PipelineLogger } from './pipeline-logger.js';
import { buildCustomerContext } from './context-builder.js';
import { mergeExtractions, mergeConfidence } from './merge-extractions.js';
import type { InboundMessage } from '../types/message.js';
import type { PipelineContext, PipelineDecision } from '../types/pipeline.js';
import type { ExtractionResult, ExtractedPerson } from '../types/extraction.js';
import { Prisma } from '../generated/prisma/client.js';
import { metrics } from '../observability/metrics.js';
import { hashText } from '../utils/hash.js';
import { config } from '../config.js';
import { toErrorMessage, safeErrorMessage } from '../utils/errors.js';
import { round2 } from '../utils/normalize.js';
import type { Logger } from 'pino';
import type { PipelineStage } from '../generated/prisma/client.js';

// If a message has been PROCESSING for longer than this, treat it as abandoned
// (process crash, kill, timeout) and allow re-processing.
const STALE_PROCESSING_MS = 5 * 60 * 1000; // 5 minutes

const STRONG_SIGNALS = new Set(['taxId', 'email', 'phone', 'direct_lookup']);

function countStrongSignals(signals: string[]): number {
  return signals.filter(s => STRONG_SIGNALS.has(s)).length;
}

export interface PipelineResult {
  messageId: string;
  customerId: string | null;
  action: string;
  score: number;
  signals: string[];
}

// ---------------------------------------------------------------------------
// Helpers: extracted from processMessage to keep the orchestrator lean
// ---------------------------------------------------------------------------

function extractionConfidence(extraction: { confidence: Record<string, number> }): number {
  const values = Object.values(extraction.confidence);
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** List the non-empty field names on the first extracted person. */
function nonEmptyFields(person: ExtractedPerson): string[] {
  return Object.keys(person).filter(k => {
    const v = (person as Record<string, unknown>)[k];
    return v != null && v !== '' && !(Array.isArray(v) && v.length === 0);
  });
}

// ---------------------------------------------------------------------------
// Stage: EXTRACT
// ---------------------------------------------------------------------------

interface ExtractStageResult {
  extraction: ExtractionResult;
  person: ExtractedPerson;
}

async function runExtractStage(
  message: InboundMessage,
  pipelineLogger: PipelineLogger,
): Promise<ExtractStageResult | null> {
  const extractStart = Date.now();
  const extraction = await extractFromMessage(message);
  const extractDuration = Date.now() - extractStart;
  metrics.recordTiming('extract', extractDuration);

  const fieldsExtracted = extraction.persons.length > 0
    ? nonEmptyFields(extraction.persons[0])
    : [];

  const avgConfidence = extractionConfidence(extraction);

  pipelineLogger.log('EXTRACT', `Extracted ${extraction.persons.length} person(s)`, {
    personCount: extraction.persons.length,
    fieldsExtracted,
    avgConfidence: round2(avgConfidence),
  }, extractDuration);

  if (extraction.persons.length === 0) return null;

  return { extraction, person: extraction.persons[0] };
}

// ---------------------------------------------------------------------------
// Stage: SEARCH
// ---------------------------------------------------------------------------

async function runSearchStage(
  ctx: PipelineContext,
  pipelineLogger: PipelineLogger,
): Promise<SearchResult> {
  const searchStart = Date.now();
  const searchResult = await searchCustomers(ctx);
  const searchDuration = Date.now() - searchStart;
  metrics.recordTiming('search', searchDuration);

  const directLookupHits = searchResult.candidates.filter(c => c.signals.includes('direct_lookup')).length;

  // Capture top candidates (up to 5) for full search traceability.
  // This enables evaluators and auditors to see not just WHO was matched,
  // but all candidates considered and why each scored as it did.
  const topCandidates = searchResult.candidates.slice(0, 5).map(c => ({
    customerId: c.customerId,
    score: round2(c.score),
    signals: c.signals,
    taxIdMatch: c.taxIdMatch,
  }));

  pipelineLogger.log('SEARCH', `Found ${searchResult.candidates.length} candidate(s), best score ${(searchResult.bestMatch?.score ?? 0).toFixed(2)}`, {
    candidateCount: searchResult.candidates.length,
    bestScore: round2(searchResult.bestMatch?.score ?? 0),
    bestSignals: searchResult.bestMatch?.signals ?? [],
    directLookupHits,
    topCandidates,
  }, searchDuration);

  return searchResult;
}

// ---------------------------------------------------------------------------
// Stage: RE_EXTRACT (context-aware re-extraction)
// ---------------------------------------------------------------------------

interface ReExtractStageResult {
  person: ExtractedPerson;
  finalExtraction: ExtractionResult;
}

async function runReExtractStage(
  message: InboundMessage,
  log: Logger,
  searchResult: SearchResult,
  person: ExtractedPerson,
  extraction: ExtractionResult,
  pipelineLogger: PipelineLogger,
): Promise<ReExtractStageResult> {
  const bestMatch = searchResult.bestMatch;
  const shouldReExtract = bestMatch && (
      bestMatch.taxIdMatch ||
      bestMatch.score >= config.matching.highThreshold ||
      (bestMatch.score >= config.matching.lowThreshold && countStrongSignals(bestMatch.signals) >= 2)
  );

  if (!shouldReExtract) {
    pipelineLogger.log('RE_EXTRACT', 'Re-extraction not triggered (match confidence too low)', {
      triggered: false,
      fieldsChanged: [],
      fieldsAdded: [],
      mergeStrategy: 'none',
    });
    return { person, finalExtraction: extraction };
  }

  // bestMatch is guaranteed non-null here (shouldReExtract implies it)
  const reExtractStart = Date.now();
  try {
    const customerContext = await buildCustomerContext(bestMatch.customerId);
    const reExtractionResult = await reExtractWithContext(message, customerContext);

    if (reExtractionResult && reExtractionResult.persons.length > 0) {
      const mergeResult = mergeExtractions(person, reExtractionResult.persons[0]);

      pipelineLogger.log('RE_EXTRACT', `Re-extracted with customer context, ${mergeResult.fieldsChanged.length} field(s) changed`, {
        triggered: true,
        fieldsChanged: mergeResult.fieldsChanged,
        fieldsAdded: mergeResult.fieldsAdded,
        mergeStrategy: 'conservative',
      }, Date.now() - reExtractStart);

      return {
        person: mergeResult.merged,
        finalExtraction: {
          ...extraction,
          persons: [mergeResult.merged],
          confidence: mergeConfidence(extraction.confidence, reExtractionResult.confidence),
        },
      };
    }

    pipelineLogger.log('RE_EXTRACT', 'Re-extraction returned no results, keeping original', {
      triggered: true,
      fieldsChanged: [],
      fieldsAdded: [],
      mergeStrategy: 'fallback_to_original',
    }, Date.now() - reExtractStart);
  } catch (reExtractErr) {
    pipelineLogger.log('RE_EXTRACT', 'Re-extraction failed, keeping original', {
      triggered: true,
      fieldsChanged: [],
      fieldsAdded: [],
      mergeStrategy: 'fallback_to_original',
    }, Date.now() - reExtractStart);
    log.warn({ messageId: message.id, error: toErrorMessage(reExtractErr) }, 'Re-extraction failed');
  }

  return { person, finalExtraction: extraction };
}

// ---------------------------------------------------------------------------
// Stage: DECIDE
// ---------------------------------------------------------------------------

function runDecideStage(
  ctx: PipelineContext,
  searchResult: SearchResult,
  pipelineLogger: PipelineLogger,
): PipelineDecision {
  const decideStart = Date.now();
  const decision = decideAction(ctx, searchResult);
  const decideDuration = Date.now() - decideStart;
  metrics.recordTiming('decide', decideDuration);

  pipelineLogger.log('DECIDE', `${decision.action} via ${decision.decisionCode}`, {
    action: decision.action,
    decisionCode: decision.decisionCode,
    score: round2(decision.score),
    signals: decision.signals,
  }, decideDuration);

  return decision;
}

// ---------------------------------------------------------------------------
// Stage: PERSIST
// ---------------------------------------------------------------------------

async function runPersistStage(
  ctx: PipelineContext,
  finalExtraction: ExtractionResult,
  decision: PipelineDecision,
  pipelineLogger: PipelineLogger,
): Promise<string> {
  const messageId = ctx.message.id;
  const persistStart = Date.now();

  const customerId = await prisma.$transaction(async (tx) => {
    const cid = await persistExtraction(ctx, tx);

    await tx.message.update({
      where: { id: messageId },
      data: {
        status: 'COMPLETED',
        customerId: cid,
        extractionResult: finalExtraction as unknown as Prisma.InputJsonValue,
        confidence: extractionConfidence(finalExtraction),
        matchScore: decision.score,
        matchSignals: decision.signals as unknown as Prisma.InputJsonValue,
        decisionReasoning: decision.reasoning,
        decisionCode: decision.decisionCode,
        processedAt: new Date(),
      },
    });

    const [identitiesWritten, attributesWritten, insightsWritten] = await Promise.all([
      tx.customerIdentity.count({ where: { sourceMessageId: messageId } }),
      tx.customerAttribute.count({ where: { sourceMessageId: messageId } }),
      tx.customerInsight.count({ where: { sourceMessageId: messageId } }),
    ]);

    pipelineLogger.log('PERSIST', `Persisted to customer ${cid}`, {
      customerId: cid,
      identitiesWritten,
      attributesWritten,
      insightsWritten,
    }, Date.now() - persistStart);

    // Flush logs atomically with data
    await pipelineLogger.flush(tx);

    return cid;
  }, { timeout: 30000 });

  metrics.recordTiming('persist', Date.now() - persistStart);
  return customerId;
}

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

/**
 * Mark a message as FAILED outside any transaction so the status persists
 * even when the main transaction rolled back.
 */
async function markFailed(log: Logger, messageId: string, message: InboundMessage, err: unknown): Promise<void> {
  const safeMsg = safeErrorMessage(err, 500);
  try {
    await prisma.message.upsert({
      where: { id: messageId },
      create: {
        id: messageId,
        source: message.source,
        messageDate: new Date(message.messageDate),
        rawPayload: message as unknown as Prisma.InputJsonValue,
        status: 'FAILED',
        errorMessage: safeMsg,
      },
      update: {
        status: 'FAILED',
        errorMessage: safeMsg,
      },
    });
  } catch {
    log.error({ messageId }, 'Failed to mark message as FAILED');
  }
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export async function processMessage(message: InboundMessage, requestId?: string): Promise<PipelineResult> {
  const messageId = message.id;
  const pipelineStart = Date.now();
  const log: Logger = requestId ? logger.child({ requestId }) : logger;
  const pipelineLogger = new PipelineLogger(messageId);

  // Fast-path idempotency check (no lock needed).
  // No audit log for idempotent replays — the canonical pipeline audit trail
  // from the original processing run is the authoritative record.
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
  const claimResult = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${lockKey})`);

    const afterLock = await tx.message.findUnique({ where: { id: messageId } });

    if (afterLock?.status === 'COMPLETED') {
      return { alreadyDone: true as const, record: afterLock };
    }

    if (afterLock?.status === 'PROCESSING') {
      const age = Date.now() - afterLock.createdAt.getTime();
      const updatedAge = afterLock.processedAt
        ? Date.now() - afterLock.processedAt.getTime()
        : age;
      const effectiveAge = Math.min(age, updatedAge);

      if (effectiveAge < STALE_PROCESSING_MS) {
        return { alreadyDone: true as const, record: afterLock };
      }

      log.warn({ messageId, ageMs: effectiveAge }, 'Reclaiming stale PROCESSING message');
    }

    if (afterLock?.status === 'FAILED') {
      log.info({ messageId }, 'Retrying previously FAILED message');
    }

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
        processedAt: new Date(),
      },
    });

    return { alreadyDone: false as const };
  });

  // Handle already-processed / currently-processing.
  // No audit log for idempotent replays.
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
    return {
      messageId,
      customerId: record.customerId,
      action: 'ALREADY_PROCESSING',
      score: 0,
      signals: [],
    };
  }

  // --- Phase 2: Extract + Search + Re-extract + Decide + Persist ---
  metrics.increment('messagesReceived');
  let lastStage: PipelineStage = 'EXTRACT';

  try {
    // EXTRACT
    const extractResult = await runExtractStage(message, pipelineLogger);

    if (!extractResult) {
      await prisma.message.update({
        where: { id: messageId },
        data: {
          status: 'COMPLETED',
          extractionResult: { persons: [], confidence: {} } as unknown as Prisma.InputJsonValue,
          confidence: 0,
          processedAt: new Date(),
        },
      });
      metrics.increment('messagesSkipped');
      metrics.increment('messagesProcessed');
      metrics.recordTiming('total', Date.now() - pipelineStart);
      await pipelineLogger.flushDirect();
      return { messageId, customerId: null, action: 'SKIP', score: 0, signals: [] };
    }

    const { extraction, person: initialPerson } = extractResult;
    const ctx: PipelineContext = { message, extraction, person: initialPerson, requestId };

    // SEARCH
    lastStage = 'SEARCH';
    const searchResult = await runSearchStage(ctx, pipelineLogger);

    // RE_EXTRACT
    lastStage = 'RE_EXTRACT';
    const { person, finalExtraction } = await runReExtractStage(
      message, log, searchResult, initialPerson, extraction, pipelineLogger,
    );
    ctx.person = person;
    ctx.extraction = finalExtraction;

    // DECIDE
    lastStage = 'DECIDE';
    const decision = runDecideStage(ctx, searchResult, pipelineLogger);
    ctx.decision = decision;

    if (decision.action === 'SKIP') {
      await prisma.message.update({
        where: { id: messageId },
        data: {
          status: 'COMPLETED',
          extractionResult: finalExtraction as unknown as Prisma.InputJsonValue,
          confidence: extractionConfidence(finalExtraction),
          decisionReasoning: decision.reasoning,
          decisionCode: decision.decisionCode,
          processedAt: new Date(),
        },
      });
      metrics.increment('messagesSkipped');
      metrics.increment('messagesProcessed');
      metrics.recordTiming('total', Date.now() - pipelineStart);
      await pipelineLogger.flushDirect();
      return { messageId, customerId: null, action: 'SKIP', score: 0, signals: [] };
    }

    // PERSIST
    lastStage = 'PERSIST';
    const customerId = await runPersistStage(ctx, finalExtraction, decision, pipelineLogger);

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

    const safeMsg = safeErrorMessage(err, 200);

    pipelineLogger.log(lastStage, `Pipeline failed at ${lastStage} stage`, {
      stage: lastStage,
      errorType: err instanceof Error ? err.constructor.name : 'Unknown',
      errorMessage: safeMsg,
    });
    try {
      await pipelineLogger.flushDirect();
    } catch {
      log.warn({ messageId }, 'Failed to flush pipeline audit log on error path');
    }

    await markFailed(log, messageId, message, err);
    throw err;
  }
}
