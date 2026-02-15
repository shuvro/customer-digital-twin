import { callWithRetryAndFallback } from '../llm/retry.js';
import { SYSTEM_PROMPT, buildUserPrompt } from '../llm/prompts.js';
import { parseExtractionResponse } from '../llm/parser.js';
import type { InboundMessage } from '../types/message.js';
import type { ExtractionResult, ExtractedPerson } from '../types/extraction.js';
import { logger } from '../logger.js';
import { LLMParsingError } from '../errors.js';

/**
 * Post-extraction validation: sanity-check extracted fields.
 * Invalid fields are removed (set to null or filtered out).
 */
function validateExtraction(person: ExtractedPerson): ExtractedPerson {
  const validated = { ...person };

  // DOB plausibility
  if (validated.dateOfBirth) {
    const dob = new Date(validated.dateOfBirth);
    const now = new Date();
    if (isNaN(dob.getTime())) {
      logger.warn({ field: 'dateOfBirth' }, 'Invalid date format, removing');
      validated.dateOfBirth = null;
    } else {
      const year = dob.getFullYear();
      if (year < 1900 || year > now.getFullYear()) {
        logger.warn({ field: 'dateOfBirth' }, 'Implausible date, removing');
        validated.dateOfBirth = null;
      }
    }
  }

  // Phone: at least 7 digits
  if (validated.phones) {
    validated.phones = validated.phones.filter(p => {
      const digits = p.replace(/\D/g, '');
      if (digits.length < 7) {
        logger.warn({ field: 'phone' }, 'Phone too short, removing');
        return false;
      }
      return true;
    });
  }

  // Email: basic @ check
  if (validated.emails) {
    validated.emails = validated.emails.filter(e => {
      if (!e.includes('@') || !e.includes('.')) {
        logger.warn({ field: 'email' }, 'Invalid email format, removing');
        return false;
      }
      return true;
    });
  }

  // Tax ID: at least 5 chars
  if (validated.taxId && validated.taxId.replace(/\s/g, '').length < 5) {
    logger.warn({ field: 'taxId' }, 'Tax ID too short, removing');
    validated.taxId = null;
  }

  // Address completeness: need at least city or fullAddress
  if (validated.addresses) {
    validated.addresses = validated.addresses.filter(a => {
      if (!a.city && !a.fullAddress) {
        logger.warn({ field: 'address' }, 'Address missing city and fullAddress, removing');
        return false;
      }
      return true;
    });
  }

  return validated;
}

export async function extractFromMessage(message: InboundMessage): Promise<ExtractionResult> {
  const userPrompt = buildUserPrompt(message);

  const raw = await callWithRetryAndFallback({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
  });

  let result: ExtractionResult;
  try {
    result = parseExtractionResponse(raw);
  } catch (parseErr) {
    // Retry once with error feedback
    logger.warn({ messageId: message.id }, 'First parse failed, retrying with error feedback');
    const retryPrompt = `${userPrompt}\n\n[SYSTEM NOTE: Your previous response was not valid JSON. Error: ${(parseErr as Error).message}. Please respond with ONLY a valid JSON object matching the schema.]`;
    try {
      const retryRaw = await callWithRetryAndFallback({
        systemPrompt: SYSTEM_PROMPT,
        userPrompt: retryPrompt,
      });
      result = parseExtractionResponse(retryRaw);
    } catch {
      throw new LLMParsingError(`Failed to parse LLM response after retry: ${(parseErr as Error).message}`);
    }
  }

  // Store raw response for debugging
  result.rawResponse = raw;

  // Validate each person
  result.persons = result.persons.map(validateExtraction);

  logger.info({
    messageId: message.id,
    personCount: result.persons.length,
  }, 'Extraction completed');

  return result;
}
