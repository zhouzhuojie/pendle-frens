/**
 * Objective protocol scoring. No curation, no registry, no "unknown" state.
 *
 * The protocol factor is a *measurement of depth*, taken entirely from facts the
 * Pendle snapshot already carries: how many active markets a protocol has, on
 * how many chains, its summed TVL, and whether Pendle flags any of them Prime.
 *
 * It is deliberately **not** a trust score, and the UI says so. Size is what a
 * protocol shows right before it fails as often as it is what it shows when it
 * is sound, so this is a ranking input, not a safety verdict. The app makes no
 * protocol-level judgement anywhere; if you want a human opinion on a protocol,
 * read its own docs and audits.
 *
 * Everything here is a pure function of a `Market[]`, so it runs under plain
 * Node in tests and needs no network or new permission.
 */

import type { Market } from './types';
import { clamp } from '../util/decimal';

export interface ProtocolFacts {
  /** The protocol string as the snapshot spells it. */
  protocol: string;
  /** Active markets for this protocol in the current snapshot. */
  markets: number;
  /** Distinct chains those markets live on. */
  chains: number;
  /** Summed total value locked across the protocol's markets, USD. */
  tvlUsd: number;
  /** True when Pendle lists at least one of the protocol's markets as Prime. */
  isPrime: boolean;
}

/** Normalize a protocol string so `USD.ai` and `USD.AI` share a bucket. */
export const normalizeProtocol = (value: string): string => value.toLowerCase().replace(/[^a-z0-9.]/g, '');

/**
 * The depth model. Exported so the Method view and its tests read the same
 * numbers the scorer uses, exactly like `SCORE_WEIGHTS` etc.
 */
export const PROTOCOL_DEPTH = {
  /** A protocol with no measurable depth scores this. */
  floor: 0.15,
  /** The ceiling. Kept below 1 so no size proxy can present itself as certainty. */
  ceiling: 0.6,
  /** Signal weights; they sum to 1. */
  weights: { tvl: 0.5, markets: 0.2, chains: 0.1, prime: 0.2 },
  /** TVL log band: 0 at $250k, 1 at $100M (a 400x range). */
  tvl: { zeroAtUsd: 250_000, fullAtUsd: 100_000_000 },
  /** Market-count band: a single market scores 0, this many or more scores 1. */
  markets: { fullAt: 8 },
  /** Chain band: 1 chain scores 0, this many or more scores 1. */
  chains: { fullAt: 3 },
} as const;

/** Aggregate the snapshot into per-protocol facts. */
export function buildProtocolFacts(markets: readonly Market[]): Map<string, ProtocolFacts> {
  const byKey = new Map<string, ProtocolFacts>();
  const chainSets = new Map<string, Set<number>>();
  for (const market of markets) {
    const key = normalizeProtocol(market.protocol);
    const existing = byKey.get(key);
    if (existing) {
      existing.markets += 1;
      existing.tvlUsd += market.tvlUsd;
      existing.isPrime = existing.isPrime || market.isPrime;
    } else {
      byKey.set(key, {
        protocol: market.protocol,
        markets: 1,
        chains: 1,
        tvlUsd: market.tvlUsd,
        isPrime: market.isPrime,
      });
    }
    const set = chainSets.get(key) ?? new Set<number>();
    set.add(market.chainId);
    chainSets.set(key, set);
  }
  for (const [key, facts] of byKey) facts.chains = chainSets.get(key)?.size ?? 1;
  return byKey;
}

/** Log-band normalisation: 0 at `zeroAtUsd`, 1 at `fullAtUsd`, clamped. */
function logBand(value: number, zeroAtUsd: number, fullAtUsd: number): number {
  if (!Number.isFinite(value) || value <= zeroAtUsd || fullAtUsd <= zeroAtUsd) return 0;
  const decades = Math.log10(fullAtUsd / zeroAtUsd);
  return clamp(Math.log10(value / zeroAtUsd) / decades, 0, 1);
}

/**
 * Turn protocol facts into the 0..1 value used by the protocol factor.
 *
 * Deliberately conservative: it can only ever reach `PROTOCOL_DEPTH.ceiling`.
 */
export function protocolDepthScore(facts: ProtocolFacts): number {
  const { weights, tvl, markets, chains, floor, ceiling } = PROTOCOL_DEPTH;
  const tvlScore = logBand(facts.tvlUsd, tvl.zeroAtUsd, tvl.fullAtUsd);
  const breadth = clamp((facts.markets - 1) / (markets.fullAt - 1), 0, 1);
  const spread = clamp((facts.chains - 1) / (chains.fullAt - 1), 0, 1);
  const prime = facts.isPrime ? 1 : 0;
  const weighted = weights.tvl * tvlScore + weights.markets * breadth + weights.chains * spread + weights.prime * prime;
  return floor + (ceiling - floor) * clamp(weighted, 0, 1);
}
