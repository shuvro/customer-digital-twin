/**
 * Mutable attribute fields that can hold multiple concurrent current values
 * (e.g., a customer can have two phone numbers from the same latest message).
 * Scalar mutable fields (maritalStatus, occupation, employer) always have one current value.
 */
export const LIST_FIELDS = new Set(['email', 'phone', 'address']);
