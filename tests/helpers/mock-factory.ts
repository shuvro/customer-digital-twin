import { vi } from 'vitest';
import { mockExtraction } from './llm-mock.js';

export function createLLMMock() {
  return {
    callWithRetryAndFallback: vi.fn(async (opts: { userPrompt: string }) => {
      // Pass the full userPrompt text — includes From:, Subject:, and body
      const result = mockExtraction(opts.userPrompt);
      return JSON.stringify(result);
    }),
  };
}
