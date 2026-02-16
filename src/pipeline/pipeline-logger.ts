import { prisma } from '../db.js';
import { Prisma, type PipelineStage } from '../generated/prisma/client.js';
import type { TxClient } from './persist.js';

export type ExtractSummary = {
  personCount: number;
  fieldsExtracted: string[];
  avgConfidence: number;
};

export type SearchSummary = {
  candidateCount: number;
  bestScore: number;
  bestSignals: string[];
  directLookupHits: number;
  topCandidates?: Array<{
    customerId: string;
    score: number;
    signals: string[];
    taxIdMatch: boolean;
  }>;
};

export type ReExtractSummary = {
  triggered: boolean;
  fieldsChanged: string[];
  fieldsAdded: string[];
  mergeStrategy: string;
};

export type DecideSummary = {
  action: string;
  decisionCode: string;
  score: number;
  signals: string[];
};

export type PersistSummary = {
  customerId: string;
  identitiesWritten: number;
  attributesWritten: number;
  insightsWritten: number;
};

export type ErrorSummary = {
  stage: string;
  errorType: string;
  errorMessage: string;
};

export type StageSummary =
  | ExtractSummary
  | SearchSummary
  | ReExtractSummary
  | DecideSummary
  | PersistSummary
  | ErrorSummary;

interface LogEntry {
  messageId: string;
  stage: PipelineStage;
  sequence: number;
  timestamp: Date;
  durationMs: number | null;
  input: Record<string, unknown> | null;
  output: Record<string, unknown>;
  summary: string;
}

export class PipelineLogger {
  private readonly messageId: string;
  private sequence = 0;
  private buffer: LogEntry[] = [];
  private flushed = false;

  constructor(messageId: string) {
    this.messageId = messageId;
  }

  log(stage: PipelineStage, summary: string, output: StageSummary, durationMs?: number, input?: StageSummary): void {
    this.buffer.push({
      messageId: this.messageId,
      stage,
      sequence: this.sequence++,
      timestamp: new Date(),
      durationMs: durationMs ?? null,
      input: input ? ({ ...input } as Record<string, unknown>) : null,
      output: { ...output } as Record<string, unknown>,
      summary,
    });
  }

  private toBulkCreateData(): Prisma.PipelineLogCreateManyInput[] {
    return this.buffer.map(entry => ({
      messageId: entry.messageId,
      stage: entry.stage,
      sequence: entry.sequence,
      timestamp: entry.timestamp,
      durationMs: entry.durationMs,
      input: entry.input === null ? Prisma.DbNull : (entry.input as Prisma.InputJsonValue),
      output: entry.output as Prisma.InputJsonValue,
      summary: entry.summary,
    }));
  }

  async flush(tx: TxClient): Promise<void> {
    if (this.flushed) return;
    if (this.buffer.length === 0) { this.flushed = true; return; }

    // Clear any existing logs from a previous failed attempt (retry scenario)
    await tx.pipelineLog.deleteMany({ where: { messageId: this.messageId } });
    await tx.pipelineLog.createMany({ data: this.toBulkCreateData() });

    this.flushed = true;
    this.buffer = [];
  }

  async flushDirect(): Promise<void> {
    if (this.flushed) return;
    if (this.buffer.length === 0) { this.flushed = true; return; }

    // Clear any existing logs from a previous failed attempt (retry scenario)
    await prisma.pipelineLog.deleteMany({ where: { messageId: this.messageId } });
    await prisma.pipelineLog.createMany({ data: this.toBulkCreateData() });

    this.flushed = true;
    this.buffer = [];
  }
}
