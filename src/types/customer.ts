export interface CustomerSummary {
  id: string;
  firstName: string | null;
  lastName: string | null;
  dateOfBirth: string | null;
  nationality: string | null;
  gender: string | null;
  taxId: string | null;
  currentAttributes: Record<string, string | string[]>;
  insights: Record<string, string[]>;
  messageCount: number;
}

export interface AttributeHistory {
  value: string;
  valueJson?: unknown;
  isCurrent: boolean;
  confidence: number;
  sourceMessageId: string;
  messageDate: string;
}

export interface InsightEntry {
  value: string;
  confidence: number;
  sourceMessageId: string;
  messageDate: string;
}

export interface IdentityEntry {
  field: string;
  value: string;
  confidence: number;
  sourceMessageId: string;
  messageDate: string;
}

export interface CustomerDetail {
  id: string;
  firstName: string | null;
  lastName: string | null;
  dateOfBirth: string | null;
  nationality: string | null;
  gender: string | null;
  taxId: string | null;
  identityConflicts: unknown;
  identities: IdentityEntry[];
  attributes: Record<string, AttributeHistory[]>;
  insights: Record<string, InsightEntry[]>;
  messages: Array<{
    id: string;
    source: string;
    messageDate: string;
    status: string;
    confidence: number | null;
    matchScore: number | null;
  }>;
}
