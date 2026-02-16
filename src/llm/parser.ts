import { extractionResultSchema } from '../schemas/extraction.schema.js';
import { LLMParsingError } from '../errors.js';
import type { ExtractionResult } from '../types/extraction.js';
import { toErrorMessage } from '../utils/errors.js';
import { logger } from '../logger.js';

export function extractJsonFromResponse(raw: string): string {
  // Strip Markdown code fences if present
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    const firstNewline = cleaned.indexOf('\n');
    cleaned = cleaned.slice(firstNewline + 1);
    const lastFence = cleaned.lastIndexOf('```');
    if (lastFence !== -1) {
      cleaned = cleaned.slice(0, lastFence);
    }
  }

  // Find the outermost JSON object
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new LLMParsingError('No JSON object found in LLM response');
  }

  return cleaned.slice(firstBrace, lastBrace + 1);
}

export function parseExtractionResponse(raw: string): ExtractionResult {
  const jsonStr = extractJsonFromResponse(raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    throw new LLMParsingError(`Invalid JSON in LLM response: ${toErrorMessage(e)}`);
  }

  const result = extractionResultSchema.safeParse(parsed);
  if (!result.success) {
    logger.warn({ errors: result.error.issues.map(i => i.path.join('.')) }, 'Zod validation issues, attempting lenient parse');
    // Try lenient: wrap single person in array
    const obj = parsed as Record<string, unknown>;
    if (obj && !obj.persons && (obj.firstName || obj.lastName)) {
      const lenient = extractionResultSchema.safeParse({
        persons: [obj],
        confidence: obj.confidence || {},
      });
      if (lenient.success) {
        return lenient.data as ExtractionResult;
      }
    }
    throw new LLMParsingError(`LLM response failed schema validation: ${result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ')}`);
  }

  return result.data as ExtractionResult;
}
