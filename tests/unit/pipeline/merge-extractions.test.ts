import { describe, it, expect } from 'vitest';
import { mergeExtractions, mergeConfidence } from '../../../src/pipeline/merge-extractions.js';
import type { ExtractedPerson, FieldConfidence } from '../../../src/types/extraction.js';

function person(overrides: Partial<ExtractedPerson> = {}): ExtractedPerson {
  return { firstName: null, lastName: null, ...overrides };
}

describe('mergeExtractions', () => {
  describe('identity fields (first pass wins)', () => {
    it('keeps original identity when both have values', () => {
      const original = person({ firstName: 'Maria', lastName: 'García' });
      const reExtracted = person({ firstName: 'María', lastName: 'Garcia Lopez' });
      const { merged } = mergeExtractions(original, reExtracted);
      expect(merged.firstName).toBe('Maria');
      expect(merged.lastName).toBe('García');
    });

    it('fills in missing identity from re-extraction', () => {
      const original = person({ firstName: 'Maria' });
      const reExtracted = person({ firstName: 'Maria', nationality: 'Spanish', taxId: '12345678A' });
      const { merged, fieldsAdded } = mergeExtractions(original, reExtracted);
      expect(merged.nationality).toBe('Spanish');
      expect(merged.taxId).toBe('12345678A');
      expect(fieldsAdded).toContain('nationality');
      expect(fieldsAdded).toContain('taxId');
    });

    it('does not overwrite original null with re-extracted null', () => {
      const original = person({ dateOfBirth: null });
      const reExtracted = person({ dateOfBirth: null });
      const { merged, fieldsAdded, fieldsChanged } = mergeExtractions(original, reExtracted);
      expect(merged.dateOfBirth).toBeNull();
      expect(fieldsAdded).not.toContain('dateOfBirth');
      expect(fieldsChanged).not.toContain('dateOfBirth');
    });
  });

  describe('scalar mutable fields (re-extraction wins)', () => {
    it('re-extraction overwrites original scalar value', () => {
      const original = person({ occupation: 'Teacher' });
      const reExtracted = person({ occupation: 'Engineer' });
      const { merged, fieldsChanged } = mergeExtractions(original, reExtracted);
      expect(merged.occupation).toBe('Engineer');
      expect(fieldsChanged).toContain('occupation');
    });

    it('re-extraction fills missing scalar', () => {
      const original = person({});
      const reExtracted = person({ employer: 'TechCorp' });
      const { merged, fieldsAdded } = mergeExtractions(original, reExtracted);
      expect(merged.employer).toBe('TechCorp');
      expect(fieldsAdded).toContain('employer');
    });

    it('keeps original when re-extraction is null', () => {
      const original = person({ maritalStatus: 'Married' });
      const reExtracted = person({ maritalStatus: undefined });
      const { merged, fieldsChanged } = mergeExtractions(original, reExtracted);
      expect(merged.maritalStatus).toBe('Married');
      expect(fieldsChanged).not.toContain('maritalStatus');
    });

    it('does not track unchanged scalar as changed', () => {
      const original = person({ occupation: 'Engineer' });
      const reExtracted = person({ occupation: 'Engineer' });
      const { merged, fieldsChanged, fieldsAdded } = mergeExtractions(original, reExtracted);
      expect(merged.occupation).toBe('Engineer');
      expect(fieldsChanged).not.toContain('occupation');
      expect(fieldsAdded).not.toContain('occupation');
    });
  });

  describe('list fields (union)', () => {
    it('unions email lists and deduplicates', () => {
      const original = person({ emails: ['a@b.com', 'c@d.com'] });
      const reExtracted = person({ emails: ['c@d.com', 'e@f.com'] });
      const { merged } = mergeExtractions(original, reExtracted);
      expect(merged.emails).toEqual(['a@b.com', 'c@d.com', 'e@f.com']);
    });

    it('unions phone lists', () => {
      const original = person({ phones: ['+34 612 345 678'] });
      const reExtracted = person({ phones: ['+34 612 345 678', '+49 170 123 4567'] });
      const { merged } = mergeExtractions(original, reExtracted);
      expect(merged.phones).toHaveLength(2);
      expect(merged.phones).toContain('+49 170 123 4567');
    });

    it('tracks list growth as changed', () => {
      const original = person({ emails: ['a@b.com'] });
      const reExtracted = person({ emails: ['a@b.com', 'new@test.com'] });
      const { fieldsChanged } = mergeExtractions(original, reExtracted);
      expect(fieldsChanged).toContain('emails');
    });

    it('tracks list creation as added', () => {
      const original = person({});
      const reExtracted = person({ hobbies: ['hiking'] });
      const { fieldsAdded } = mergeExtractions(original, reExtracted);
      expect(fieldsAdded).toContain('hobbies');
    });

    it('handles both lists undefined', () => {
      const original = person({});
      const reExtracted = person({});
      const { merged, fieldsAdded, fieldsChanged } = mergeExtractions(original, reExtracted);
      expect(merged.notes).toBeUndefined();
      expect(fieldsAdded).not.toContain('notes');
      expect(fieldsChanged).not.toContain('notes');
    });

    it('deduplicates address objects by JSON equality', () => {
      const addr = { city: 'Madrid', country: 'Spain' };
      const original = person({ addresses: [addr] });
      const reExtracted = person({ addresses: [addr, { city: 'Berlin' }] });
      const { merged } = mergeExtractions(original, reExtracted);
      expect(merged.addresses).toHaveLength(2);
    });
  });
});

describe('mergeConfidence', () => {
  it('takes the max confidence for each field', () => {
    const original: FieldConfidence = { firstName: 0.8, lastName: 0.9 };
    const reExtracted: FieldConfidence = { firstName: 1.0, email: 0.7 };
    const merged = mergeConfidence(original, reExtracted);
    expect(merged.firstName).toBe(1.0);
    expect(merged.lastName).toBe(0.9);
    expect(merged.email).toBe(0.7);
  });

  it('handles empty original', () => {
    const merged = mergeConfidence({}, { firstName: 0.8 });
    expect(merged.firstName).toBe(0.8);
  });

  it('handles empty re-extraction', () => {
    const merged = mergeConfidence({ firstName: 0.8 }, {});
    expect(merged.firstName).toBe(0.8);
  });
});
