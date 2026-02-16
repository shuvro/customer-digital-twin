import { describe, it, expect, beforeEach } from 'vitest';
import { metrics } from '../../../src/observability/metrics.js';

describe('MetricsCollector', () => {
  beforeEach(() => {
    metrics.reset();
  });

  describe('counters', () => {
    it('increments counters', () => {
      metrics.increment('messagesReceived');
      metrics.increment('messagesReceived');
      metrics.increment('messagesProcessed');

      expect(metrics.getCounter('messagesReceived')).toBe(2);
      expect(metrics.getCounter('messagesProcessed')).toBe(1);
    });

    it('increments by custom amount', () => {
      metrics.increment('messagesReceived', 5);
      expect(metrics.getCounter('messagesReceived')).toBe(5);
    });

    it('starts at zero after reset', () => {
      metrics.increment('messagesReceived', 10);
      metrics.reset();
      expect(metrics.getCounter('messagesReceived')).toBe(0);
    });
  });

  describe('timing', () => {
    it('records timing and computes avg', () => {
      metrics.recordTiming('extract', 100);
      metrics.recordTiming('extract', 200);
      metrics.recordTiming('extract', 300);

      const stats = metrics.getTimingStats('extract');
      expect(stats.avg).toBe(200);
      expect(stats.min).toBe(100);
      expect(stats.max).toBe(300);
      expect(stats.count).toBe(3);
    });

    it('returns zeros when no samples', () => {
      const stats = metrics.getTimingStats('search');
      expect(stats.avg).toBe(0);
      expect(stats.min).toBe(0);
      expect(stats.max).toBe(0);
      expect(stats.count).toBe(0);
      expect(stats.p95).toBe(0);
    });

    it('computes p95', () => {
      for (let i = 1; i <= 100; i++) {
        metrics.recordTiming('total', i);
      }
      const stats = metrics.getTimingStats('total');
      expect(stats.p95).toBe(96);
      expect(stats.count).toBe(100);
    });

    it('evicts old samples in rolling window after 1000', () => {
      // Fill up to 1001 samples
      for (let i = 0; i < 1001; i++) {
        metrics.recordTiming('persist', i);
      }

      // Total count tracks all recorded samples
      const stats = metrics.getTimingStats('persist');
      expect(stats.count).toBe(1001);

      // But the stored samples should be capped at 1000
      expect(metrics.getTimingSampleCount('persist')).toBe(1000);
    });

    it('rolling window replaces oldest on overflow', () => {
      // Fill 1000 with value 10
      for (let i = 0; i < 1000; i++) {
        metrics.recordTiming('decide', 10);
      }
      expect(metrics.getTimingStats('decide').avg).toBe(10);

      // Add 500 more with value 20 — these replace first 500 entries
      for (let i = 0; i < 500; i++) {
        metrics.recordTiming('decide', 20);
      }

      const stats = metrics.getTimingStats('decide');
      // 500 * 10 + 500 * 20 = 15000 / 1000 = 15
      expect(stats.avg).toBe(15);
    });

    it('resets timing data', () => {
      metrics.recordTiming('extract', 100);
      metrics.reset();
      expect(metrics.getTimingStats('extract').count).toBe(0);
      expect(metrics.getTimingSampleCount('extract')).toBe(0);
    });
  });

  describe('error rate', () => {
    it('computes error rate', () => {
      metrics.increment('messagesReceived', 10);
      metrics.increment('messagesFailed', 2);
      expect(metrics.getErrorRate()).toBeCloseTo(0.2);
    });

    it('returns 0 when no messages received', () => {
      expect(metrics.getErrorRate()).toBe(0);
    });
  });

  describe('snapshot', () => {
    it('returns full snapshot', () => {
      metrics.increment('messagesReceived', 5);
      metrics.increment('messagesProcessed', 3);
      metrics.increment('messagesFailed', 1);
      metrics.recordTiming('total', 150);

      const snap = metrics.snapshot();
      expect(snap.counters.messagesReceived).toBe(5);
      expect(snap.counters.messagesProcessed).toBe(3);
      expect(snap.timings.total.avg).toBe(150);
      expect(snap.errorRate).toBeCloseTo(0.2);
    });
  });
});
