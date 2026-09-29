/** Historical-yield analysis: stability, range and drift. */

import type { HistoryPoint, HistoryStats } from './types';
import { mean, slope, stddev } from '../util/stats';

const HOUR_MS = 3_600_000;

export function analyzeHistory(points: HistoryPoint[], benchmarkPct: number): HistoryStats {
  const samples = points
    .filter((p) => p.impliedApy !== null && Number.isFinite(p.impliedApy))
    .map((p) => ({ t: new Date(p.timestamp).getTime(), y: p.impliedApy as number }))
    .filter((p) => Number.isFinite(p.t));

  if (samples.length === 0) {
    return { points: 0, mean: null, min: null, max: null, stddev: null, coverage: null, trendPerDay: null };
  }

  samples.sort((a, b) => a.t - b.t);
  const ys = samples.map((s) => s.y);
  const coverage = ys.filter((y) => y >= benchmarkPct).length / ys.length;
  const days = samples.map((s) => (s.t - samples[0]!.t) / 86_400_000);

  return {
    points: samples.length,
    mean: mean(ys),
    min: Math.min(...ys),
    max: Math.max(...ys),
    stddev: stddev(ys),
    coverage,
    trendPerDay: slope(days, ys),
  };
}

/** Weights inside the stability factor, exported so the docs use the real numbers. */
export const STABILITY = {
  /** σ of implied APY that scores 0 on the calmness half. */
  volatilityCap: 0.05,
  /** Minimum hourly samples before a stability score is produced at all. */
  minSamples: 24,
  /** Weight on calmness vs consistency (they sum to 1). */
  calmWeight: 0.55,
  coverageWeight: 0.45,
};

/**
 * Collapse history into a single 0..1 confidence factor.
 *
 * Low volatility and a high share of samples above the benchmark both help.
 * A market older than the sample window is only measured over what we have,
 * so callers should surface `points` alongside the score.
 */
export function stabilityScore(stats: HistoryStats | null | undefined): number | null {
  if (!stats || stats.points < STABILITY.minSamples || stats.stddev === null || stats.coverage === null) return null;
  const calm = Math.max(0, 1 - stats.stddev / STABILITY.volatilityCap);
  const above = stats.coverage;
  return Math.min(1, Math.max(0, calm * STABILITY.calmWeight + above * STABILITY.coverageWeight));
}

export function historySpanDays(points: HistoryPoint[]): number {
  if (points.length < 2) return 0;
  const times = points.map((p) => new Date(p.timestamp).getTime()).filter(Number.isFinite);
  if (times.length < 2) return 0;
  return (Math.max(...times) - Math.min(...times)) / HOUR_MS / 24;
}
