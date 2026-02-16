import { prisma } from '../db.js';
import { scoreCandidate, type CustomerForScoring } from '../matching/scorer.js';
import type { ExtractedPerson } from '../types/extraction.js';

export interface DuplicatePair {
  customerA: { id: string; firstName: string | null; lastName: string | null; taxId: string | null };
  customerB: { id: string; firstName: string | null; lastName: string | null; taxId: string | null };
  score: number;
  signals: string[];
}

export interface DuplicatesResult {
  duplicates: DuplicatePair[];
  totalCustomers: number;
  capped: boolean;
}

const MAX_CUSTOMERS = 500;
const DEFAULT_MIN_SCORE = 0.5;

export async function findDuplicates(minScore?: number): Promise<DuplicatesResult> {
  const threshold = minScore ?? DEFAULT_MIN_SCORE;

  const totalCustomers = await prisma.customer.count();

  if (totalCustomers > MAX_CUSTOMERS) {
    return { duplicates: [], totalCustomers, capped: true };
  }

  const customers = await prisma.customer.findMany({
    include: {
      attributes: { where: { isCurrent: true } },
    },
  });

  const duplicates: DuplicatePair[] = [];

  for (let i = 0; i < customers.length; i++) {
    for (let j = i + 1; j < customers.length; j++) {
      const a = customers[i];
      const b = customers[j];

      // scoreCandidate is directional — it only iterates fields present on the
      // "person" arg.  A sparse A scored against a rich B can under-score while
      // B→A would pass the threshold.  Score both directions and keep the max.
      const personA: ExtractedPerson = customerToPerson(a);
      const personB: ExtractedPerson = customerToPerson(b);

      const scoringA: CustomerForScoring = customerToScoring(a);
      const scoringB: CustomerForScoring = customerToScoring(b);

      const ab = scoreCandidate(personA, scoringB);
      const ba = scoreCandidate(personB, scoringA);

      const best = ab.score >= ba.score ? ab : ba;

      if (best.score >= threshold) {
        duplicates.push({
          customerA: { id: a.id, firstName: a.firstName, lastName: a.lastName, taxId: a.taxId },
          customerB: { id: b.id, firstName: b.firstName, lastName: b.lastName, taxId: b.taxId },
          score: best.score,
          signals: best.signals,
        });
      }
    }
  }

  // Sort by score descending
  duplicates.sort((a, b) => b.score - a.score);

  return { duplicates, totalCustomers, capped: false };
}

type CustomerWithAttrs = Awaited<
  ReturnType<typeof prisma.customer.findMany<{ include: { attributes: true } }>>
>[number];

function customerToPerson(c: CustomerWithAttrs): ExtractedPerson {
  return {
    firstName: c.firstName ?? undefined,
    lastName: c.lastName ?? undefined,
    dateOfBirth: c.dateOfBirth?.toISOString().split('T')[0],
    gender: c.gender ?? undefined,
    taxId: c.taxId ?? undefined,
    nationality: c.nationality ?? undefined,
    emails: c.attributes.filter((a) => a.field === 'email').map((a) => a.value),
    phones: c.attributes.filter((a) => a.field === 'phone').map((a) => a.value),
  };
}

function customerToScoring(c: CustomerWithAttrs): CustomerForScoring {
  return {
    id: c.id,
    firstName: c.firstName,
    lastName: c.lastName,
    dateOfBirth: c.dateOfBirth,
    gender: c.gender,
    taxId: c.taxId,
    emails: c.attributes.filter((a) => a.field === 'email').map((a) => a.value),
    phones: c.attributes.filter((a) => a.field === 'phone').map((a) => a.value),
  };
}
