/**
 * Finding the market you would roll into: the *same* asset, a *later* expiry.
 *
 * This is deliberately separate from the Discover ranking. The best next
 * market to hold is not necessarily the best-scoring market — for a roll you
 * want continuity of exposure, so matching the underlying matters more.
 */

import type { Market } from './types';
import { daysUntil } from './format';

export interface SuccessorMatch {
  market: Market;
  /** How the match was made: exact underlying, or same collateral + symbol. */
  matchedOn: 'underlying' | 'collateral';
  /** Extra days of lock-up versus the source market. */
  daysAfterSource: number;
}

export interface SuccessorOptions {
  /**
   * Prefer candidates with at least this much pool liquidity, so the successor
   * is actually tradeable. Falls back to the nearest expiry if none qualify.
   */
  minLiquidityUsd?: number;
  now?: number;
}

export function findSuccessorMarket(
  source: Market,
  markets: readonly Market[],
  options: SuccessorOptions = {},
): SuccessorMatch | null {
  const now = options.now ?? Date.now();
  const minLiquidity = options.minLiquidityUsd ?? 250_000;
  const sourceExpiry = new Date(source.expiry).getTime();
  if (!Number.isFinite(sourceExpiry)) return null;
  if (daysUntil(source.expiry, now) <= 0) return null;

  const later = markets.filter(
    (market) => market.id !== source.id && market.chainId === source.chainId && new Date(market.expiry).getTime() > sourceExpiry,
  );
  const sameUnderlying = later.filter((market) => market.underlyingAsset.address === source.underlyingAsset.address);
  const matchedOn: SuccessorMatch['matchedOn'] = sameUnderlying.length > 0 ? 'underlying' : 'collateral';
  const pool =
    sameUnderlying.length > 0
      ? sameUnderlying
      : later.filter(
          (market) =>
            market.accountingAsset.address === source.accountingAsset.address &&
            market.underlyingAsset.symbol.toLowerCase() === source.underlyingAsset.symbol.toLowerCase(),
        );

  if (pool.length === 0) return null;

  const liquid = pool.filter((market) => market.liquidityUsd >= minLiquidity);
  const candidates = liquid.length > 0 ? liquid : pool;
  const nearest = [...candidates].sort(
    (a, b) => new Date(a.expiry).getTime() - new Date(b.expiry).getTime() || b.liquidityUsd - a.liquidityUsd,
  )[0];
  if (!nearest) return null;

  return {
    market: nearest,
    matchedOn,
    daysAfterSource: Math.round(daysUntil(nearest.expiry, now) - daysUntil(source.expiry, now)),
  };
}

export function describeSuccessor(source: Market, match: SuccessorMatch): string {
  const basis =
    match.matchedOn === 'underlying'
      ? `same underlying (${source.underlyingAsset.symbol})`
      : `same collateral (${source.accountingAsset.symbol}) and symbol`;
  return `${match.market.underlyingAsset.symbol} expiring ${match.market.expiry.slice(0, 10)} — ${basis}, ${match.daysAfterSource} days later`;
}
