import type { SearchResult } from './search.js';
import type { PipelineContext, PipelineDecision } from '../types/pipeline.js';
import { config } from '../config.js';
import { logger } from '../logger.js';

export function decideAction(ctx: PipelineContext, searchResult: SearchResult): PipelineDecision {
  const { bestMatch } = searchResult;
  const messageId = ctx.message.id;

  // No identifying info at all → SKIP
  if (!ctx.person) {
    logger.info({ messageId }, 'No person extracted, skipping');
    return { action: 'SKIP', score: 0, signals: [] };
  }

  const hasIdentity = ctx.person.firstName || ctx.person.lastName || ctx.person.taxId ||
    (ctx.person.emails && ctx.person.emails.length > 0) ||
    (ctx.person.phones && ctx.person.phones.length > 0) ||
    ctx.person.dateOfBirth;

  if (!hasIdentity) {
    logger.info({ messageId }, 'No identifying info, skipping');
    return { action: 'SKIP', score: 0, signals: [] };
  }

  // No match candidates → CREATE
  if (!bestMatch) {
    logger.info({ messageId }, 'No match candidates, creating new customer');
    return { action: 'CREATE', score: 0, signals: [] };
  }

  // Hard rule: taxId match → always UPDATE
  if (bestMatch.taxIdMatch) {
    logger.info({ messageId, customerId: bestMatch.customerId, score: bestMatch.score }, 'TaxId match → UPDATE');
    return {
      action: 'UPDATE',
      customerId: bestMatch.customerId,
      score: bestMatch.score,
      signals: bestMatch.signals,
    };
  }

  // Weighted scoring thresholds
  const { highThreshold, lowThreshold, minSignalsForMedium } = config.matching;

  if (bestMatch.score >= highThreshold) {
    logger.info({ messageId, customerId: bestMatch.customerId, score: bestMatch.score }, 'High confidence match → UPDATE');
    return {
      action: 'UPDATE',
      customerId: bestMatch.customerId,
      score: bestMatch.score,
      signals: bestMatch.signals,
    };
  }

  if (bestMatch.score >= lowThreshold && bestMatch.signals.length >= minSignalsForMedium) {
    logger.info({ messageId, customerId: bestMatch.customerId, score: bestMatch.score }, 'Medium confidence with enough signals → UPDATE');
    return {
      action: 'UPDATE',
      customerId: bestMatch.customerId,
      score: bestMatch.score,
      signals: bestMatch.signals,
    };
  }

  // Below threshold → CREATE
  logger.info({ messageId, score: bestMatch.score, signals: bestMatch.signals }, 'Below threshold → CREATE');
  return { action: 'CREATE', score: bestMatch.score, signals: bestMatch.signals };
}
