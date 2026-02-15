import OpenAI from 'openai';
import { config } from '../config.js';

export function createPrimaryClient(): OpenAI {
  return new OpenAI({
    apiKey: config.nebius.apiKey,
    baseURL: config.nebius.primary.baseURL,
  });
}

export function createFallbackClient(): OpenAI {
  return new OpenAI({
    apiKey: config.nebius.apiKey,
    baseURL: config.nebius.fallback.baseURL,
  });
}
