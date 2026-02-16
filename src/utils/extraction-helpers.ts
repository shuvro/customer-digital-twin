import type { ExtractedPerson } from '../types/extraction.js';

/**
 * Returns true if the extracted person has at least one identifying field
 * that could be used for customer matching (name, taxId, contact, DOB).
 */
export function hasIdentifyingInfo(person: ExtractedPerson | undefined | null): boolean {
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
