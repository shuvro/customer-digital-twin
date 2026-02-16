/**
 * Simple string → 32-bit integer hash for use as PostgreSQL advisory lock keys.
 * djb2-style hash, deterministic across Node processes.
 */
export function hashText(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash;
}
