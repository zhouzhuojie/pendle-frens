/**
 * Risk-free benchmark from the U.S. Department of the Treasury (Fiscal Data).
 *
 * We use the *average interest rate on outstanding marketable securities*,
 * which is official, keyless and stable. It lags the live yield curve, so the
 * UI labels it explicitly and lets the user override it in Settings.
 *
 * API: https://fiscaldata.treasury.gov/datasets/average-interest-rates-treasury-securities/
 */

import type { Benchmark } from '../domain/types';
import { getJson, isRetryable } from './http';
import { withRetry } from '../util/async';

const API = 'https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/avg_interest_rates';

export const BENCHMARK_SECURITIES = ['Treasury Notes', 'Treasury Bonds', 'Treasury Bills'] as const;
export type BenchmarkSecurity = (typeof BENCHMARK_SECURITIES)[number];

export const DEFAULT_SECURITY: BenchmarkSecurity = 'Treasury Notes';
export const FALLBACK_BENCHMARK_PCT = 0.035;
export const TREASURY_DATASET_URL =
  'https://fiscaldata.treasury.gov/datasets/average-interest-rates-treasury-securities/average-interest-rates-treasury-securities';

interface FiscalResponse {
  data?: { record_date?: string; security_desc?: string; avg_interest_rate_amt?: string }[];
}

export function benchmarkUrl(security: string): string {
  const filter = `security_desc:eq:${security}`;
  return `${API}?filter=${encodeURIComponent(filter)}&sort=-record_date&page%5Bsize%5D=1`;
}

export async function fetchTreasuryAverage(security: string): Promise<Benchmark | null> {
  const body = await withRetry(() => getJson<FiscalResponse>(benchmarkUrl(security)), {
    attempts: 2,
    shouldRetry: isRetryable,
  });
  const row = body.data?.[0];
  if (!row?.avg_interest_rate_amt) return null;
  const pct = Number(row.avg_interest_rate_amt) / 100;
  if (!Number.isFinite(pct)) return null;
  return {
    label: `${security} (avg rate on outstanding securities)`,
    pct,
    asOf: row.record_date ?? new Date().toISOString().slice(0, 10),
    source: 'treasury',
    url: TREASURY_DATASET_URL,
  };
}

export async function fetchTreasuryBenchmarks(): Promise<Record<string, Benchmark>> {
  const out: Record<string, Benchmark> = {};
  const results = await Promise.all(
    BENCHMARK_SECURITIES.map(async (security) => ({ security, benchmark: await fetchTreasuryAverage(security).catch(() => null) })),
  );
  for (const { security, benchmark } of results) {
    if (benchmark) out[security] = benchmark;
  }
  return out;
}

export function fallbackBenchmark(security: string = DEFAULT_SECURITY): Benchmark {
  return {
    label: `${security} (offline fallback — verify before acting)`,
    pct: FALLBACK_BENCHMARK_PCT,
    asOf: new Date().toISOString().slice(0, 10),
    source: 'fallback',
    url: TREASURY_DATASET_URL,
  };
}

export function overrideBenchmark(pct: number): Benchmark {
  return {
    label: 'Manual benchmark override',
    pct,
    asOf: new Date().toISOString().slice(0, 10),
    source: 'override',
    url: '',
  };
}

/** Precedence: manual override > live treasury > offline fallback. */
export function resolveBenchmark(
  overridePct: number | null,
  live: Benchmark | null | undefined,
  security: string = DEFAULT_SECURITY,
): Benchmark {
  if (overridePct !== null && Number.isFinite(overridePct) && overridePct > 0) return overrideBenchmark(overridePct);
  return live ?? fallbackBenchmark(security);
}
