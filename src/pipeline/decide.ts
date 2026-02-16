import type { SearchResult } from './search.js';
import type { PipelineContext, PipelineDecision } from '../types/pipeline.js';
import { config } from '../config.js';
import { hasIdentifyingInfo } from '../utils/extraction-helpers.js';
import { logger } from '../logger.js';

export function decideAction(ctx: PipelineContext, searchResult: SearchResult): PipelineDecision {
  const { bestMatch } = searchResult;
  const messageId = ctx.message.id;

  if (!hasIdentifyingInfo(ctx.person)) {
    logger.info({ messageId }, 'No identifying info, skipping');
    return {
      action: 'SKIP',
      score: 0,
      signals: [],
      reasoning: 'No identifying information extracted from message.',
      decisionCode: 'NO_IDENTIFYING_INFO',
    };
  }

  // No match candidates → CREATE
  if (!bestMatch) {
    logger.info({ messageId }, 'No match candidates, creating new customer');
    return {
      action: 'CREATE',
      score: 0,
      signals: [],
      reasoning: 'No existing customers matched. Creating new customer profile.',
      decisionCode: 'NO_CANDIDATES',
    };
  }

  // Hard rule: taxId match → always UPDATE
  if (bestMatch.taxIdMatch) {
    logger.info({ messageId, customerId: bestMatch.customerId, score: bestMatch.score }, 'TaxId match → UPDATE');
    return {
      action: 'UPDATE',
      customerId: bestMatch.customerId,
      score: bestMatch.score,
      signals: bestMatch.signals,
      reasoning: `Exact tax ID match with customer ${bestMatch.customerId}.`,
      decisionCode: 'TAXID_MATCH',
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
      reasoning: `High confidence match (score ${bestMatch.score.toFixed(2)} >= ${highThreshold}) with customer ${bestMatch.customerId}. Signals: ${bestMatch.signals.join(', ')}.`,
      decisionCode: 'HIGH_CONFIDENCE',
    };
  }

  if (bestMatch.score >= lowThreshold && bestMatch.signals.length >= minSignalsForMedium) {
    logger.info({ messageId, customerId: bestMatch.customerId, score: bestMatch.score }, 'Medium confidence with enough signals → UPDATE');
    return {
      action: 'UPDATE',
      customerId: bestMatch.customerId,
      score: bestMatch.score,
      signals: bestMatch.signals,
      reasoning: `Medium confidence match (score ${bestMatch.score.toFixed(2)} >= ${lowThreshold}) with ${bestMatch.signals.length} signal(s) for customer ${bestMatch.customerId}. Signals: ${bestMatch.signals.join(', ')}.`,
      decisionCode: 'MEDIUM_CONFIDENCE',
    };
  }

  // Below threshold → CREATE
  logger.info({ messageId, score: bestMatch.score, signals: bestMatch.signals }, 'Below threshold → CREATE');
  return {
    action: 'CREATE',
    score: bestMatch.score,
    signals: bestMatch.signals,
    reasoning: `Best match score ${bestMatch.score.toFixed(2)} below threshold ${lowThreshold}. Creating new customer profile.`,
    decisionCode: 'BELOW_THRESHOLD',
  };
}
