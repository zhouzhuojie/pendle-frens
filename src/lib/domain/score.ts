/**
 * Transparent, rule-based market scoring.
 *
 * Design rule: the composite score is a *weighted sum of named factors that
 * are all surfaced in the UI*. There is no hidden model. If a factor cannot be
 * computed (e.g. no history yet) its weight is redistributed and the UI says so.
 *
 * Every threshold lives in an exported constant below, and `FACTOR_DOCS`
 * explains each one in plain language. The "Method" view in the panel is built
 * from these same numbers, so the documentation cannot drift from the code.
 */

import type { AssetClass, FactorKey, HistoryStats, Market, MarketScore, ProtocolDepth, ScoreFactor, Verdict } from './types';
import { PROTOCOL_DEPTH, normalizeProtocol, protocolDepthScore, type ProtocolFacts } from './protocol';
import { clamp, normalize } from '../util/decimal';
import { daysUntil, formatCompactUsd, formatPct } from './format';
import { STABILITY, stabilityScore } from './history';

export interface ScoreContext {
  benchmarkPct: number;
  minLiquidityUsd: number;
  historyStats?: HistoryStats | null;
  /**
   * Per-protocol aggregates for the protocol factor, built once per snapshot by
   * `protocol.ts`. When absent, every protocol keeps the flat floor.
   */
  protocolFacts?: ReadonlyMap<string, ProtocolFacts> | null;
  now?: number;
}

/* ------------------------- asset classification -------------------------- */

/**
 * Classify the market's underlying exposure from Pendle's own category tags,
 * with a symbol fallback so newly listed markets are not left unclassified.
 * Local to the scorer because nothing else needs it.
 */
const STABLE_SYMBOL = /(usdc|usdt|^dai$|usds|usde|susde|sfrxusd|frax|crvusd|gho|pyusd|usdd|usd0|susd|deusd|usdx|reusd|siusd|susn|^usr$|usdf|rusd|rlusd|usdtb|susds|usdn|iusd)/i;
const ETH_SYMBOL = /(w?eth|steth|reth|ezeth|weeth|ethx|sfrxeth|cbeth|oseth|sweth)/i;
const BTC_SYMBOL = /(btc)/i;

export function classifyAsset(categoryIds: string[], symbols: string[]): AssetClass {
  const cats = new Set(categoryIds.map((c) => c.toLowerCase()));
  if (cats.has('stables')) return 'stable';
  if (cats.has('rwa')) return 'rwa';
  if (cats.has('btc')) return 'btc';
  if (cats.has('lst') || cats.has('lrt')) return 'eth-staking';
  if (cats.has('eth')) return 'eth';

  const joined = symbols.join(' ');
  if (STABLE_SYMBOL.test(joined)) return 'stable';
  if (ETH_SYMBOL.test(joined)) return 'eth-staking';
  if (BTC_SYMBOL.test(joined)) return 'btc';
  return symbols.some((s) => s.length > 0) ? 'other' : 'unknown';
}

/** Asset-class weights, exported so the Method view uses the real numbers. */
export const ASSET_CLASS_SCORE: Record<AssetClass, number> = {
  stable: 1,
  rwa: 0.85,
  'eth-staking': 0.75,
  eth: 0.65,
  btc: 0.6,
  other: 0.4,
  unknown: 0.3,
};

/* ------------------------------- thresholds ------------------------------ */

/** Base weights, re-normalized when a factor is unavailable. Sums to 1. */
export const SCORE_WEIGHTS: Record<FactorKey, number> = {
  spread: 0.28,
  liquidity: 0.22,
  protocol: 0.22,
  maturity: 0.1,
  assetClass: 0.1,
  stability: 0.08,
};

/** Spread over the benchmark that scores 0 and 1 respectively. */
export const SPREAD_SCORE_RANGE = { zeroAtPct: 0, fullAtPct: 0.08 };

/** Log-scale liquidity band: 0 at $100k, 1 at $10M (a 100x range). */
export const LIQUIDITY_SCORE_RANGE = { zeroAtUsd: 100_000, fullAtUsd: 10_000_000 };

/** Maturity preference bands, in days. */
export const MATURITY_BANDS = {
  /** Below this, a heavy penalty. */
  penalizedBelowDays: 30,
  /** Ramps from penalty to full score between these. */
  fullFromDays: 90,
  /** Full score up to here. */
  fullToDays: 540,
  /** Decays from full to `decayFloor` between fullToDays and here. */
  decayToDays: 1095,
  decayFloor: 0.5,
  penalizedValue: 0.15,
};

/** Above this downward break of a stable accounting asset, flag it. */
export const PEG_FLAG_THRESHOLD = 0.02;
/** Above this downward break, the verdict is an automatic avoid. */
export const PEG_AVOID_THRESHOLD = 0.1;

/** The bars a verdict must clear. Used by `decideVerdict` and shown in the UI. */
export const VERDICT_RULES = {
  safe: {
    minLiquidityUsd: 5_000_000,
    minDays: 60,
    minSpreadPct: 0.01,
    minStability: 0.6,
  },
  balanced: {
    assetClasses: ['stable', 'rwa', 'eth-staking'] as AssetClass[],
    minLiquidityUsd: 1_000_000,
    minDays: 30,
    minSpreadPct: 0.005,
  },
};

export const VERDICT_LABEL: Record<Verdict, string> = {
  safe: 'Safe',
  balanced: 'Balanced',
  degen: 'Degens only',
  avoid: 'Avoid',
};

export const VERDICT_ORDER: Record<Verdict, number> = { safe: 0, balanced: 1, degen: 2, avoid: 3 };

/* --------------------------------- factors ------------------------------- */

export const FACTOR_LABELS: Record<FactorKey, string> = {
  spread: 'Spread vs benchmark',
  liquidity: 'Exit liquidity',
  protocol: 'Protocol depth',
  maturity: 'Maturity fit',
  assetClass: 'Collateral quality',
  stability: 'Yield stability',
};

/** $100k -> 0, $10M -> 1 on a log scale; interval 100x. */
export function liquidityFactor(liquidityUsd: number): number {
  if (liquidityUsd <= 0) return 0;
  const { zeroAtUsd, fullAtUsd } = LIQUIDITY_SCORE_RANGE;
  const decades = Math.log10(fullAtUsd / zeroAtUsd);
  return normalize(Math.log10(liquidityUsd / zeroAtUsd) / decades, 0, 1);
}

/** Prefer 3-18 months: too short adds roll churn, too long adds uncertainty. */
export function maturityFactor(days: number): number {
  const b = MATURITY_BANDS;
  if (days <= 0) return 0;
  if (days < b.penalizedBelowDays) return b.penalizedValue;
  if (days < b.fullFromDays) {
    return b.penalizedValue + (1 - b.penalizedValue) * ((days - b.penalizedBelowDays) / (b.fullFromDays - b.penalizedBelowDays));
  }
  if (days <= b.fullToDays) return 1;
  if (days <= b.decayToDays) {
    return 1 - (1 - b.decayFloor) * ((days - b.fullToDays) / (b.decayToDays - b.fullToDays));
  }
  return b.decayFloor;
}

export function spreadVsBenchmark(market: Market, benchmarkPct: number): number {
  return market.impliedApy - benchmarkPct;
}

/**
 * Downward deviation of a stable market's accounting asset from its peg.
 *
 * Only the *downward* direction counts: yield-bearing wrappers (sUSDe, reUSD,
 * sUSDai…) legitimately trade above $1, so an upward gap is not a signal.
 * Returns null when the market is not stable or no price is known.
 */
export function accountingAssetPegBreak(market: Market, assetClass: AssetClass): number | null {
  if (assetClass !== 'stable') return null;
  const price = market.accountingAsset.priceUsd;
  if (price === null || !Number.isFinite(price)) return null;
  return price < 1 ? 1 - price : 0;
}

/* ------------------------------- scoring --------------------------------- */

export function scoreMarket(market: Market, ctx: ScoreContext): MarketScore {
  const now = ctx.now ?? Date.now();
  const days = daysUntil(market.expiry, now);
  const spread = spreadVsBenchmark(market, ctx.benchmarkPct);
  const protocolDepth = depthFor(market, ctx.protocolFacts);
  const assetClass = classifyAsset(market.categoryIds, [
    market.underlyingAsset.symbol,
    market.accountingAsset.symbol,
    market.name,
  ]);
  const stab = stabilityScore(ctx.historyStats);

  const raw: ScoreFactor[] = [
    {
      key: 'spread',
      label: FACTOR_LABELS.spread,
      value: normalize(spread, SPREAD_SCORE_RANGE.zeroAtPct, SPREAD_SCORE_RANGE.fullAtPct),
      weight: SCORE_WEIGHTS.spread,
      detail: `${formatPct(spread)} over benchmark (${formatPct(market.impliedApy)} fixed)`,
    },
    {
      key: 'liquidity',
      label: FACTOR_LABELS.liquidity,
      value: liquidityFactor(market.liquidityUsd),
      weight: SCORE_WEIGHTS.liquidity,
      detail: `$${Math.round(market.liquidityUsd).toLocaleString('en-US')} pool liquidity`,
    },
    {
      key: 'protocol',
      label: FACTOR_LABELS.protocol,
      value: protocolDepth?.score ?? PROTOCOL_DEPTH.floor,
      weight: SCORE_WEIGHTS.protocol,
      detail: protocolDepth
        ? `${market.protocol}: depth ${Math.round(protocolDepth.score * 100)} from ${protocolDepth.markets} market${protocolDepth.markets === 1 ? '' : 's'} on ${protocolDepth.chains} chain${protocolDepth.chains === 1 ? '' : 's'}, ${formatCompactUsd(protocolDepth.tvlUsd)} TVL`
        : `${market.protocol}: no depth data in this snapshot`,
    },
    {
      key: 'maturity',
      label: FACTOR_LABELS.maturity,
      value: maturityFactor(days),
      weight: SCORE_WEIGHTS.maturity,
      detail: `${Math.round(days)} days to maturity`,
    },
    {
      key: 'assetClass',
      label: FACTOR_LABELS.assetClass,
      value: ASSET_CLASS_SCORE[assetClass],
      weight: SCORE_WEIGHTS.assetClass,
      detail: assetClass,
    },
  ];

  if (stab !== null) {
    raw.push({
      key: 'stability',
      label: FACTOR_LABELS.stability,
      value: stab,
      weight: SCORE_WEIGHTS.stability,
      detail: `σ ${formatPct(ctx.historyStats?.stddev ?? 0)} over ${ctx.historyStats?.points ?? 0} samples`,
    });
  }

  const totalWeight = raw.reduce((acc, f) => acc + f.weight, 0);
  const factors = raw.map((f) => ({ ...f, weight: f.weight / totalWeight }));
  const composite = factors.reduce((acc, f) => acc + f.value * f.weight, 0);

  const flags = buildFlags(market, {
    days,
    assetClass,
    minLiquidityUsd: ctx.minLiquidityUsd,
    stability: stab,
  });

  return {
    score: Math.round(clamp(composite, 0, 1) * 100),
    verdict: decideVerdict(market, {
      days,
      assetClass,
      spread,
      minLiquidityUsd: ctx.minLiquidityUsd,
      stability: stab,
    }),
    factors,
    flags,
    assetClass,
    protocolDepth,
  };
}

/**
 * Resolve the objective depth for a protocol from the snapshot facts, or `null`
 * when the snapshot produced none (single-market callers with no facts).
 */
function depthFor(
  market: Market,
  factsMap: ReadonlyMap<string, ProtocolFacts> | null | undefined,
): ProtocolDepth | null {
  const facts = factsMap?.get(normalizeProtocol(market.protocol));
  if (!facts) return null;
  return {
    score: protocolDepthScore(facts),
    markets: facts.markets,
    chains: facts.chains,
    tvlUsd: facts.tvlUsd,
    isPrime: facts.isPrime,
  };
}

interface FlagContext {
  days: number;
  assetClass: AssetClass;
  minLiquidityUsd: number;
  stability: number | null;
}

export const FLAG_DOCS: Record<string, string> = {
  expired: 'Maturity has passed. PT is redeemable; the AMM market is no longer tradeable.',
  'matures-soon': 'Under 30 days left — you will be rolling again shortly.',
  'long-dated': 'More than 2 years out — more time for the underlying to misbehave.',
  'thin-liquidity': 'Pool liquidity is below the bar you set in Settings — exiting early may cost.',
  'has-risk-notes': 'Pendle flagged specific risks for this market — read them on the detail view.',
  loopable: 'Collateral is commonly looped; expect correlated deleveraging pressure.',
  'unstable-yield': 'Implied APY has been volatile over the measured window.',
  'accounting-asset-off-peg': 'The asset PT redeems into is trading below its peg.',
};

function buildFlags(market: Market, ctx: FlagContext): string[] {
  const flags: string[] = [];
  if (ctx.days <= 0) flags.push('expired');
  else if (ctx.days < 30) flags.push('matures-soon');
  if (ctx.days > 730) flags.push('long-dated');
  if (market.liquidityUsd < ctx.minLiquidityUsd) flags.push('thin-liquidity');
  if (market.info.riskInvolved) flags.push('has-risk-notes');
  if (market.categoryIds.includes('pt-looping')) flags.push('loopable');
  if (ctx.stability !== null && ctx.stability < 0.5) flags.push('unstable-yield');
  const pegBreak = accountingAssetPegBreak(market, ctx.assetClass);
  if (pegBreak !== null && pegBreak > PEG_FLAG_THRESHOLD) flags.push('accounting-asset-off-peg');
  return flags;
}

interface VerdictContext {
  days: number;
  assetClass: AssetClass;
  spread: number;
  minLiquidityUsd: number;
  stability: number | null;
}

export function decideVerdict(market: Market, ctx: VerdictContext): Verdict {
  const safeRule = VERDICT_RULES.safe;
  const balancedRule = VERDICT_RULES.balanced;

  if (ctx.days <= 0 || market.impliedApy <= 0) return 'avoid';
  if (market.liquidityUsd < ctx.minLiquidityUsd) return 'avoid';
  // Only a *severe* break of the accounting asset's peg is an automatic avoid;
  // smaller downward deviations show up as a flag so the user can judge.
  const pegBreak = accountingAssetPegBreak(market, ctx.assetClass);
  if (pegBreak !== null && pegBreak > PEG_AVOID_THRESHOLD) return 'avoid';

  const safe =
    ctx.assetClass === 'stable' &&
    market.liquidityUsd >= safeRule.minLiquidityUsd &&
    ctx.days >= safeRule.minDays &&
    ctx.spread >= safeRule.minSpreadPct &&
    (ctx.stability === null || ctx.stability >= safeRule.minStability);
  if (safe) return 'safe';

  const balanced =
    balancedRule.assetClasses.includes(ctx.assetClass) &&
    market.liquidityUsd >= balancedRule.minLiquidityUsd &&
    ctx.days >= balancedRule.minDays &&
    ctx.spread >= balancedRule.minSpreadPct;
  if (balanced) return 'balanced';

  return 'degen';
}

/* ------------------------------- explainer ------------------------------- */

export interface FactorDoc {
  key: FactorKey;
  question: string;
  /** How the 0-100 sub-score is produced, in plain language. */
  method: string;
  /** Why it carries the weight it does. */
  why: string;
  /** What this factor deliberately does *not* capture. */
  caveat: string;
}

export const FACTOR_DOCS: Record<FactorKey, FactorDoc> = {
  spread: {
    key: 'spread',
    question: 'How much more does this market pay than a risk-free U.S. Treasury of similar duration?',
    method: `A straight line: 0 points at ${formatPct(SPREAD_SCORE_RANGE.zeroAtPct)} over the benchmark, 100 points at ${formatPct(
      SPREAD_SCORE_RANGE.fullAtPct,
    )} or more. A +4pp spread scores 50. At or below the benchmark it scores 0.`,
    why: 'The largest weight (28%), because the premium over the risk-free rate is the entire reason the trade exists. A fixed yield below Treasuries is not worth the smart-contract risk.',
    caveat:
      'A large spread is usually the market pricing in a risk you have not identified yet. Treat it as a question ("what do they know?") rather than an answer, and read the risk notes before trusting it.',
  },
  liquidity: {
    key: 'liquidity',
    question: 'If I need to sell PT before maturity, how much can the pool absorb without moving the price against me?',
    method: `Log scale: 0 points at $${(
      LIQUIDITY_SCORE_RANGE.zeroAtUsd / 1e6
    ).toFixed(1)}M and below, 50 points at $1M, 100 points at $${(LIQUIDITY_SCORE_RANGE.fullAtUsd / 1e6).toFixed(
      0,
    )}M and above. Log because the difference between $1M and $10M matters far more than between $51M and $60M.`,
    why: 'Second-largest weight (22%). PT is a fixed-yield instrument you may have to exit early, and thin AMM liquidity turns an early exit into a loss regardless of how good the rate looked.',
    caveat:
      'This measures the pool at one instant. Liquidity evaporates exactly when you need it (a depeg, a holiday, a points season ending), so treat it as a ceiling on what you could exit today, not a guarantee.',
  },
  protocol: {
    key: 'protocol',
    question: 'How substantial is the protocol you are lending to?',
    method: `No curation, no tier: every protocol is scored the same way, from facts in the snapshot. A weighted blend of total TVL (${(PROTOCOL_DEPTH.weights.tvl * 100).toFixed(0)}%, log scale from ${formatCompactUsd(PROTOCOL_DEPTH.tvl.zeroAtUsd)} to ${formatCompactUsd(PROTOCOL_DEPTH.tvl.fullAtUsd)}), market count (${(PROTOCOL_DEPTH.weights.markets * 100).toFixed(0)}%, ${PROTOCOL_DEPTH.markets.fullAt}+ markets maxes it), chain count (${(PROTOCOL_DEPTH.weights.chains * 100).toFixed(0)}%, ${PROTOCOL_DEPTH.chains.fullAt}+ chains maxes it) and Pendle's Prime flag (${(PROTOCOL_DEPTH.weights.prime * 100).toFixed(0)}%). The result is squeezed into ${Math.round(PROTOCOL_DEPTH.floor * 100)}–${Math.round(PROTOCOL_DEPTH.ceiling * 100)}, so no size proxy ever presents itself as certainty.`,
    why: 'Equal second weight (22%). A protocol with more live markets, deeper TVL and a Prime listing is more likely to have real infrastructure behind it than a single thin pool. It is a ranking input, not a safety verdict.',
    caveat:
      'This measures size and breadth, never trust. A protocol can be huge and still fail tomorrow — TVL is what a protocol shows right before it breaks as often as when it is sound. The app makes no protocol judgement at all: read the protocol docs, audits and Pendle risk notes before lending to it.',
  },
  maturity: {
    key: 'maturity',
    question: 'Does the lock-up match a sensible holding period?',
    method: `Full score between ${MATURITY_BANDS.fullFromDays} and ${MATURITY_BANDS.fullToDays} days (3–18 months). It ramps up from ${MATURITY_BANDS.penalizedBelowDays} days, and decays to ${MATURITY_BANDS.decayFloor} by ${MATURITY_BANDS.decayToDays} days (3 years). Under ${MATURITY_BANDS.penalizedBelowDays} days scores ${MATURITY_BANDS.penalizedValue}.`,
    why: 'Modest weight (10%). It is a preference, not a risk: very short paper means paying entry and exit costs again in a few weeks, while very long paper locks your capital through an unknown part of the cycle.',
    caveat:
      'A 16-day market at 10% is not "bad" — it is just a different trade, and you will pay to roll it. The score reflects fit, which is why short-dated paper can still rank well on spread and liquidity.',
  },
  assetClass: {
    key: 'assetClass',
    question: 'What does the PT actually redeem into at maturity?',
    method: `From Pendle's own collateral category: stablecoins = 100, RWA = 85, ETH staking tokens = 75, ETH = 65, BTC = 60, other = 40, unclassified = 30.`,
    why: 'Modest weight (10%). A fixed yield denominated in a stablecoin and one denominated in ETH are different products, and the score should not treat a volatile redemption as equivalent to a dollar.',
    caveat:
      'Classification uses Pendle category tags with a symbol fallback, so a mislabelled market can be misclassified. It also does not distinguish a T-Bill-backed stablecoin from a delta-neutral basis trade — the risk notes do that.',
  },
  stability: {
    key: 'stability',
    question: 'Is this headline rate a durable level, or a spike I am about to buy the top of?',
    method: `${(STABILITY.calmWeight * 100).toFixed(0)}% for calm (σ of implied APY: 100 points at 0, 0 points at ${formatPct(
      STABILITY.volatilityCap,
    )}) and ${(STABILITY.coverageWeight * 100).toFixed(
      0,
    )}% for consistency (share of hourly samples at or above the benchmark). Needs at least ${STABILITY.minSamples} samples; otherwise the factor is dropped and its weight is redistributed.`,
    why: 'Smallest weight (8%) because the data is shallow: Pendle caps history at roughly 2 months of hourly points, so this cannot see a full credit cycle.',
    caveat:
      'It can only see the window the API returns (about 2 months), and a new market has no history at all — in which case this factor is silently excluded rather than scored, and the remaining weights are re-normalized.',
  },
};

export const FACTOR_ORDER: FactorKey[] = ['spread', 'liquidity', 'protocol', 'maturity', 'assetClass', 'stability'];

export const SCORE_EXPLAINER = {
  formula: 'score = round(100 × Σ(factor score × factor weight)), with weights re-normalized to sum to 1',
  redFlags: [
    'A score is a summary of six numbers you can see — it is not a security audit.',
    'It cannot see team quality, governance, oracle design, or a contract bug that has not happened yet.',
    'The protocol factor measures size, not trust, and the spread and liquidity bands are conventions. Change the constants and the ranking changes.',
    'Nothing here is financial advice, and the highest score is not the best trade for your situation.',
  ],
};

/** Human sentence for each verdict, assembled from the same thresholds the code uses. */
export const VERDICT_RULE: Record<Verdict, string> = {
  safe: `Stable collateral, ≥$${VERDICT_RULES.safe.minLiquidityUsd / 1e6}M pool liquidity, ≥${
    VERDICT_RULES.safe.minDays
  } days to maturity, ≥${formatPct(VERDICT_RULES.safe.minSpreadPct)} over benchmark, and stable yield history.`,
  balanced: `${VERDICT_RULES.balanced.assetClasses.join('/')} collateral, ≥$${
    VERDICT_RULES.balanced.minLiquidityUsd / 1e6
  }M liquidity, ≥${VERDICT_RULES.balanced.minDays} days, ≥${formatPct(
    VERDICT_RULES.balanced.minSpreadPct,
  )} over benchmark.`,
  degen:
    'Passes the hard filters (live, liquid enough, positive rate, on peg) but misses the conservative bar — usually thin liquidity or exotic collateral.',
  avoid: `Fails a hard filter: expired, non-positive fixed rate, liquidity below your bar, or a stable accounting asset more than ${formatPct(
    PEG_AVOID_THRESHOLD,
    0,
  )} below its peg.`,
};
