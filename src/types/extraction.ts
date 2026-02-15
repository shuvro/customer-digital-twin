export interface ExtractedAddress {
  street?: string;
  city?: string;
  postalCode?: string;
  country?: string;
  fullAddress?: string;
}

export interface ExtractedPerson {
  firstName?: string | null;
  lastName?: string | null;
  dateOfBirth?: string | null;
  gender?: string | null;
  nationality?: string | null;
  taxId?: string | null;
  maritalStatus?: string | null;
  occupation?: string | null;
  employer?: string | null;
  addresses?: ExtractedAddress[];
  emails?: string[];
  phones?: string[];
  communicationPreferences?: string[];
  hobbies?: string[];
  needs?: string[];
  riskIndicators?: string[];
  familyContext?: string[];
  notes?: string[];
}

export interface FieldConfidence {
  [fieldPath: string]: number;
}

export interface ExtractionResult {
  persons: ExtractedPerson[];
  confidence: FieldConfidence;
  rawResponse?: string;
}
