import type { ExtractedPerson, FieldConfidence } from '../types/extraction.js';
import { IDENTITY_FIELDS, MUTABLE_SCALAR_FIELDS, EXTRACTED_LIST_FIELDS } from '../types/fields.js';

function unionArrays<T>(a: T[] | undefined, b: T[] | undefined): T[] | undefined {
  if (!a && !b) return undefined;
  const combined = [...(a ?? []), ...(b ?? [])];
  // Deduplicate by JSON stringification for objects, or direct comparison for primitives
  const seen = new Set<string>();
  return combined.filter(item => {
    const key = typeof item === 'object' ? JSON.stringify(item) : String(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export interface MergeResult {
  merged: ExtractedPerson;
  fieldsChanged: string[];
  fieldsAdded: string[];
}

export function mergeExtractions(original: ExtractedPerson, reExtracted: ExtractedPerson): MergeResult {
  const merged: Record<string, unknown> = { ...original };
  const fieldsChanged: string[] = [];
  const fieldsAdded: string[] = [];

  // Identity fields: first pass wins for non-null values
  for (const field of IDENTITY_FIELDS) {
    const origVal = original[field];
    const reVal = reExtracted[field];
    if ((origVal === null || origVal === undefined) && reVal != null) {
      merged[field] = reVal;
      fieldsAdded.push(field);
    }
    // Otherwise keep original — first pass wins
  }

  // Scalar mutable fields: re-extraction wins if non-null (it has more context)
  for (const field of MUTABLE_SCALAR_FIELDS) {
    const origVal = original[field];
    const reVal = reExtracted[field];
    if (reVal != null) {
      if (origVal == null) {
        merged[field] = reVal;
        fieldsAdded.push(field);
      } else if (origVal !== reVal) {
        merged[field] = reVal;
        fieldsChanged.push(field);
      }
    }
  }

  // List fields: union
  for (const field of EXTRACTED_LIST_FIELDS) {
    const origArr = original[field] as unknown[] | undefined;
    const reArr = reExtracted[field] as unknown[] | undefined;
    const unioned = unionArrays(origArr, reArr);
    if (unioned && unioned.length > 0) {
      merged[field] = unioned;
      if (!origArr || origArr.length === 0) {
        if (reArr && reArr.length > 0) fieldsAdded.push(field);
      } else if (unioned.length > origArr.length) {
        fieldsChanged.push(field);
      }
    }
  }

  return {
    merged: merged as ExtractedPerson,
    fieldsChanged,
    fieldsAdded,
  };
}

export function mergeConfidence(original: FieldConfidence, reExtracted: FieldConfidence): FieldConfidence {
  const merged: FieldConfidence = { ...original };
  for (const [key, value] of Object.entries(reExtracted)) {
    merged[key] = Math.max(merged[key] ?? 0, value);
  }
  return merged;
}
