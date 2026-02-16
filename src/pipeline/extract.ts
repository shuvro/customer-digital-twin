import { callWithRetryAndFallback } from '../llm/retry.js';
import { SYSTEM_PROMPT, buildUserPrompt } from '../llm/prompts.js';
import { buildContextEnhancedUserPrompt } from '../llm/context-prompts.js';
import { parseExtractionResponse } from '../llm/parser.js';
import type { InboundMessage } from '../types/message.js';
import type { ExtractionResult, ExtractedPerson } from '../types/extraction.js';
import type { CustomerContext } from './context-builder.js';
import { logger } from '../logger.js';
import { LLMParsingError } from '../errors.js';
import { toErrorMessage } from '../utils/errors.js';

/**
 * Post-extraction validation: sanity-check extracted fields.
 * Invalid fields are removed (set to null or filtered out).
 */
export function validateExtraction(person: ExtractedPerson): ExtractedPerson {
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

/**
 * Core extraction logic: call LLM with a prompt, parse the response,
 * retry once with error feedback on parse failure, then validate.
 */
async function runExtraction(messageId: string, userPrompt: string, label: string): Promise<ExtractionResult> {
  const raw = await callWithRetryAndFallback({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
  });

  let result: ExtractionResult;
  try {
    result = parseExtractionResponse(raw);
  } catch (parseErr) {
    logger.warn({ messageId }, `${label} parse failed, retrying with error feedback`);
    const retryPrompt = `${userPrompt}\n\n[SYSTEM NOTE: Your previous response was not valid JSON. Error: ${toErrorMessage(parseErr)}. Please respond with ONLY a valid JSON object matching the schema.]`;
    try {
      const retryRaw = await callWithRetryAndFallback({
        systemPrompt: SYSTEM_PROMPT,
        userPrompt: retryPrompt,
      });
      result = parseExtractionResponse(retryRaw);
    } catch {
      throw new LLMParsingError(`Failed to parse LLM response after retry: ${toErrorMessage(parseErr)}`);
    }
  }

  result.rawResponse = raw;
  result.persons = result.persons.map(validateExtraction);

  logger.info({ messageId, personCount: result.persons.length }, `${label} completed`);

  return result;
}

export async function extractFromMessage(message: InboundMessage): Promise<ExtractionResult> {
  return runExtraction(message.id, buildUserPrompt(message), 'Extraction');
}

export async function reExtractWithContext(
  message: InboundMessage,
  customerContext: CustomerContext,
): Promise<ExtractionResult | null> {
  try {
    const userPrompt = buildContextEnhancedUserPrompt(message, customerContext);
    return await runExtraction(message.id, userPrompt, 'Re-extraction with context');
  } catch (err) {
    logger.warn({ messageId: message.id, error: toErrorMessage(err) }, 'Re-extraction failed, falling back to original extraction');
    return null;
  }
}
