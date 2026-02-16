import type { ExtractionResult, ExtractedPerson } from './extraction.js';
import type { InboundMessage } from './message.js';
import type { DecisionCode } from '../generated/prisma/client.js';

export interface PipelineContext {
  message: InboundMessage;
  extraction?: ExtractionResult;
  person?: ExtractedPerson;
  decision?: PipelineDecision;
  customerId?: string;
  matchScore?: number;
  matchSignals?: string[];
  requestId?: string;
}

export type PipelineDecisionAction = 'CREATE' | 'UPDATE' | 'SKIP';

export interface PipelineDecision {
  action: PipelineDecisionAction;
  customerId?: string;
  score: number;
  signals: string[];
  reasoning: string;
  decisionCode: DecisionCode;
}
