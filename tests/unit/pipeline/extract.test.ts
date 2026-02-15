import { describe, it, expect } from 'vitest';
import { extractJsonFromResponse, parseExtractionResponse } from '../../../src/llm/parser.js';

describe('extractJsonFromResponse', () => {
  it('extracts JSON from clean response', () => {
    const raw = '{"persons": [], "confidence": {}}';
    expect(extractJsonFromResponse(raw)).toBe('{"persons": [], "confidence": {}}');
  });

  it('strips markdown fences', () => {
    const raw = '```json\n{"persons": [], "confidence": {}}\n```';
    expect(extractJsonFromResponse(raw)).toBe('{"persons": [], "confidence": {}}');
  });

  it('finds outermost braces', () => {
    const raw = 'Here is the result:\n{"persons": [{"firstName": "Maria"}], "confidence": {"firstName": 1.0}}';
    const json = extractJsonFromResponse(raw);
    expect(JSON.parse(json)).toBeTruthy();
    expect(JSON.parse(json).persons[0].firstName).toBe('Maria');
  });

  it('throws on no JSON found', () => {
    expect(() => extractJsonFromResponse('no json here')).toThrow('No JSON object found');
  });
});

describe('parseExtractionResponse', () => {
  it('parses valid extraction result', () => {
    const raw = JSON.stringify({
      persons: [{
        firstName: 'Maria',
        lastName: 'García López',
        dateOfBirth: '1985-03-14',
        emails: ['m.garcia85@gmail.com'],
        phones: ['+34 612 345 678'],
      }],
      confidence: { firstName: 1.0, lastName: 1.0 },
    });

    const result = parseExtractionResponse(raw);
    expect(result.persons).toHaveLength(1);
    expect(result.persons[0].firstName).toBe('Maria');
    expect(result.persons[0].lastName).toBe('García López');
  });

  it('handles empty persons array', () => {
    const raw = JSON.stringify({ persons: [], confidence: {} });
    const result = parseExtractionResponse(raw);
    expect(result.persons).toHaveLength(0);
  });

  it('handles markdown-wrapped response', () => {
    const raw = '```json\n' + JSON.stringify({
      persons: [{ firstName: 'Thomas' }],
      confidence: {},
    }) + '\n```';

    const result = parseExtractionResponse(raw);
    expect(result.persons[0].firstName).toBe('Thomas');
  });

  it('throws on invalid JSON', () => {
    expect(() => parseExtractionResponse('not json at all')).toThrow();
  });

  it('defaults missing array fields', () => {
    const raw = JSON.stringify({
      persons: [{ firstName: 'Maria' }],
      confidence: {},
    });
    const result = parseExtractionResponse(raw);
    expect(result.persons[0].emails).toEqual([]);
    expect(result.persons[0].phones).toEqual([]);
    expect(result.persons[0].hobbies).toEqual([]);
  });
});
