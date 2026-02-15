import { describe, it, expect } from 'vitest';
import { scoreCandidate, type CustomerForScoring } from '../../../src/matching/scorer.js';
import type { ExtractedPerson } from '../../../src/types/extraction.js';

function makeCustomer(overrides: Partial<CustomerForScoring> = {}): CustomerForScoring {
  return {
    id: 'cust-1',
    firstName: 'María',
    lastName: 'García López',
    dateOfBirth: new Date('1985-03-14T00:00:00Z'),
    gender: 'Female',
    taxId: '12345678A',
    emails: ['m.garcia85@gmail.com'],
    phones: ['+34612345678'],
    ...overrides,
  };
}

function makePerson(overrides: Partial<ExtractedPerson> = {}): ExtractedPerson {
  return {
    firstName: 'María',
    lastName: 'García López',
    dateOfBirth: '1985-03-14',
    gender: 'Female',
    taxId: '12345678A',
    nationality: 'Spanish',
    emails: ['m.garcia85@gmail.com'],
    phones: ['+34 612 345 678'],
    addresses: [],
    maritalStatus: undefined,
    occupation: undefined,
    employer: undefined,
    hobbies: [],
    needs: [],
    riskIndicators: [],
    communicationPreferences: [],
    familyContext: [],
    notes: [],
    ...overrides,
  };
}

describe('scoreCandidate', () => {
  describe('taxId matching (hard rule)', () => {
    it('exact taxId match returns score 1.0 and taxIdMatch=true', () => {
      const result = scoreCandidate(
        makePerson({ taxId: '12345678A' }),
        makeCustomer({ taxId: '12345678A' }),
      );
      expect(result.score).toBe(1.0);
      expect(result.taxIdMatch).toBe(true);
      expect(result.signals).toContain('taxId');
    });

    it('taxId match with different casing/spacing still matches', () => {
      const result = scoreCandidate(
        makePerson({ taxId: '65 432 187 909' }),
        makeCustomer({ taxId: '65432187909' }),
      );
      expect(result.score).toBe(1.0);
      expect(result.taxIdMatch).toBe(true);
    });

    it('taxId match with DOB conflict flags dob_conflict signal', () => {
      const result = scoreCandidate(
        makePerson({ taxId: '12345678A', dateOfBirth: '1990-01-01' }),
        makeCustomer({ taxId: '12345678A', dateOfBirth: new Date('1985-03-14T00:00:00Z') }),
      );
      expect(result.score).toBe(1.0);
      expect(result.signals).toContain('taxId');
      expect(result.signals).toContain('dob_conflict');
    });

    it('taxId match with gender conflict flags gender_conflict signal', () => {
      const result = scoreCandidate(
        makePerson({ taxId: '12345678A', gender: 'Male' }),
        makeCustomer({ taxId: '12345678A', gender: 'Female' }),
      );
      expect(result.signals).toContain('gender_conflict');
    });

    it('different taxIds do not trigger hard rule', () => {
      const result = scoreCandidate(
        makePerson({ taxId: '99999999Z' }),
        makeCustomer({ taxId: '12345678A' }),
      );
      expect(result.taxIdMatch).toBe(false);
      // Falls through to composite scoring
    });
  });

  describe('email matching', () => {
    it('matching email adds 0.6 to score', () => {
      const result = scoreCandidate(
        makePerson({ taxId: undefined, emails: ['m.garcia85@gmail.com'], phones: [], firstName: undefined, lastName: undefined, dateOfBirth: undefined }),
        makeCustomer({ taxId: null, emails: ['m.garcia85@gmail.com'] }),
      );
      expect(result.score).toBeCloseTo(0.6, 2);
      expect(result.signals).toContain('email');
    });

    it('email match is case-insensitive', () => {
      const result = scoreCandidate(
        makePerson({ taxId: undefined, emails: ['M.GARCIA85@GMAIL.COM'], phones: [], firstName: undefined, lastName: undefined, dateOfBirth: undefined }),
        makeCustomer({ taxId: null, emails: ['m.garcia85@gmail.com'] }),
      );
      expect(result.signals).toContain('email');
    });

    it('non-matching email contributes 0', () => {
      const result = scoreCandidate(
        makePerson({ taxId: undefined, emails: ['other@email.com'], phones: [], firstName: undefined, lastName: undefined, dateOfBirth: undefined }),
        makeCustomer({ taxId: null, emails: ['m.garcia85@gmail.com'] }),
      );
      expect(result.score).toBe(0);
      expect(result.signals).not.toContain('email');
    });
  });

  describe('phone matching', () => {
    it('matching phone adds 0.5 to score', () => {
      const result = scoreCandidate(
        makePerson({ taxId: undefined, emails: [], phones: ['+34 612 345 678'], firstName: undefined, lastName: undefined, dateOfBirth: undefined }),
        makeCustomer({ taxId: null, phones: ['+34612345678'] }),
      );
      expect(result.score).toBeCloseTo(0.5, 2);
      expect(result.signals).toContain('phone');
    });
  });

  describe('name fuzzy matching', () => {
    it('identical names after normalization add ~0.5 to score', () => {
      const result = scoreCandidate(
        makePerson({ taxId: undefined, emails: [], phones: [], dateOfBirth: undefined }),
        makeCustomer({ taxId: null }),
      );
      expect(result.signals).toContain('name');
      expect(result.score).toBeCloseTo(0.5, 1);
    });

    it('similar names (diacritics only) still match', () => {
      const result = scoreCandidate(
        makePerson({ taxId: undefined, firstName: 'Maria', lastName: 'Garcia Lopez', emails: [], phones: [], dateOfBirth: undefined }),
        makeCustomer({ taxId: null, firstName: 'María', lastName: 'García López' }),
      );
      expect(result.signals).toContain('name');
    });

    it('completely different names do not match', () => {
      const result = scoreCandidate(
        makePerson({ taxId: undefined, firstName: 'Thomas', lastName: 'Weber', emails: [], phones: [], dateOfBirth: undefined }),
        makeCustomer({ taxId: null, firstName: 'María', lastName: 'García López' }),
      );
      expect(result.signals).not.toContain('name');
      expect(result.score).toBe(0);
    });
  });

  describe('DOB matching', () => {
    it('exact DOB match adds 0.3 to score', () => {
      const result = scoreCandidate(
        makePerson({ taxId: undefined, emails: [], phones: [], firstName: undefined, lastName: undefined }),
        makeCustomer({ taxId: null }),
      );
      expect(result.signals).toContain('dob');
      expect(result.score).toBeCloseTo(0.3, 2);
    });

    it('different DOB does not add score', () => {
      const result = scoreCandidate(
        makePerson({ taxId: undefined, emails: [], phones: [], firstName: undefined, lastName: undefined, dateOfBirth: '2000-01-01' }),
        makeCustomer({ taxId: null }),
      );
      expect(result.signals).not.toContain('dob');
    });
  });

  describe('composite scoring', () => {
    it('email + name exceeds highThreshold (0.7)', () => {
      const result = scoreCandidate(
        makePerson({ taxId: undefined, phones: [], dateOfBirth: undefined }),
        makeCustomer({ taxId: null }),
      );
      expect(result.score).toBeGreaterThanOrEqual(0.7);
      expect(result.signals).toContain('email');
      expect(result.signals).toContain('name');
    });

    it('all signals produce clamped score of 1.0', () => {
      const result = scoreCandidate(
        makePerson({ taxId: undefined }),
        makeCustomer({ taxId: null }),
      );
      // email(0.6) + phone(0.5) + name(~0.5) + dob(0.3) > 1.0
      expect(result.score).toBe(1.0);
      expect(result.signals).toContain('email');
      expect(result.signals).toContain('phone');
      expect(result.signals).toContain('name');
      expect(result.signals).toContain('dob');
    });

    it('no matching fields returns score 0', () => {
      const result = scoreCandidate(
        makePerson({ taxId: undefined, firstName: 'Xyz', lastName: 'Abc', emails: ['x@y.com'], phones: ['+1111'], dateOfBirth: '2000-01-01' }),
        makeCustomer({ taxId: null }),
      );
      expect(result.score).toBe(0);
      expect(result.signals).toHaveLength(0);
    });
  });
});
