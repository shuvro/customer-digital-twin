/**
 * Mutable attribute fields that can hold multiple concurrent current values
 * (e.g., a customer can have two phone numbers from the same latest message).
 * Scalar mutable fields (maritalStatus, occupation, employer) always have one current value.
 */
export const LIST_FIELDS = new Set(['email', 'phone', 'address']);

// --- Extraction-layer field categorization ---
// These match the keys on ExtractedPerson and are the canonical source
// for field classification. Used by merge-extractions, persist, etc.

/** Identity fields — set once, conflicts logged. */
export const IDENTITY_FIELDS = ['firstName', 'lastName', 'dateOfBirth', 'nationality', 'gender', 'taxId'] as const;

/** Scalar mutable fields — latest messageDate wins. */
export const MUTABLE_SCALAR_FIELDS = ['maritalStatus', 'occupation', 'employer'] as const;

/** Array fields on ExtractedPerson — accumulated / unioned. */
export const EXTRACTED_LIST_FIELDS = ['emails', 'phones', 'addresses', 'communicationPreferences', 'hobbies', 'needs', 'riskIndicators', 'familyContext', 'notes'] as const;

/** Insight fields — accumulated, unique constraint prevents dupes. */
export const INFERRED_FIELDS = ['communicationPreferences', 'hobbies', 'needs', 'riskIndicators', 'familyContext', 'notes'] as const;
