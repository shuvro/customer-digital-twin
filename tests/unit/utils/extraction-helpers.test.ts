import { describe, it, expect } from 'vitest';
import { extractFieldValues, extractScalarField, hasIdentifyingInfo } from '../../../src/utils/extraction-helpers.js';
import type { ExtractedPerson } from '../../../src/types/extraction.js';

describe('extractFieldValues', () => {
  const attributes = [
    { field: 'email', value: 'alice@test.com' },
    { field: 'phone', value: '+34 612 345 678' },
    { field: 'email', value: 'bob@test.com' },
    { field: 'address', value: 'Madrid, Spain' },
  ];

  it('extracts all values for a given field', () => {
    expect(extractFieldValues(attributes, 'email')).toEqual(['alice@test.com', 'bob@test.com']);
  });

  it('returns single value for unique fields', () => {
    expect(extractFieldValues(attributes, 'phone')).toEqual(['+34 612 345 678']);
  });

  it('returns empty array for non-existent field', () => {
    expect(extractFieldValues(attributes, 'occupation')).toEqual([]);
  });

  it('handles empty attribute list', () => {
    expect(extractFieldValues([], 'email')).toEqual([]);
  });
});

describe('extractScalarField', () => {
  const attributes = [
    { field: 'occupation', value: 'Engineer' },
    { field: 'employer', value: 'TechCorp' },
    { field: 'email', value: 'test@test.com' },
  ];

  it('returns value for existing field', () => {
    expect(extractScalarField(attributes, 'occupation')).toBe('Engineer');
  });

  it('returns null for non-existent field', () => {
    expect(extractScalarField(attributes, 'maritalStatus')).toBeNull();
  });

  it('returns first match when multiple exist', () => {
    const attrs = [
      { field: 'occupation', value: 'Teacher' },
      { field: 'occupation', value: 'Engineer' },
    ];
    expect(extractScalarField(attrs, 'occupation')).toBe('Teacher');
  });

  it('handles empty attribute list', () => {
    expect(extractScalarField([], 'occupation')).toBeNull();
  });
});

describe('hasIdentifyingInfo', () => {
  it('returns false for null', () => {
    expect(hasIdentifyingInfo(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(hasIdentifyingInfo(undefined)).toBe(false);
  });

  it('returns false for person with no identifying fields', () => {
    const person: ExtractedPerson = {
      hobbies: ['hiking'],
      notes: ['some note'],
    };
    expect(hasIdentifyingInfo(person)).toBe(false);
  });

  it.each([
    ['firstName', { firstName: 'Maria' }],
    ['lastName', { lastName: 'García' }],
    ['taxId', { taxId: '12345678A' }],
    ['emails', { emails: ['test@test.com'] }],
    ['phones', { phones: ['+34 612 345 678'] }],
    ['dateOfBirth', { dateOfBirth: '1985-03-14' }],
  ] as const)('returns true when person has %s', (_field, person) => {
    expect(hasIdentifyingInfo(person)).toBe(true);
  });

  it('returns false for person with empty arrays', () => {
    const person: ExtractedPerson = {
      emails: [],
      phones: [],
    };
    expect(hasIdentifyingInfo(person)).toBe(false);
  });
});
