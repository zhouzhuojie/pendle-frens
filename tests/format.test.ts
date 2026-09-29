import { describe, expect, it } from 'vitest';
import {
  daysUntil,
  formatAmount,
  formatBps,
  formatCompactUsd,
  formatDate,
  formatPct,
  formatSignedPct,
  formatUsd,
  shortAddress,
  truncate,
} from '../src/lib/domain/format';
import { analyzeHistory, historySpanDays } from '../src/lib/domain/history';
import type { HistoryPoint } from '../src/lib/domain/types';

describe('format helpers', () => {
  it('formats percentages', () => {
    expect(formatPct(0.115)).toBe('11.50%');
    expect(formatPct(0.115, 1)).toBe('11.5%');
    expect(formatPct(null)).toBe('—');
    expect(formatSignedPct(0.0815)).toBe('+8.15%');
    expect(formatSignedPct(-0.02)).toBe('-2.00%');
  });

  it('formats bps', () => {
    expect(formatBps(-5)).toBe('-5 bps');
    expect(formatBps(12.34, 1)).toBe('+12.3 bps');
    expect(formatBps(null)).toBe('—');
  });

  it('formats USD', () => {
    expect(formatUsd(50_000)).toBe('$50,000.00');
    expect(formatUsd(0.9793, 4)).toBe('$0.9793');
    expect(formatUsd(null)).toBe('—');
  });

  it('formats compact USD', () => {
    expect(formatCompactUsd(12_148_962)).toBe('$12.15M');
    expect(formatCompactUsd(217_109_331)).toBe('$217.11M');
    expect(formatCompactUsd(1_500_000_000)).toBe('$1.50B');
    expect(formatCompactUsd(4_200)).toBe('$4.2K');
  });

  it('formats amounts and addresses', () => {
    expect(formatAmount(51_057.85752)).toBe('51,057.8575');
    expect(formatAmount(1_500_000)).toBe('1.50M');
    expect(shortAddress('0x1234567890abcdef')).toBe('0x1234…cdef');
  });

  it('computes days until a fixed moment', () => {
    const now = Date.UTC(2026, 0, 1);
    expect(daysUntil('2026-01-11T00:00:00.000Z', now)).toBeCloseTo(10, 6);
  });

  it('renders dates and strips HTML for display', () => {
    expect(formatDate('2026-12-10T00:00:00.000Z')).toContain('2026');
    expect(truncate('<p>Hello   <b>world</b></p>', 100)).toBe('Hello world');
    expect(truncate('abcdef', 4)).toBe('abc…');
  });
});

describe('analyzeHistory', () => {
  const make = (values: number[]): HistoryPoint[] =>
    values.map((v, i) => ({
      timestamp: new Date(Date.UTC(2026, 0, 1) + i * 3_600_000).toISOString(),
      impliedApy: v,
      ptPrice: 0.98,
      totalTvl: 1000,
      underlyingApy: 0.07,
    }));

  it('reports mean, range, volatility, coverage and drift', () => {
    const rising = make([0.08, 0.09, 0.1, 0.11, 0.12]);
    const stats = analyzeHistory(rising, 0.09);
    expect(stats.points).toBe(5);
    expect(stats.mean).toBeCloseTo(0.1, 6);
    expect(stats.min).toBeCloseTo(0.08, 6);
    expect(stats.max).toBeCloseTo(0.12, 6);
    expect(stats.coverage).toBeCloseTo(0.8, 6);
    expect(stats.trendPerDay).toBeGreaterThan(0);
    expect(stats.stddev).toBeGreaterThan(0);
  });

  it('handles empty and null-only input', () => {
    expect(analyzeHistory([], 0.03).points).toBe(0);
    const nulls: HistoryPoint[] = [
      { timestamp: new Date().toISOString(), impliedApy: null, ptPrice: null, totalTvl: null, underlyingApy: null },
    ];
    expect(analyzeHistory(nulls, 0.03).mean).toBeNull();
  });

  it('measures the covered span', () => {
    const points = make([0.1, 0.1, 0.1]);
    expect(historySpanDays(points)).toBeCloseTo(2 / 24, 6);
    expect(historySpanDays([])).toBe(0);
  });
});
