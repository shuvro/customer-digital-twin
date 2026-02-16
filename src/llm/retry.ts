import type OpenAI from 'openai';
import { getPrimaryClient, getFallbackClient } from './client.js';
import { config } from '../config.js';
import { LLMExtractionError } from '../errors.js';
import { logger } from '../logger.js';

interface LLMCallOptions {
  systemPrompt: string;
  userPrompt: string;
}

async function callModel(
  client: OpenAI,
  model: string,
  opts: LLMCallOptions,
): Promise<string> {
  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: opts.systemPrompt },
      { role: 'user', content: opts.userPrompt },
    ],
    temperature: config.nebius.temperature,
    max_tokens: 4096,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new LLMExtractionError('LLM returned empty response');
  }
  return content;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function callWithRetryAndFallback(opts: LLMCallOptions): Promise<string> {
  const primary = getPrimaryClient();
  const { maxRetries, retryBaseDelayMs } = config.nebius;

  // Try primary model with retries
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await callModel(primary, config.nebius.primary.model, opts);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ attempt, model: config.nebius.primary.model, error: msg }, 'Primary LLM call failed');

      if (attempt < maxRetries) {
        const delay = retryBaseDelayMs * Math.pow(2, attempt - 1);
        await sleep(delay);
      }
    }
  }

  // Try fallback model once
  logger.info('Falling back to secondary model');
  const fallback = getFallbackClient();
  try {
    return await callModel(fallback, config.nebius.fallback.model, opts);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ model: config.nebius.fallback.model, error: msg }, 'Fallback LLM call failed');
    throw new LLMExtractionError('All LLM attempts exhausted (primary + fallback)');
  }
}
