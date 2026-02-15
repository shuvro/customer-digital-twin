import { jaroWinkler } from './fuzzy.js';
import { normalizeName, normalizeTaxId, normalizePhone, normalizeEmail } from '../utils/normalize.js';
import type { ExtractedPerson } from '../types/extraction.js';
import { prisma } from '../db.js';
import { logger } from '../logger.js';

export interface MatchCandidate {
  customerId: string;
  score: number;
  signals: string[];
  taxIdMatch: boolean;
}

/** Data needed from an existing customer for scoring — no Prisma dependency */
export interface CustomerForScoring {
  id: string;
  firstName: string | null;
  lastName: string | null;
  dateOfBirth: Date | null;
  gender: string | null;
  taxId: string | null;
  emails: string[];
  phones: string[];
}

/**
 * Pure scoring function — no database access.
 * Computes a match score between an extracted person and an existing customer.
 */
export function scoreCandidate(person: ExtractedPerson, customer: CustomerForScoring): MatchCandidate {
  let score = 0;
  const signals: string[] = [];
  let taxIdMatch = false;

  // Hard rule: exact taxId match
  if (person.taxId && customer.taxId) {
    const extractedTaxId = normalizeTaxId(person.taxId);
    const existingTaxId = normalizeTaxId(customer.taxId);
    if (extractedTaxId === existingTaxId) {
      taxIdMatch = true;
      score = 1.0;
      signals.push('taxId');

      // Check for immutable contradictions
      if (person.dateOfBirth && customer.dateOfBirth) {
        const extractedDob = person.dateOfBirth;
        const existingDob = customer.dateOfBirth.toISOString().split('T')[0];
        if (extractedDob !== existingDob) {
          signals.push('dob_conflict');
        }
      }
      if (person.gender && customer.gender) {
        if (person.gender.toLowerCase() !== customer.gender.toLowerCase()) {
          signals.push('gender_conflict');
        }
      }

      return { customerId: customer.id, score, signals, taxIdMatch };
    }
  }

  // Weighted composite scoring
  // Email match (weight: 0.6)
  if (person.emails && person.emails.length > 0) {
    const customerEmails = customer.emails.map(e => normalizeEmail(e));
    for (const email of person.emails) {
      if (customerEmails.includes(normalizeEmail(email))) {
        score += 0.6;
        signals.push('email');
        break;
      }
    }
  }

  // Phone match (weight: 0.5)
  if (person.phones && person.phones.length > 0) {
    const customerPhones = customer.phones.map(p => normalizePhone(p));
    for (const phone of person.phones) {
      if (customerPhones.includes(normalizePhone(phone))) {
        score += 0.5;
        signals.push('phone');
        break;
      }
    }
  }

  // Name fuzzy match (weight: up to 0.5)
  if (person.firstName && person.lastName && customer.firstName && customer.lastName) {
    const firstSim = jaroWinkler(
      normalizeName(person.firstName),
      normalizeName(customer.firstName),
    );
    const lastSim = jaroWinkler(
      normalizeName(person.lastName),
      normalizeName(customer.lastName),
    );
    const nameSim = (firstSim + lastSim) / 2;
    if (nameSim > 0.85) {
      score += nameSim * 0.5;
      signals.push('name');
    }
  }

  // DOB exact match (weight: 0.3)
  if (person.dateOfBirth && customer.dateOfBirth) {
    const existingDob = customer.dateOfBirth.toISOString().split('T')[0];
    if (person.dateOfBirth === existingDob) {
      score += 0.3;
      signals.push('dob');
    }
  }

  // Clamp score to [0, 1]
  score = Math.min(1.0, score);

  return { customerId: customer.id, score, signals, taxIdMatch };
}

/**
 * Finds match candidates by scoring the extracted person against all existing customers.
 * Uses the database to load customers, then delegates to the pure scoreCandidate function.
 */
export async function findMatchCandidates(person: ExtractedPerson): Promise<MatchCandidate[]> {
  const customers = await prisma.customer.findMany({
    include: {
      attributes: {
        where: { isCurrent: true },
      },
    },
  });

  if (customers.length === 0) return [];

  const candidates: MatchCandidate[] = [];

  for (const customer of customers) {
    const customerForScoring: CustomerForScoring = {
      id: customer.id,
      firstName: customer.firstName,
      lastName: customer.lastName,
      dateOfBirth: customer.dateOfBirth,
      gender: customer.gender,
      taxId: customer.taxId,
      emails: customer.attributes.filter(a => a.field === 'email').map(a => a.value),
      phones: customer.attributes.filter(a => a.field === 'phone').map(a => a.value),
    };

    const candidate = scoreCandidate(person, customerForScoring);

    if (candidate.score > 0) {
      candidates.push(candidate);
    }
  }

  // Sort by score descending
  candidates.sort((a, b) => b.score - a.score);

  logger.info({
    candidateCount: candidates.length,
    bestScore: candidates[0]?.score ?? 0,
  }, 'Scoring complete');

  return candidates;
}
