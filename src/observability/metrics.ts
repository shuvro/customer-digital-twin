/**
 * In-memory metrics singleton for pipeline observability.
 * Tracks counters and timing samples with a rolling window.
 */

const MAX_TIMING_SAMPLES = 1000;

export type PipelineStage = 'extract' | 'search' | 'decide' | 'persist' | 'total';
export type CounterName =
  | 'messagesReceived'
  | 'messagesProcessed'
  | 'messagesFailed'
  | 'messagesSkipped'
  | 'customersCreated'
  | 'customersUpdated'
  | 'customersMerged';

interface TimingSamples {
  samples: number[];
  writeIndex: number;
  count: number;
}

class MetricsCollector {
  private counters: Record<CounterName, number> = {
    messagesReceived: 0,
    messagesProcessed: 0,
    messagesFailed: 0,
    messagesSkipped: 0,
    customersCreated: 0,
    customersUpdated: 0,
    customersMerged: 0,
  };

  private timings: Record<PipelineStage, TimingSamples> = {
    extract: { samples: [], writeIndex: 0, count: 0 },
    search: { samples: [], writeIndex: 0, count: 0 },
    decide: { samples: [], writeIndex: 0, count: 0 },
    persist: { samples: [], writeIndex: 0, count: 0 },
    total: { samples: [], writeIndex: 0, count: 0 },
  };

  increment(counter: CounterName, amount = 1): void {
    this.counters[counter] += amount;
  }

  getCounter(counter: CounterName): number {
    return this.counters[counter];
  }

  recordTiming(stage: PipelineStage, durationMs: number): void {
    const t = this.timings[stage];
    if (t.samples.length < MAX_TIMING_SAMPLES) {
      t.samples.push(durationMs);
    } else {
      t.samples[t.writeIndex] = durationMs;
    }
    t.writeIndex = (t.writeIndex + 1) % MAX_TIMING_SAMPLES;
    t.count++;
  }

  getTimingStats(stage: PipelineStage): { avg: number; min: number; max: number; count: number; p95: number } {
    const t = this.timings[stage];
    const len = Math.min(t.samples.length, MAX_TIMING_SAMPLES);
    if (len === 0) return { avg: 0, min: 0, max: 0, count: 0, p95: 0 };

    const active = t.samples.slice(0, len);
    const sorted = [...active].sort((a, b) => a - b);
    const sum = sorted.reduce((s, v) => s + v, 0);

    return {
      avg: Math.round(sum / len),
      min: sorted[0],
      max: sorted[len - 1],
      count: t.count,
      p95: sorted[Math.floor(len * 0.95)],
    };
  }

  /** Number of samples currently stored (capped at MAX_TIMING_SAMPLES). */
  getTimingSampleCount(stage: PipelineStage): number {
    return Math.min(this.timings[stage].samples.length, MAX_TIMING_SAMPLES);
  }

  getErrorRate(): number {
    const total = this.counters.messagesReceived;
    if (total === 0) return 0;
    return this.counters.messagesFailed / total;
  }

  snapshot() {
    const timingStats: Record<string, ReturnType<MetricsCollector['getTimingStats']>> = {};
    for (const stage of Object.keys(this.timings) as PipelineStage[]) {
      timingStats[stage] = this.getTimingStats(stage);
    }

    return {
      counters: { ...this.counters },
      timings: timingStats,
      errorRate: this.getErrorRate(),
    };
  }

  reset(): void {
    for (const key of Object.keys(this.counters) as CounterName[]) {
      this.counters[key] = 0;
    }
    for (const key of Object.keys(this.timings) as PipelineStage[]) {
      this.timings[key] = { samples: [], writeIndex: 0, count: 0 };
    }
  }
}

export const metrics = new MetricsCollector();
