/**
 * The decision brief: turn the raw snapshot + score into the answer a PT buyer
 * actually needs.
 *
 * A PT is a fixed-rate loan. You pay less than par today and receive one
 * accounting-asset unit at maturity. So the whole decision reduces to four
 * questions, and this module answers each one from fields already in the
 * snapshot:
 *
 *   1. What do I earn over the risk-free rate?   -> `headline`, `spread`
 *   2. What do I actually get back?              -> `payout`
 *   3. What does it cost to get in?              -> `entryCost`
 *   4. What could go wrong?                      -> `caseAgainst`
 *
 * Nothing here is a new source of truth. Every number is derived from the
 * market, the score, or the history stats, using the same constants the scorer
 * uses, so the detail view stays dumb and this reasoning stays testable.
 */

import type { HistoryStats, Market, MarketScore } from './types';
import { accountingAssetPegBreak, spreadVsBenchmark, VERDICT_RULES } from './score';
import { FEE_FORMULA } from './route';
import { daysUntil, formatCompactUsd, formatDate, formatPct } from './format';

export type LiquidityLevel = 'deep' | 'workable' | 'thin';

export interface MaturityPayout {
  sizeUsd: number;
  /** USD price of one PT right now, or null when the provider gave none. */
  ptPriceUsd: number | null;
  /** 1 − price, the discount you are buying at. */
  discount: number;
  /** PT units bought for `sizeUsd`, or null when the price is unknown. */
  ptReceived: number | null;
  /** What those PTs redeem for at maturity, USD. Null when price is unknown. */
  valueAtMaturityUsd: number | null;
  /** `valueAtMaturityUsd − sizeUsd`. Null when value is unknown. */
  profitUsd: number | null;
  /** True when the payout had to be valued at today's accounting-asset price. */
  markedToToday: boolean;
}

export interface EntryCostEstimate {
  notionalUsd: number;
  feeUsd: number;
  bps: number;
  /** The verified formula this estimate comes from. */
  formula: string;
}

export interface DecisionBrief {
  /** One sentence: the rate, the term, and the excess over the benchmark. */
  headline: string;
  /** 0.05 = the market pays 5pp more than the benchmark. */
  spread: number;
  days: number;
  payout: MaturityPayout;
  entryCost: EntryCostEstimate;
  /** Liquidity read for an early exit, already classified. */
  exit: { liquidityUsd: number; level: LiquidityLevel; note: string };
  /** Specific, data-backed reasons the trade could work. */
  caseFor: string[];
  /** Specific, data-backed reasons to be cautious. */
  caseAgainst: string[];
}

export interface DecisionContext {
  benchmarkPct: number;
  historyStats?: HistoryStats | null;
  /** Size for the worked example and the fee estimate, USD. */
  sizeUsd: number;
  now?: number;
}

/** Rate drift per day that counts as "fading": −2 bps/day, about −0.6pp/month. */
const TREND_FADE_PER_DAY = -0.0002;
/** σ of implied APY below which the rate counts as steady. */
const STEADY_SIGMA = 0.01;
/** σ above which the rate counts as volatile. */
const VOLATILE_SIGMA = 0.02;
/** Share of samples above the benchmark that counts as "usually worth it". */
const CONSISTENT_COVERAGE = 0.8;

export function buildDecisionBrief(market: Market, score: MarketScore, ctx: DecisionContext): DecisionBrief {
  const now = ctx.now ?? Date.now();
  const days = daysUntil(market.expiry, now);
  const spread = spreadVsBenchmark(market, ctx.benchmarkPct);
  const sizeUsd = ctx.sizeUsd > 0 ? ctx.sizeUsd : 10_000;
  const stats = ctx.historyStats ?? null;

  const headline = `Lock ${formatPct(market.impliedApy)} until ${formatDate(market.expiry)} (${Math.round(
    days,
  )} days) — ${formatPp(spread)} vs the ${formatPct(ctx.benchmarkPct)} benchmark.`;

  const payout = buildPayout(market, sizeUsd);
  const entryCost = buildEntryCost(market, sizeUsd, days);
  const exit = buildExit(market);

  return {
    headline,
    spread,
    days,
    payout,
    entryCost,
    exit,
    caseFor: buildCaseFor(market, score, stats, spread, exit),
    caseAgainst: buildCaseAgainst(market, score, stats, spread, days, exit),
  };
}

/* ------------------------------- the payout ------------------------------ */

function buildPayout(market: Market, sizeUsd: number): MaturityPayout {
  const ptPriceUsd = market.pt.priceUsd;
  const accountingPrice = market.accountingAsset.priceUsd;
  const known = ptPriceUsd !== null && Number.isFinite(ptPriceUsd) && ptPriceUsd > 0;

  if (!known) {
    return {
      sizeUsd,
      ptPriceUsd: null,
      discount: market.ptDiscount,
      ptReceived: null,
      valueAtMaturityUsd: null,
      profitUsd: null,
      markedToToday: false,
    };
  }

  const ptReceived = sizeUsd / ptPriceUsd;
  const priced = accountingPrice !== null && Number.isFinite(accountingPrice) && accountingPrice > 0;
  const valueAtMaturityUsd = priced ? ptReceived * accountingPrice : null;
  return {
    sizeUsd,
    ptPriceUsd,
    discount: market.ptDiscount,
    ptReceived,
    valueAtMaturityUsd,
    profitUsd: valueAtMaturityUsd === null ? null : valueAtMaturityUsd - sizeUsd,
    // Even a "stable" accounting asset can be quoted slightly off $1; when it
    // is, the payout is only exact in accounting-asset units, not in dollars.
    markedToToday: priced && Math.abs(accountingPrice - 1) > 1e-9,
  };
}

/* ------------------------------- entry cost ------------------------------ */

function buildEntryCost(market: Market, sizeUsd: number, days: number): EntryCostEstimate {
  // The verified Pendle fee identity: the AMM charges on the annualised implied
  // rate it moves, so a longer-dated market costs more at the same size.
  const feeUsd = market.feeRate * sizeUsd * (Math.max(0, days) / 365);
  return {
    notionalUsd: sizeUsd,
    feeUsd,
    bps: sizeUsd > 0 ? (feeUsd / sizeUsd) * 10_000 : 0,
    formula: FEE_FORMULA,
  };
}

/* -------------------------------- the exit ------------------------------- */

function buildExit(market: Market): DecisionBrief['exit'] {
  const liquidityUsd = market.liquidityUsd;
  const level: LiquidityLevel =
    liquidityUsd >= VERDICT_RULES.safe.minLiquidityUsd
      ? 'deep'
      : liquidityUsd >= VERDICT_RULES.balanced.minLiquidityUsd
        ? 'workable'
        : 'thin';
  const note =
    level === 'deep'
      ? `Deep enough (${formatCompactUsd(liquidityUsd)}) that a normal-sized exit should not move the price much.`
      : level === 'workable'
        ? `Moderate (${formatCompactUsd(liquidityUsd)}) — fine for a smaller exit, check the impact before a large one.`
        : `Thin (${formatCompactUsd(liquidityUsd)}) — exiting early would move the price against you.`;
  return { liquidityUsd, level, note };
}

/* ----------------------------- for and against --------------------------- */

function buildCaseFor(
  market: Market,
  score: MarketScore,
  stats: HistoryStats | null,
  spread: number,
  exit: DecisionBrief['exit'],
): string[] {
  const out: string[] = [];

  if (spread > 0) {
    out.push(
      `Pays ${formatPp(spread)} over the risk-free benchmark — that premium is the whole reason to accept the credit and contract risk.`,
    );
  } else {
    out.push('You are buying below a risk-free Treasury — only worth it if you specifically want this collateral exposure.');
  }

  if (exit.level === 'deep') out.push(`Enough exit liquidity (${formatCompactUsd(exit.liquidityUsd)}) to leave early without much damage.`);

  if (score.assetClass === 'stable') {
    out.push(`Redeems into ${market.accountingAsset.symbol} at par, so the payout is a dollar amount rather than a volatile token.`);
  }

  if (stats && stats.stddev !== null && stats.coverage !== null && stats.stddev <= STEADY_SIGMA && stats.coverage >= CONSISTENT_COVERAGE) {
    out.push(
      `The rate has been steady (σ ${formatPct(stats.stddev)}) and sat above the benchmark ${formatPct(stats.coverage, 0)} of the time over the measured window.`,
    );
  }

  const depth = score.protocolDepth;
  if (depth && depth.score >= 0.45) {
    out.push(`Established footprint for ${market.protocol}: ${depth.markets} markets on ${depth.chains} chain${depth.chains === 1 ? '' : 's'}.`);
  }

  if (market.isPrime) out.push('Pendle lists this market as Prime.');

  return out;
}

function buildCaseAgainst(
  market: Market,
  score: MarketScore,
  stats: HistoryStats | null,
  spread: number,
  days: number,
  exit: DecisionBrief['exit'],
): string[] {
  const out: string[] = [];

  if (spread <= 0) out.push('Pays no premium over the risk-free rate — you carry the risk for free.');

  if (exit.level === 'thin') {
    out.push(`Thin exit liquidity (${formatCompactUsd(exit.liquidityUsd)}) — selling before maturity would move the price against you.`);
  } else if (exit.level === 'workable') {
    out.push(`Only moderate liquidity (${formatCompactUsd(exit.liquidityUsd)}) — a large early exit would cost you.`);
  }

  if (!stats || stats.points < 24) {
    out.push('No usable price history yet — the headline rate is unverified.');
  } else {
    if (stats.stddev !== null && stats.stddev > VOLATILE_SIGMA) {
      out.push(`The implied rate has been volatile (σ ${formatPct(stats.stddev)}) — the headline may not last.`);
    }
    if (stats.trendPerDay !== null && stats.trendPerDay < TREND_FADE_PER_DAY) {
      out.push(`The implied rate has been fading (${formatPct(stats.trendPerDay, 3)}/day) — the rate you see may be gone soon.`);
    }
    if (stats.coverage !== null && stats.coverage < 0.5) {
      out.push(`Below the benchmark more than half the measured window (${formatPct(stats.coverage, 0)} above).`);
    }
  }

  if (days < 30) out.push(`Only ${Math.round(days)} days left — you will pay entry costs again when you roll it.`);
  if (days > 540) out.push(`Locked for about ${(days / 365).toFixed(1)} years — longer than a typical rate cycle.`);

  if (score.assetClass !== 'stable' && score.assetClass !== 'rwa' && score.assetClass !== 'eth-staking') {
    out.push(
      `Your fixed return is denominated in ${market.accountingAsset.symbol}, which can move — the “fixed” rate is fixed in that asset, not in dollars.`,
    );
  }

  const pegBreak = accountingAssetPegBreak(market, score.assetClass);
  if (pegBreak !== null && pegBreak > 0.02) {
    out.push(
      `The accounting asset (${market.accountingAsset.symbol}) is trading ${formatPct(pegBreak)} below $1 — PT still redeems one unit of it, so that gap is your loss.`,
    );
  }

  if (market.categoryIds.includes('pt-looping')) {
    out.push('Collateral is commonly looped — a deleveraging cascade can hit it even if the underlying holds.');
  }

  if (market.info.riskInvolved) out.push('Pendle lists specific risks for this market — read the notes below before deciding.');
  if (market.info.withdrawalNote) out.push('Early exit has conditions — see the withdrawal note below.');

  const depth = score.protocolDepth;
  if (depth && depth.score <= 0.25) {
    out.push(`Thin protocol footprint (${depth.markets} market${depth.markets === 1 ? '' : 's'}, ${formatCompactUsd(depth.tvlUsd)} TVL) — little to fall back on.`);
  }

  return out;
}

/* -------------------------------- helpers -------------------------------- */

/** `+7.82pp` / `-1.10pp`, using pp because the input is already a decimal spread. */
function formatPp(value: number): string {
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(2)}pp`;
}
