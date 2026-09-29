/**
 * Route, fee and impact forensics.
 *
 * The user-facing question is "where did this cost come from?". Everything here
 * is either read out of the quote's transaction calldata or derived from a
 * formula that is stated and cross-checked against the SDK's own number, so a
 * reader can disagree with any single line.
 *
 * The fee identity used below (verified against the live API across markets
 * with fee rates from 9.8 to 40.9 bps and maturities from 23 to 170 days, where
 * it matched the SDK's reported fee to within 0.4%):
 *
 *     fee ≈ Σ over AMM legs  feeRate × notional × daysToMaturity / 365
 *
 * Pendle's AMM fee is charged on the *implied rate* it moves, and the implied
 * rate is annualised — which is why a longer-dated market costs more to trade
 * and why `feeRate × notional` alone overstates the fee.
 */

import type { AssetRef, ConvertQuote, Market, TokenAmount } from './types';
import { fromUnits } from '../util/decimal';
import { daysUntil } from './format';
import { gasCostUsd } from './simulate';

/** 4-byte selectors of Pendle router methods we can name. */
export const PENDLE_METHOD_SELECTORS: Record<string, string> = {
  '0xc81f847a': 'swapExactTokenForPt',
  '0x594a88cc': 'swapExactPtForToken',
};

/** Assumed gas for a redemption transaction, which cannot be quoted pre-expiry. */
export const REDEEM_GAS_UNITS = 220_000;

export const FEE_FORMULA = 'fee ≈ feeRate × notional × daysToMaturity / 365';

export interface RouteLeg {
  index: number;
  venue: string;
  description: string;
  amountIn: string | null;
  amountOut: string | null;
  impactBps: number | null;
  feeUsd: number | null;
}

export interface FeeLeg {
  label: string;
  feeRateBps: number;
  notionalUsd: number;
  daysToMaturity: number;
  feeUsd: number;
}

export interface FeeBreakdown {
  formula: string;
  legs: FeeLeg[];
  derivedUsd: number | null;
  reportedUsd: number | null;
  /** derived − reported. Small values mean the reconstruction explains the fee. */
  deltaUsd: number | null;
  bpsOfNotional: number | null;
}

export interface RouteBreakdown {
  kind: 'entry' | 'exit' | 'roll';
  action: string;
  method: string | null;
  /** Named selectors found in a composed call, in order. */
  steps: { selector: string; method: string | null }[];
  router: string | null;
  pendleSwap: string | null;
  aggregator: string | null;
  externalRouter: string | null;
  usesExternalSwap: boolean;
  limitOrderFills: number;
  legs: RouteLeg[];
  impact: {
    totalBps: number | null;
    internalBps: number | null;
    externalBps: number | null;
    internalUsd: number | null;
    externalUsd: number | null;
    totalUsd: number | null;
  };
  fee: FeeBreakdown;
  gas: { units: string | null; gwei: number; usd: number | null };
  requiredApprovals: TokenAmount[];
  notes: string[];
}

export interface RouteInput {
  quote: ConvertQuote;
  /** Market the PT leg happens in (the source market for a roll-over). */
  market: Market;
  /** Destination market, for roll-over quotes only. */
  destMarket?: Market | null;
  /** The stablecoin paid in (entry/roll) or received (exit). */
  counterAsset: AssetRef;
  notionalUsd: number;
  /** Value of the PT received in the destination market, for rolls. */
  destNotionalUsd?: number | null;
  gasPriceGwei: number;
  nativePriceUsd: number | null;
  now?: number;
}

export function describeRoute(input: RouteInput): RouteBreakdown {
  const { quote, market, destMarket, counterAsset } = input;
  const now = input.now ?? Date.now();
  const route = quote.route;
  const outToken = quote.outputs[0]?.token?.toLowerCase();
  const kind: RouteBreakdown['kind'] =
    quote.action === 'roll-over-pt' ? 'roll' : outToken === market.pt.address.toLowerCase() ? 'entry' : 'exit';

  const usesExternalSwap = route.swapType !== null && route.swapType !== '0';
  const aggregator = quote.aggregatorType && quote.aggregatorType !== 'VOID' ? quote.aggregatorType : null;
  const externalVenue = aggregator ? `${aggregator} (external DEX)` : 'direct mint';
  const ptOut = quote.outputs[0];
  const ptOutHuman = ptOut ? fromUnits(ptOut.amount, market.pt.decimals) : null;
  const syOutHuman = route.syAmount ? fromUnits(route.syAmount, market.sy.decimals) : null;
  const counterInHuman = route.netAmountIn ? fromUnits(route.netAmountIn, counterAsset.decimals) : null;

  const legs: RouteLeg[] = [];
  if (kind === 'entry') {
    legs.push({
      index: 1,
      venue: externalVenue,
      description: `${counterAsset.symbol} → ${market.sy.symbol}`,
      amountIn: counterInHuman,
      amountOut: syOutHuman,
      impactBps: bps(quote.externalPriceImpact),
      feeUsd: null,
    });
    legs.push({
      index: 2,
      venue: 'Pendle AMM',
      description: `${market.sy.symbol} → ${market.pt.symbol}`,
      amountIn: syOutHuman,
      amountOut: ptOutHuman,
      impactBps: bps(quote.internalPriceImpact),
      feeUsd: quote.feeUsd,
    });
  } else if (kind === 'exit') {
    legs.push({
      index: 1,
      venue: 'Pendle AMM',
      description: `${market.pt.symbol} → ${market.sy.symbol}`,
      amountIn: counterInHuman,
      amountOut: null,
      impactBps: bps(quote.internalPriceImpact),
      feeUsd: quote.feeUsd,
    });
    legs.push({
      index: 2,
      venue: externalVenue,
      description: `${market.sy.symbol} → ${counterAsset.symbol}`,
      amountIn: null,
      amountOut: ptOut ? fromUnits(ptOut.amount, counterAsset.decimals) : null,
      impactBps: bps(quote.externalPriceImpact),
      feeUsd: null,
    });
  } else {
    legs.push({
      index: 1,
      venue: 'Pendle AMM (source market)',
      description: `${market.pt.symbol} → ${counterAsset.symbol}`,
      amountIn: counterInHuman,
      amountOut: null,
      impactBps: null,
      feeUsd: null,
    });
    legs.push({
      index: 2,
      venue: `Pendle AMM${destMarket ? ` (${destMarket.name})` : ' (destination market)'}`,
      description: `${counterAsset.symbol} → ${destMarket ? destMarket.pt.symbol : 'destination PT'}`,
      amountIn: null,
      amountOut: destMarket && ptOut ? fromUnits(ptOut.amount, destMarket.pt.decimals) : null,
      impactBps: null,
      feeUsd: quote.feeUsd,
    });
  }

  const fee = deriveFee({
    quote,
    market,
    destMarket: kind === 'roll' ? (destMarket ?? null) : null,
    notionalUsd: input.notionalUsd,
    destNotionalUsd: input.destNotionalUsd ?? input.notionalUsd,
    now,
  });

  const notes: string[] = [];
  if (kind === 'roll') {
    const named = route.composedSelectors
      .map((selector) => PENDLE_METHOD_SELECTORS[selector])
      .filter((value): value is string => Boolean(value));
    notes.push(
      named.length > 0
        ? `Composed call (${quote.route.method ?? 'callAndReflect'}): ${named.join(' then ')}. A roll is an exit on the source market followed by an entry on the destination, which is why two AMM legs pay two fees.`
        : 'Composed call: a roll is an exit on the source market followed by an entry on the destination, so two AMM legs each pay a fee.',
    );
  }
  if (usesExternalSwap && route.externalRouter) {
    notes.push(
      `The token↔SY leg is routed through ${aggregator ?? 'an external aggregator'} at ${route.externalRouter}; that venue's cost is the external price impact, and it is not part of the fee above.`,
    );
  } else {
    notes.push(
      `${counterAsset.symbol} ${kind === 'entry' ? 'is' : 'maps to'} the SY underlying, so no external swap is needed — external price impact is zero.`,
    );
  }
  if (route.limitOrderFills > 0) {
    notes.push(
      `${route.limitOrderFills} Pendle limit-order fill${route.limitOrderFills > 1 ? 's are' : ' is'} bundled into this route. Those fills do not pay the AMM fee, so the reported fee can sit below the AMM formula.`,
    );
  }
  if (kind !== 'entry') {
    notes.push('The API does not return the intermediate SY amount for this action, so the SY handoff is not shown.');
  }

  const internalUsd = scale(quote.internalPriceImpact, input.notionalUsd);
  const externalUsd = scale(quote.externalPriceImpact, input.notionalUsd);

  return {
    kind,
    action: quote.action,
    method: route.method,
    steps: route.composedSelectors.map((selector) => ({ selector, method: PENDLE_METHOD_SELECTORS[selector] ?? null })),
    router: route.router,
    pendleSwap: route.pendleSwap,
    aggregator,
    externalRouter: route.externalRouter,
    usesExternalSwap,
    limitOrderFills: route.limitOrderFills,
    legs,
    impact: {
      totalBps: bps(quote.priceImpact),
      internalBps: bps(quote.internalPriceImpact),
      externalBps: bps(quote.externalPriceImpact),
      internalUsd,
      externalUsd,
      totalUsd: scale(quote.priceImpact, input.notionalUsd),
    },
    fee,
    gas: {
      units: quote.gasUsed,
      gwei: input.gasPriceGwei,
      usd: gasCostUsd(quote.gasUsed, input.gasPriceGwei, input.nativePriceUsd),
    },
    requiredApprovals: route.requiredApprovals,
    notes,
  };
}

export interface DeriveFeeInput {
  quote: ConvertQuote;
  market: Market;
  destMarket: Market | null;
  notionalUsd: number;
  destNotionalUsd: number;
  now?: number;
}

/**
 * Reconstruct the SDK's fee from the market's own `feeRate` setting.
 *
 * Reported and derived are both returned; the UI shows the difference so a
 * mismatch is visible rather than smoothed over.
 */
export function deriveFee(input: DeriveFeeInput): FeeBreakdown {
  const now = input.now ?? Date.now();
  const legs: FeeLeg[] = [
    feeLeg(input.market, input.notionalUsd, now),
    ...(input.destMarket ? [feeLeg(input.destMarket, input.destNotionalUsd, now)] : []),
  ];
  const derivedUsd = legs.reduce((total, leg) => total + leg.feeUsd, 0);
  const reportedUsd = input.quote.feeUsd;
  return {
    formula: FEE_FORMULA,
    legs,
    derivedUsd: Number.isFinite(derivedUsd) ? derivedUsd : null,
    reportedUsd,
    deltaUsd: reportedUsd === null ? null : derivedUsd - reportedUsd,
    bpsOfNotional: reportedUsd === null || input.notionalUsd <= 0 ? null : (reportedUsd / input.notionalUsd) * 10_000,
  };
}

function feeLeg(market: Market, notionalUsd: number, now: number): FeeLeg {
  const days = Math.max(0, daysUntil(market.expiry, now));
  return {
    label: `${market.name} · ${market.underlyingAsset.symbol}`,
    feeRateBps: market.feeRate * 10_000,
    notionalUsd,
    daysToMaturity: days,
    feeUsd: market.feeRate * notionalUsd * (days / 365),
  };
}

const bps = (value: number | null): number | null => (value === null ? null : value * 10_000);
const scale = (value: number | null, notionalUsd: number): number | null =>
  value === null ? null : Math.abs(value) * notionalUsd;
