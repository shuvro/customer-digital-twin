import { describe, it, expect } from 'vitest';
import { jaroWinkler } from '../../../src/matching/fuzzy.js';

describe('jaroWinkler', () => {
  it('returns 1.0 for identical strings', () => {
    expect(jaroWinkler('Weber', 'Weber')).toBe(1.0);
  });

  it('returns 0.0 for empty strings', () => {
    expect(jaroWinkler('', 'Weber')).toBe(0.0);
    expect(jaroWinkler('Weber', '')).toBe(0.0);
  });

  it('returns high similarity for García vs Garcia', () => {
    expect(jaroWinkler('garcia', 'garcia')).toBe(1.0);
  });

  it('returns high similarity for similar names', () => {
    const sim = jaroWinkler('Thomas', 'Tomas');
    expect(sim).toBeGreaterThan(0.85);
  });

  it('returns low similarity for completely different strings', () => {
    const sim = jaroWinkler('Maria', 'Weber');
    expect(sim).toBeLessThan(0.6);
  });

  it('handles single character strings', () => {
    expect(jaroWinkler('a', 'a')).toBe(1.0);
    expect(jaroWinkler('a', 'b')).toBe(0.0);
  });
});
