import { describe, it, expect, vi } from 'vitest';
import { validateExtraction } from '../../../src/pipeline/extract.js';
import type { ExtractedPerson } from '../../../src/types/extraction.js';

// Suppress logger.warn output in tests
vi.mock('../../../src/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

function basePerson(overrides: Partial<ExtractedPerson> = {}): ExtractedPerson {
  return {
    firstName: 'Maria',
    lastName: 'García',
    ...overrides,
  };
}

describe('validateExtraction', () => {
  describe('dateOfBirth validation', () => {
    it('keeps a valid DOB', () => {
      const result = validateExtraction(basePerson({ dateOfBirth: '1985-03-14' }));
      expect(result.dateOfBirth).toBe('1985-03-14');
    });

    it('removes DOB with year before 1900', () => {
      const result = validateExtraction(basePerson({ dateOfBirth: '1850-01-01' }));
      expect(result.dateOfBirth).toBeNull();
    });

    it('removes DOB with year in the future', () => {
      const result = validateExtraction(basePerson({ dateOfBirth: '2099-01-01' }));
      expect(result.dateOfBirth).toBeNull();
    });

    it('removes unparseable DOB', () => {
      const result = validateExtraction(basePerson({ dateOfBirth: 'not-a-date' }));
      expect(result.dateOfBirth).toBeNull();
    });

  });

  describe('phone validation', () => {
    it('keeps phones with 7+ digits', () => {
      const result = validateExtraction(basePerson({ phones: ['+34 612 345 678'] }));
      expect(result.phones).toEqual(['+34 612 345 678']);
    });

    it('removes phones with fewer than 7 digits', () => {
      const result = validateExtraction(basePerson({ phones: ['123', '+34 612 345 678'] }));
      expect(result.phones).toEqual(['+34 612 345 678']);
    });

    it('removes all invalid phones', () => {
      const result = validateExtraction(basePerson({ phones: ['12345', '000'] }));
      expect(result.phones).toEqual([]);
    });

    it('keeps undefined phones as-is', () => {
      const result = validateExtraction(basePerson({ phones: undefined }));
      expect(result.phones).toBeUndefined();
    });
  });

  describe('email validation', () => {
    it('keeps valid emails', () => {
      const result = validateExtraction(basePerson({ emails: ['test@example.com'] }));
      expect(result.emails).toEqual(['test@example.com']);
    });

    it('removes emails without @', () => {
      const result = validateExtraction(basePerson({ emails: ['not-an-email', 'ok@test.com'] }));
      expect(result.emails).toEqual(['ok@test.com']);
    });

    it('removes emails without dot', () => {
      const result = validateExtraction(basePerson({ emails: ['user@localhost'] }));
      expect(result.emails).toEqual([]);
    });
  });

  describe('taxId validation', () => {
    it('keeps tax IDs with 5+ non-space chars', () => {
      const result = validateExtraction(basePerson({ taxId: '12345678A' }));
      expect(result.taxId).toBe('12345678A');
    });

    it('removes tax IDs shorter than 5 chars', () => {
      const result = validateExtraction(basePerson({ taxId: '123' }));
      expect(result.taxId).toBeNull();
    });

    it('counts only non-space chars for length', () => {
      const result = validateExtraction(basePerson({ taxId: '1 2 3' }));
      expect(result.taxId).toBeNull();
    });

  });

  describe('address validation', () => {
    it('keeps addresses with city', () => {
      const result = validateExtraction(basePerson({
        addresses: [{ city: 'Madrid', country: 'Spain' }],
      }));
      expect(result.addresses).toHaveLength(1);
    });

    it('keeps addresses with fullAddress', () => {
      const result = validateExtraction(basePerson({
        addresses: [{ fullAddress: 'Calle Mayor 1, Madrid' }],
      }));
      expect(result.addresses).toHaveLength(1);
    });

    it('removes addresses missing both city and fullAddress', () => {
      const result = validateExtraction(basePerson({
        addresses: [{ street: 'Some Street', country: 'Spain' }],
      }));
      expect(result.addresses).toHaveLength(0);
    });

    it('filters mixed valid and invalid addresses', () => {
      const result = validateExtraction(basePerson({
        addresses: [
          { city: 'Madrid' },
          { country: 'Spain' },
          { fullAddress: 'Berlin, Germany' },
        ],
      }));
      expect(result.addresses).toHaveLength(2);
    });
  });

  describe('passthrough', () => {
    it('does not modify unrelated fields', () => {
      const result = validateExtraction(basePerson({
        firstName: 'Thomas',
        lastName: 'Weber',
        nationality: 'German',
        gender: 'Male',
        occupation: 'Engineer',
      }));
      expect(result.firstName).toBe('Thomas');
      expect(result.lastName).toBe('Weber');
      expect(result.nationality).toBe('German');
      expect(result.gender).toBe('Male');
      expect(result.occupation).toBe('Engineer');
    });
  });
});
