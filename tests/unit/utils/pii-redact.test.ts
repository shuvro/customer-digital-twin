import { describe, it, expect } from 'vitest';
import { redactPii } from '../../../src/utils/pii-redact.js';

describe('redactPii', () => {
  it('redacts email addresses', () => {
    expect(redactPii('Contact me at john@example.com')).toBe('Contact me at [EMAIL]');
  });

  it('redacts phone numbers', () => {
    expect(redactPii('Call +34 612 345 678')).toBe('Call [PHONE]');
  });

  it('redacts dates', () => {
    expect(redactPii('Born on 14/03/1985')).toBe('Born on [DATE]');
    expect(redactPii('Date: 22.07.1978')).toBe('Date: [DATE]');
  });

  it('redacts Spanish tax IDs', () => {
    expect(redactPii('TaxID: 12345678A')).toBe('TaxID: [TAXID]');
  });

  it('leaves non-PII text unchanged', () => {
    expect(redactPii('Hello world')).toBe('Hello world');
  });
});
