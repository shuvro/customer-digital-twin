import { findMatchCandidates, type MatchCandidate } from '../matching/scorer.js';
import type { PipelineContext } from '../types/pipeline.js';
import { logger } from '../logger.js';

export interface SearchResult {
  candidates: MatchCandidate[];
  bestMatch: MatchCandidate | null;
}

export async function searchCustomers(ctx: PipelineContext): Promise<SearchResult> {
  const person = ctx.person;
  if (!person) {
    return { candidates: [], bestMatch: null };
  }

  // Check if we have any identifying info at all
  const hasIdentity = person.firstName || person.lastName || person.taxId ||
    (person.emails && person.emails.length > 0) ||
    (person.phones && person.phones.length > 0) ||
    person.dateOfBirth;

  if (!hasIdentity) {
    logger.info({ messageId: ctx.message.id }, 'No identifying info extracted, skipping search');
    return { candidates: [], bestMatch: null };
  }

  const candidates = await findMatchCandidates(person);

  logger.info({
    messageId: ctx.message.id,
    candidateCount: candidates.length,
    bestScore: candidates[0]?.score ?? 0,
    bestSignals: candidates[0]?.signals ?? [],
  }, 'Customer search completed');

  return {
    candidates,
    bestMatch: candidates[0] ?? null,
  };
}
