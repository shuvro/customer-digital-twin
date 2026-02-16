import { redactPii } from './pii-redact.js';

/**
 * Safely extract an error message from an unknown thrown value.
 * Handles Error instances, strings, and arbitrary objects.
 */
export function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Check if a thrown value is a Prisma P2002 unique constraint violation.
 */
export function isPrismaUniqueConstraintError(err: unknown): boolean {
  return (err as { code?: string })?.code === 'P2002';
}

/**
 * Extract an error message, redact PII, and truncate to maxLength.
 */
export function safeErrorMessage(err: unknown, maxLength: number = 200): string {
  return redactPii(toErrorMessage(err)).slice(0, maxLength);
}
