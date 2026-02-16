import type { ExtractedPerson } from '../types/extraction.js';

/**
 * Extract values for a given field name from an attribute list.
 * Common pattern used by scorer, context-builder, duplicates, etc.
 */
export function extractFieldValues(
  attributes: Array<{ field: string; value: string }>,
  fieldName: string,
): string[] {
  return attributes.filter(a => a.field === fieldName).map(a => a.value);
}

/**
 * Extract a single scalar value for a field, or null if absent.
 */
export function extractScalarField(
  attributes: Array<{ field: string; value: string }>,
  fieldName: string,
): string | null {
  return attributes.find(a => a.field === fieldName)?.value ?? null;
}

/**
 * Returns true if the extracted person has at least one identifying field
 * that could be used for customer matching (name, taxId, contact, DOB).
 */
export function hasIdentifyingInfo(person: ExtractedPerson | undefined | null): person is ExtractedPerson {
  if (!person) return false;

  return !!(
    person.firstName ||
    person.lastName ||
    person.taxId ||
    (person.emails && person.emails.length > 0) ||
    (person.phones && person.phones.length > 0) ||
    person.dateOfBirth
  );
}
