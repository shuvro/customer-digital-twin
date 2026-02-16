import OpenAI from 'openai';
import { config } from '../config.js';

let primaryClient: OpenAI | null = null;
let fallbackClient: OpenAI | null = null;

export function getPrimaryClient(): OpenAI {
  if (!primaryClient) {
    primaryClient = new OpenAI({
      apiKey: config.nebius.apiKey,
      baseURL: config.nebius.primary.baseURL,
    });
  }
  return primaryClient;
}

export function getFallbackClient(): OpenAI {
  if (!fallbackClient) {
    fallbackClient = new OpenAI({
      apiKey: config.nebius.apiKey,
      baseURL: config.nebius.fallback.baseURL,
    });
  }
  return fallbackClient;
}
