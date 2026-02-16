/**
 * Format a Date as YYYY-MM-DD, or return null for nullish input.
 */
export function formatDateAsISO(date: Date | null | undefined): string | null {
  return date?.toISOString().split('T')[0] ?? null;
}

/**
 * Round a number to a given number of decimal places (default 2).
 */
export function round2(value: number, decimals: number = 2): number {
  const multiplier = 10 ** decimals;
  return Math.round(value * multiplier) / multiplier;
}

/**
 * Normalize a name for comparison: lowercase, strip diacritics, trim.
 */
export function normalizeName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Normalize a tax ID for comparison: strip whitespace, uppercase.
 */
export function normalizeTaxId(taxId: string): string {
  return taxId.replace(/\s+/g, '').toUpperCase();
}

/**
 * Normalize a phone number for comparison: strip everything except digits and leading +.
 */
export function normalizePhone(phone: string): string {
  const trimmed = phone.trim();
  if (trimmed.startsWith('+')) {
    return '+' + trimmed.slice(1).replace(/\D/g, '');
  }
  return trimmed.replace(/\D/g, '');
}

/**
 * Normalize an email for comparison: lowercase, trim.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Canonical serialization for storing values in TEXT columns.
 * Objects get stable JSON (sorted keys, no whitespace).
 * Strings get trimmed.
 */
export function canonicalValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'object') {
    return JSON.stringify(sortKeys(value as Record<string, unknown>));
  }
  return String(value);
}

function sortKeys(obj: Record<string, unknown>): Record<string, unknown> {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    const val = obj[key];
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      sorted[key] = sortKeys(val as Record<string, unknown>);
    } else {
      sorted[key] = val;
    }
  }
  return sorted;
}
