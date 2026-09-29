/**
 * Market screening: which markets the Discover list shows, and *why* the rest
 * were hidden.
 *
 * This is deliberately a pure function over pre-computed candidates so that
 * "why is market X missing?" is answerable, testable and showable in the UI.
 * Silently dropping rows is the failure mode this module exists to prevent.
 */

import type { AssetClass, Market, MarketScore, Settings } from './types';
import { daysUntil } from './format';

export type SortKey = 'score' | 'apy' | 'spread' | 'liquidity' | 'maturity';
export type AssetClassFilter = 'all' | AssetClass;

export interface ScreenFilters {
  query: string;
  sort: SortKey;
  minSpreadPct: number;
  assetClass: AssetClassFilter;
  chain: number | 'all';
  /**
   * Reveal markets that fail the *quality bars*. Explicit choices (chain,
   * collateral type, search text) are always respected — "show all" should not
   * mean "ignore what I asked for".
   */
  showHidden: boolean;
}

export interface Candidate {
  market: Market;
  score: MarketScore;
  /** impliedApy - benchmark, as a decimal. */
  spread: number;
  daysToMaturity: number;
}

export type HideReason =
  | 'expired'
  | 'non-positive-rate'
  | 'thin-liquidity'
  | 'off-peg'
  | 'avoided'
  | 'unknown-protocol'
  | 'maturity'
  | 'spread'
  | 'chain'
  | 'asset-class'
  | 'query';

export const HIDE_REASON_LABEL: Record<HideReason, string> = {
  expired: 'expired',
  'non-positive-rate': 'no fixed rate',
  'thin-liquidity': 'below your liquidity bar',
  'off-peg': 'collateral off peg',
  avoided: 'model would avoid',
  'unknown-protocol': 'protocol not in registry',
  maturity: 'too close to maturity',
  spread: 'below your spread bar',
  chain: 'different chain',
  'asset-class': 'different collateral type',
  query: 'does not match search',
};

export function candidateFor(market: Market, score: MarketScore, benchmarkPct: number): Candidate {
  return {
    market,
    score,
    spread: market.impliedApy - benchmarkPct,
    daysToMaturity: daysUntil(market.expiry),
  };
}

/** A market whose expiry has passed. Pendle's `isActive` flag does not exclude these. */
export function isExpired(market: Market, now = Date.now()): boolean {
  const expiry = new Date(market.expiry).getTime();
  return Number.isFinite(expiry) && expiry <= now;
}

function matchesQuery(market: Market, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === '') return true;
  return `${market.name} ${market.protocol} ${market.underlyingAsset.symbol} ${market.accountingAsset.symbol}`
    .toLowerCase()
    .includes(needle);
}

/** Filters the user chose explicitly. Never bypassed by `showHidden`. */
function explicitReason(candidate: Candidate, filters: ScreenFilters): HideReason | null {
  const { market } = candidate;
  if (filters.chain !== 'all' && market.chainId !== filters.chain) return 'chain';
  if (filters.assetClass !== 'all' && candidate.score.assetClass !== filters.assetClass) return 'asset-class';
  if (!matchesQuery(market, filters.query)) return 'query';
  return null;
}

/**
 * Quality bars. Checked in a fixed order so each hidden market gets exactly one
 * attributable reason — the summary counts have to add up to the total.
 */
function barReason(candidate: Candidate, filters: ScreenFilters, settings: Settings): HideReason | null {
  const { market, score, daysToMaturity, spread } = candidate;
  if (isExpired(market)) return 'expired';
  if (market.impliedApy <= 0) return 'non-positive-rate';
  if (market.liquidityUsd < settings.minLiquidityUsd) return 'thin-liquidity';
  if (score.flags.includes('accounting-asset-off-peg')) return 'off-peg';
  if (score.verdict === 'avoid') return 'avoided';
  if (settings.hideUnknownProtocols && score.protocolTier === 'unknown') return 'unknown-protocol';
  if (daysToMaturity < settings.minMaturityDays) return 'maturity';
  if (spread < filters.minSpreadPct / 100) return 'spread';
  return null;
}

export interface ScreenResult {
  included: Candidate[];
  /** reason -> count, so the UI can say "412 expired, 16 unknown protocol…". */
  hidden: Map<HideReason, number>;
  totalHidden: number;
}

export function screenMarkets(
  candidates: readonly Candidate[],
  filters: ScreenFilters,
  settings: Settings,
): ScreenResult {
  const included: Candidate[] = [];
  const hidden = new Map<HideReason, number>();

  for (const candidate of candidates) {
    const reason =
      explicitReason(candidate, filters) ?? (filters.showHidden ? null : barReason(candidate, filters, settings));
    if (reason) hidden.set(reason, (hidden.get(reason) ?? 0) + 1);
    else included.push(candidate);
  }

  return {
    included: sortCandidates(included, filters.sort),
    hidden,
    totalHidden: [...hidden.values()].reduce((total, count) => total + count, 0),
  };
}

export function sortCandidates(candidates: readonly Candidate[], sort: SortKey): Candidate[] {
  const value = (candidate: Candidate): number => {
    switch (sort) {
      case 'apy':
        return candidate.market.impliedApy;
      case 'spread':
        return candidate.spread;
      case 'liquidity':
        return candidate.market.liquidityUsd;
      case 'maturity':
        return -candidate.daysToMaturity;
      case 'score':
      default:
        return candidate.score.score;
    }
  };
  return [...candidates].sort((a, b) => value(b) - value(a));
}

/** Flatten a reason histogram into a readable, most-common-first phrase. */
export function summarizeHidden(hidden: Map<HideReason, number>, maxParts = 4): string {
  const parts = [...hidden.entries()]
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([reason, count]) => `${count} ${HIDE_REASON_LABEL[reason]}`);
  if (parts.length === 0) return '';
  const shown = parts.slice(0, maxParts).join(' · ');
  return parts.length > maxParts ? `${shown} · …` : shown;
}
