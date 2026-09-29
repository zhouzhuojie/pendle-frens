/**
 * Pure simulation math.
 *
 * Every function here takes an already-fetched API quote (or a set of plain
 * numbers) and returns a structured, testable result. Network access lives in
 * `api/pendle.ts`; this module never fetches anything.
 *
 * Honesty rules enforced here:
 *  - gas is an *estimate* and is labelled as such by the UI,
 *  - `priceImpact` from the API is a model estimate, not a guarantee,
 *  - roll-over sensitivity is a function of *current* liquidity and is a
 *    scenario, never a prediction.
 */

import type {
  AssetRef,
  ConvertQuote,
  CostBreakdown,
  EntrySimulation,
  ExitSimulation,
  HistoryPoint,
  Market,
  RollSimulation,
  SensitivityRow,
} from './types';
import { clamp } from '../util/decimal';
import { daysUntil } from './format';

/* ------------------------------- request builders ------------------------ */

export interface EntryRequestInput {
  market: Market;
  tokenIn: AssetRef;
  /** base units */
  amountIn: string;
  receiver: string;
  slippage: number;
}

export interface ConvertRequestShape {
  chainId: number;
  tokenIn: string;
  amountIn: string;
  tokenOut: string;
  receiver: string;
  slippage: number;
  enableAggregator: boolean;
}

export function buildEntryRequest(input: EntryRequestInput): ConvertRequestShape {
  return {
    chainId: input.market.chainId,
    tokenIn: input.tokenIn.address,
    amountIn: input.amountIn,
    tokenOut: input.market.pt.address,
    receiver: input.receiver,
    slippage: input.slippage,
    enableAggregator: true,
  };
}

export function buildExitRequest(input: {
  market: Market;
  tokenOut: AssetRef;
  ptAmountUnits: string;
  receiver: string;
  slippage: number;
}): ConvertRequestShape {
  return {
    chainId: input.market.chainId,
    tokenIn: input.market.pt.address,
    amountIn: input.ptAmountUnits,
    tokenOut: input.tokenOut.address,
    receiver: input.receiver,
    slippage: input.slippage,
    enableAggregator: true,
  };
}

export function buildRollRequest(input: {
  source: Market;
  dest: Market;
  ptAmountUnits: string;
  receiver: string;
  slippage: number;
}): ConvertRequestShape {
  return {
    chainId: input.source.chainId,
    tokenIn: input.source.pt.address,
    amountIn: input.ptAmountUnits,
    tokenOut: input.dest.pt.address,
    receiver: input.receiver,
    slippage: input.slippage,
    enableAggregator: true,
  };
}

/* --------------------------------- helpers ------------------------------- */

export function gasCostUsd(gasUsed: string | null, gasPriceGwei: number, nativePriceUsd: number | null): number | null {
  if (!gasUsed || nativePriceUsd === null || !Number.isFinite(nativePriceUsd)) return null;
  const gas = Number(gasUsed);
  if (!Number.isFinite(gas) || gas <= 0) return null;
  return gas * gasPriceGwei * 1e-9 * nativePriceUsd;
}

export function buildCost(params: {
  notionalUsd: number;
  protocolFeeUsd: number | null;
  priceImpact: number | null;
  gasUsd: number | null;
}): CostBreakdown {
  const priceImpactUsd = params.priceImpact === null ? null : Math.abs(params.priceImpact) * params.notionalUsd;
  const parts = [params.protocolFeeUsd, priceImpactUsd, params.gasUsd].filter(
    (v): v is number => v !== null && Number.isFinite(v),
  );
  const totalUsd = parts.reduce((a, b) => a + b, 0);
  return {
    notionalUsd: params.notionalUsd,
    protocolFeeUsd: params.protocolFeeUsd,
    priceImpactUsd,
    gasUsd: params.gasUsd,
    totalUsd,
    totalBps: params.notionalUsd > 0 ? (totalUsd / params.notionalUsd) * 10_000 : 0,
  };
}

/** Impact of *this* order on the market's implied APY, in basis points. */
export function impliedApyImpactBps(before: number | null, after: number | null): number | null {
  if (before === null || after === null) return null;
  return (after - before) * 10_000;
}

/* -------------------------------- entry ---------------------------------- */

export interface EntryInput {
  market: Market;
  tokenIn: AssetRef;
  sizeUsd: number;
  quote: ConvertQuote;
  gasPriceGwei: number;
  nativePriceUsd: number | null;
  /** Override "now" for deterministic tests. */
  now?: number;
}

export function simulateEntry(input: EntryInput): EntrySimulation {
  const { market, quote } = input;
  const ptAmount = quote.outputs[0]?.amount ?? '0';
  const ptOut = Number(ptAmount) / 10 ** market.pt.decimals;
  const days = daysUntil(market.expiry, input.now ?? Date.now());
  const ptPriceUsd = ptOut > 0 ? input.sizeUsd / ptOut : 0;

  // At maturity one PT redeems for one accounting unit. We value that unit in
  // USD using the provider price, which for stables is ~1 and for volatile
  // collateral is the live mark (i.e. this is a *mark*, not a promise).
  const accountingPrice = market.accountingAsset.priceUsd ?? 1;
  const valueAtMaturityUsd = ptOut * accountingPrice;
  const profitAtMaturityUsd = valueAtMaturityUsd - input.sizeUsd;
  const years = days / 365;
  const simpleApy = years > 0 && input.sizeUsd > 0 ? profitAtMaturityUsd / input.sizeUsd / years : 0;

  const cost = buildCost({
    notionalUsd: input.sizeUsd,
    protocolFeeUsd: quote.feeUsd,
    priceImpact: quote.priceImpact,
    gasUsd: gasCostUsd(quote.gasUsed, input.gasPriceGwei, input.nativePriceUsd),
  });

  // Exit cost is not part of an entry quote, so break-even uses this leg's
  // cost only and is explicitly reported as a lower bound.
  const dailyCarry = days > 0 ? profitAtMaturityUsd / days : 0;
  const breakEvenDays = dailyCarry > 0 ? cost.totalUsd / dailyCarry : null;

  return {
    kind: 'entry',
    marketId: market.id,
    quote,
    sizeUsd: input.sizeUsd,
    tokenIn: input.tokenIn,
    ptOut,
    ptPriceUsd,
    valueAtMaturityUsd,
    profitAtMaturityUsd,
    simpleApy,
    effectiveApy: quote.effectiveApy,
    impliedApyMarket: market.impliedApy,
    impliedApyAfterTrade: quote.impliedApyAfter,
    impactBps: impliedApyImpactBps(quote.impliedApyBefore, quote.impliedApyAfter),
    daysToMaturity: days,
    breakEvenDays,
    cost,
  };
}

/* --------------------------------- exit ---------------------------------- */

export interface ExitInput {
  market: Market;
  tokenOut: AssetRef;
  ptAmountUnits: string;
  quote: ConvertQuote;
  gasPriceGwei: number;
  nativePriceUsd: number | null;
  notionalUsd: number;
}

export function simulateExit(input: ExitInput): ExitSimulation {
  const { market, quote } = input;
  const ptIn = Number(input.ptAmountUnits) / 10 ** market.pt.decimals;
  const outAmount = quote.outputs[0]?.amount ?? '0';
  const amountOut = Number(outAmount) / 10 ** input.tokenOut.decimals;
  const proceedsUsd = amountOut * (input.tokenOut.priceUsd ?? 1);

  const cost = buildCost({
    notionalUsd: input.notionalUsd,
    protocolFeeUsd: quote.feeUsd,
    priceImpact: quote.priceImpact,
    gasUsd: gasCostUsd(quote.gasUsed, input.gasPriceGwei, input.nativePriceUsd),
  });

  return {
    kind: 'exit',
    marketId: market.id,
    quote,
    ptIn,
    notionalUsd: input.notionalUsd,
    tokenOut: input.tokenOut,
    amountOut,
    proceedsUsd,
    effectiveApy: quote.effectiveApy,
    impliedApyAfterTrade: quote.impliedApyAfter,
    cost,
  };
}

/* --------------------------------- roll ---------------------------------- */

export interface RollInput {
  source: Market;
  dest: Market;
  ptAmountUnits: string;
  quote: ConvertQuote;
  notionalUsd: number;
  gasPriceGwei: number;
  nativePriceUsd: number | null;
  sensitivity?: SensitivityRow[];
  now?: number;
}

export function simulateRoll(input: RollInput): RollSimulation {
  const { source, dest, quote } = input;
  const now = input.now ?? Date.now();
  const ptIn = Number(input.ptAmountUnits) / 10 ** source.pt.decimals;
  const destPtAmount = quote.outputs[0]?.amount ?? '0';
  const destPtOut = Number(destPtAmount) / 10 ** dest.pt.decimals;
  const destPtPriceUsd = destPtOut > 0 ? input.notionalUsd / destPtOut : 0;

  const cost = buildCost({
    notionalUsd: input.notionalUsd,
    protocolFeeUsd: quote.feeUsd,
    priceImpact: quote.priceImpact,
    gasUsd: gasCostUsd(quote.gasUsed, input.gasPriceGwei, input.nativePriceUsd),
  });

  const dragBps =
    quote.effectiveApy === null ? null : (quote.effectiveApy - dest.impliedApy) * 10_000;

  return {
    kind: 'roll',
    sourceMarketId: source.id,
    destMarketId: dest.id,
    destLabel: `${dest.name} · ${dest.underlyingAsset.symbol}`,
    quote,
    ptIn,
    notionalUsd: input.notionalUsd,
    destPtOut,
    destPtPriceUsd,
    destPtMarketPriceUsd: dest.pt.priceUsd,
    destParValueUsd: destPtOut * (dest.accountingAsset.priceUsd ?? 1),
    destDaysToMaturity: daysUntil(dest.expiry, now),
    destHeadlineApy: dest.impliedApy,
    destEffectiveApy: quote.effectiveApy,
    dragBps,
    cost,
    sensitivity: input.sensitivity ?? [],
  };
}

/** Multipliers used for the roll-over sensitivity sweep. */
export const SENSITIVITY_MULTIPLIERS = [0.25, 0.5, 1, 2, 5] as const;

/**
 * Statistical stability of a market's implied APY, used to judge whether the
 * headline fixed rate is a one-off spike or a durable level.
 */
export function summarizeHistory(points: HistoryPoint[]): {
  samples: number;
  mean: number | null;
  min: number | null;
  max: number | null;
  p10: number | null;
  p90: number | null;
} {
  const values = points
    .map((p) => p.impliedApy)
    .filter((v): v is number => v !== null && Number.isFinite(v))
    .sort((a, b) => a - b);
  if (values.length === 0) return { samples: 0, mean: null, min: null, max: null, p10: null, p90: null };
  const at = (q: number) => {
    const pos = (values.length - 1) * q;
    const base = Math.floor(pos);
    const lo = values[base]!;
    const hi = values[Math.min(base + 1, values.length - 1)]!;
    return lo + (pos - base) * (hi - lo);
  };
  return {
    samples: values.length,
    mean: values.reduce((a, b) => a + b, 0) / values.length,
    min: values[0]!,
    max: values[values.length - 1]!,
    p10: at(0.1),
    p90: at(0.9),
  };
}

/** Simple roll-over cost projection from the current liquidity depth. */
export function projectRollCost(rows: SensitivityRow[], targetSizeUsd: number): { costUsd: number; bps: number } | null {
  if (rows.length === 0 || targetSizeUsd <= 0) return null;
  const anchors = [...rows].sort((a, b) => a.sizeUsd - b.sizeUsd);
  const first = anchors[0]!;
  // Linear-in-size model anchored at the smallest observation; conservative
  // because impact usually grows super-linearly with size.
  const bpsPerUsd = first.sizeUsd > 0 ? first.totalBps / first.sizeUsd : 0;
  const bps = clamp(bpsPerUsd * targetSizeUsd, 0, 5_000);
  return { costUsd: (bps / 10_000) * targetSizeUsd, bps };
}

/* ------------------------- trajectories & comparison ---------------------- */

/**
 * Fair value of a PT position over time.
 *
 * One PT redeems for one accounting unit at maturity, so the value converges to
 * par. Discounting par at the market's implied rate gives the path in between:
 *   value(t) = par / (1 + impliedApy)^(years remaining)
 * This is the market's own pricing identity, not a forecast — if the implied
 * rate moves, so does the path. The UI says so.
 */
export function fairValuePath(
  parValueUsd: number,
  impliedApy: number,
  daysToMaturity: number,
  steps = 24,
): TrajectoryPoint[] {
  const safeApy = Math.max(-0.99, Number.isFinite(impliedApy) ? impliedApy : 0);
  const safeDays = Math.max(0, Number.isFinite(daysToMaturity) ? daysToMaturity : 0);
  const count = Math.max(2, steps);
  const points: TrajectoryPoint[] = [];
  for (let i = 0; i <= count; i += 1) {
    const day = (safeDays * i) / count;
    const yearsLeft = (safeDays - day) / 365;
    points.push({ day, usd: parValueUsd / Math.pow(1 + safeApy, yearsLeft) });
  }
  return points;
}

export interface TrajectoryPoint {
  day: number;
  usd: number;
}

export interface TrajectorySeries {
  id: 'hold' | 'roll';
  label: string;
  points: TrajectoryPoint[];
}

export interface ScenarioInput {
  entry: EntrySimulation;
  exit?: ExitSimulation | null;
  roll?: RollSimulation | null;
}

export interface TrajectoryResult {
  series: TrajectorySeries[];
  xMaxDays: number;
  /** What you paid in. The break-even line on the chart. */
  costBasisUsd: number;
  /** What you would get by unwinding today, if we priced an exit. */
  exitTodayUsd: number | null;
}

export function buildTrajectories(input: ScenarioInput): TrajectoryResult {
  const { entry, exit, roll } = input;
  const series: TrajectorySeries[] = [
    {
      id: 'hold',
      label: 'Hold this PT to maturity',
      points: fairValuePath(entry.valueAtMaturityUsd, entry.impliedApyMarket, entry.daysToMaturity),
    },
  ];

  if (roll && roll.destDaysToMaturity > 0) {
    const points = fairValuePath(roll.destParValueUsd, roll.destHeadlineApy, roll.destDaysToMaturity);
    // Today you own the destination PT at its market mark, which is below the
    // fair-value curve's day-0 point by exactly the roll-over cost.
    const mark = roll.destPtOut * (roll.destPtMarketPriceUsd ?? roll.destPtPriceUsd);
    if (points.length > 0 && mark > 0) points[0] = { day: 0, usd: mark };
    series.push({ id: 'roll', label: `Roll to ${roll.destLabel}`, points });
  }

  const xMaxDays = series.reduce((max, s) => Math.max(max, s.points[s.points.length - 1]?.day ?? 0), entry.daysToMaturity);

  return {
    series,
    xMaxDays,
    costBasisUsd: entry.sizeUsd,
    exitTodayUsd: exit ? exit.proceedsUsd : null,
  };
}

export interface ScenarioSummary {
  id: 'hold' | 'exit' | 'roll';
  label: string;
  /** Annualised rate for this path, so different maturities compare fairly. */
  apy: number | null;
  endValueUsd: number;
  profitUsd: number;
  days: number;
  cost: CostBreakdown;
  note: string;
}
/** The three ways today's capital can end up, on one comparable footing. */
export function compareScenarios(input: ScenarioInput): ScenarioSummary[] {
  const { entry, exit, roll } = input;
  const out: ScenarioSummary[] = [
    {
      id: 'hold',
      label: 'Buy PT and hold to maturity',
      apy: entry.effectiveApy ?? entry.simpleApy,
      endValueUsd: entry.valueAtMaturityUsd,
      profitUsd: entry.profitAtMaturityUsd,
      days: entry.daysToMaturity,
      cost: entry.cost,
      note: 'Entry cost is already inside the PT you receive.',
    },
  ];

  if (exit) {
    out.push({
      id: 'exit',
      label: 'Exit today',
      apy: null,
      endValueUsd: exit.proceedsUsd,
      profitUsd: exit.proceedsUsd - entry.sizeUsd,
      days: 0,
      cost: exit.cost,
      note: 'Realised straight away, so the loss is the round-trip cost.',
    });
  }

  if (roll) {
    out.push({
      id: 'roll',
      label: `Roll to ${roll.destLabel} and hold`,
      apy: roll.destEffectiveApy,
      endValueUsd: roll.destParValueUsd,
      profitUsd: roll.destParValueUsd - entry.sizeUsd,
      days: roll.destDaysToMaturity,
      cost: roll.cost,
      note: 'Ends at a different date, so compare the APY rather than the absolute profit.',
    });
  }

  return out;
}

/* ------------------------------ maturity plan ----------------------------- */

export interface MaturityOption {
  id: 'redeem' | 'roll-at-maturity' | 'roll-now';
  label: string;
  /** What the action you take *at maturity* costs (today's price for roll-now). */
  actionCostUsd: number;
  /** Whether that action cost is a live quote or a model. */
  basis: 'quoted' | 'modelled';
  /** Value you end up holding once the action completes. */
  endValueUsd: number;
  /** Total holding period from today to that end value. */
  totalDays: number;
  /**
   * Entry friction + action friction. Explanatory only: `valueAtMaturity` and
   * the end values already have costs deducted, so this is not subtracted again.
   */
  totalFrictionUsd: number;
  totalFrictionBps: number;
  /** End value minus the original cash outlay. Already net of every cost. */
  netProfitUsd: number;
  netApy: number | null;
  note: string;
}

export interface MaturityPlanInput {
  entry: EntrySimulation;
  successor?: Market | null;
  /**
   * A quote for buying the successor PT with the expected maturity proceeds.
   * Buying at maturity is the right model: PT-A redeems at par, so the exit leg
   * of the roll is free and what is left is a fresh entry.
   */
  successorEntry?: EntrySimulation | null;
  rollNow?: RollSimulation | null;
  /** Estimated gas for the redemption transaction (cannot be quoted pre-expiry). */
  redeemGasUsd: number | null;
  now?: number;
}

/**
 * The three things you can actually do with a PT position, priced side by side.
 *
 * The important correction this encodes: holding to maturity has *no* exit
 * cost. PT redeems 1:1 through the SY redeemer — a protocol action, not an AMM
 * swap — so there is no swap fee and no price impact. Rolling at maturity is
 * therefore a fresh entry into the successor, not a round trip.
 */
export function buildMaturityPlan(input: MaturityPlanInput): MaturityOption[] {
  const { entry, successor, successorEntry, rollNow } = input;
  const now = input.now ?? Date.now();
  const redeemGasUsd = input.redeemGasUsd ?? 0;
  const options: MaturityOption[] = [];

  options.push(
    makeOption({
      id: 'redeem',
      label: 'Redeem at par and stop',
      actionCostUsd: redeemGasUsd,
      basis: 'modelled',
      endValueUsd: entry.valueAtMaturityUsd,
      totalDays: entry.daysToMaturity,
      entry,
      note: 'Modelled, not quoted: one PT redeems for one accounting unit through the SY redeemer at maturity. No AMM swap, so no swap fee and no price impact — gas only.',
    }),
  );

  if (successor && successorEntry) {
    const successorDays = daysUntil(successor.expiry, now);
    options.push(
      makeOption({
        id: 'roll-at-maturity',
        label: `Roll into ${successor.underlyingAsset.symbol} at maturity`,
        actionCostUsd: redeemGasUsd + successorEntry.cost.totalUsd,
        basis: 'quoted',
        endValueUsd: successorEntry.valueAtMaturityUsd,
        totalDays: entry.daysToMaturity + successorDays,
        entry,
        note: `At maturity you redeem at par, then buy the successor PT. That purchase is quoted at today's liquidity and sized at your expected proceeds; the exit leg costs nothing because redemption is at par. Quote is for ${successor.underlyingAsset.symbol} expiring ${successor.expiry.slice(0, 10)}.`,
      }),
    );
  }

  if (rollNow) {
    options.push(
      makeOption({
        id: 'roll-now',
        label: 'Roll over today instead',
        actionCostUsd: rollNow.cost.totalUsd,
        basis: 'quoted',
        endValueUsd: rollNow.destParValueUsd,
        totalDays: rollNow.destDaysToMaturity,
        entry,
        note: 'Rolls before maturity, so the source PT is sold at its discounted price rather than redeemed at par — and you carry the destination market for longer.',
      }),
    );
  }

  return options;
}

function makeOption(input: {
  id: MaturityOption['id'];
  label: string;
  actionCostUsd: number;
  basis: MaturityOption['basis'];
  endValueUsd: number;
  totalDays: number;
  entry: EntrySimulation;
  note: string;
}): MaturityOption {
  const totalFrictionUsd = input.entry.cost.totalUsd + input.actionCostUsd;
  const netProfitUsd = input.endValueUsd - input.entry.sizeUsd;
  const years = input.totalDays / 365;
  return {
    id: input.id,
    label: input.label,
    actionCostUsd: input.actionCostUsd,
    basis: input.basis,
    endValueUsd: input.endValueUsd,
    totalDays: input.totalDays,
    totalFrictionUsd,
    totalFrictionBps: input.entry.sizeUsd > 0 ? (totalFrictionUsd / input.entry.sizeUsd) * 10_000 : 0,
    netProfitUsd,
    netApy: years > 0 && input.entry.sizeUsd > 0 ? netProfitUsd / input.entry.sizeUsd / years : null,
    note: input.note,
  };
}
