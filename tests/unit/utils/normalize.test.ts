import { describe, it, expect } from 'vitest';
import { normalizeName, normalizeTaxId, normalizePhone, normalizeEmail, canonicalValue } from '../../../src/utils/normalize.js';

describe('normalizeName', () => {
  it('lowercases and strips diacritics', () => {
    expect(normalizeName('García')).toBe('garcia');
    expect(normalizeName('María')).toBe('maria');
    expect(normalizeName('López')).toBe('lopez');
  });

  it('trims whitespace', () => {
    expect(normalizeName('  Thomas  ')).toBe('thomas');
  });
});

describe('normalizeTaxId', () => {
  it('strips whitespace and uppercases', () => {
    expect(normalizeTaxId('65 432 187 909')).toBe('65432187909');
    expect(normalizeTaxId('12345678a')).toBe('12345678A');
    expect(normalizeTaxId('12345678A')).toBe('12345678A');
  });
});

describe('normalizePhone', () => {
  it('strips non-digit chars except leading +', () => {
    expect(normalizePhone('+34 612 345 678')).toBe('+34612345678');
    expect(normalizePhone('+49 30 9876543')).toBe('+49309876543');
    expect(normalizePhone('(555) 123-4567')).toBe('5551234567');
  });
});

describe('normalizeEmail', () => {
  it('lowercases and trims', () => {
    expect(normalizeEmail(' Maria.Garcia@Email.COM ')).toBe('maria.garcia@email.com');
  });
});

describe('canonicalValue', () => {
  it('trims strings', () => {
    expect(canonicalValue('  hello  ')).toBe('hello');
  });

  it('sorts object keys deterministically', () => {
    const a = canonicalValue({ city: 'Munich', street: 'Main St' });
    const b = canonicalValue({ street: 'Main St', city: 'Munich' });
    expect(a).toBe(b);
  });

  it('handles null/undefined', () => {
    expect(canonicalValue(null)).toBe('');
    expect(canonicalValue(undefined)).toBe('');
  });
});
