import { describe, expect, it } from 'vitest';
import {
  buildCost,
  buildEntryRequest,
  buildExitRequest,
  buildMaturityPlan,
  buildRollRequest,
  buildTrajectories,
  compareScenarios,
  fairValuePath,
  gasCostUsd,
  impliedApyImpactBps,
  projectRollCost,
  simulateEntry,
  simulateExit,
  simulateRoll,
  summarizeHistory,
} from '../src/lib/domain/simulate';
import type { HistoryPoint, SensitivityRow } from '../src/lib/domain/types';
import { makeAsset, makeMarket, makeQuote } from './fixtures';

describe('request builders', () => {
  const market = makeMarket();
  const token = makeAsset({ address: '0xusdc', symbol: 'USDC', decimals: 6 });

  it('builds an entry swap with the aggregator enabled', () => {
    const request = buildEntryRequest({ market, tokenIn: token, amountIn: '50000000000', receiver: '0xdead', slippage: 0.01 });
    expect(request).toEqual({
      chainId: 1,
      tokenIn: '0xusdc',
      amountIn: '50000000000',
      tokenOut: market.pt.address,
      receiver: '0xdead',
      slippage: 0.01,
      enableAggregator: true,
    });
  });

  it('builds an exit swap from PT', () => {
    const request = buildExitRequest({ market, tokenOut: token, ptAmountUnits: '1000000', receiver: '0xdead', slippage: 0.005 });
    expect(request.tokenIn).toBe(market.pt.address);
    expect(request.tokenOut).toBe('0xusdc');
    expect(request.slippage).toBe(0.005);
  });

  it('builds a roll-over from source PT to destination PT', () => {
    const dest = makeMarket({ id: '1-0xdest', pt: makeAsset({ address: '0xdestpt' }) });
    const request = buildRollRequest({ source: market, dest, ptAmountUnits: '1000000', receiver: '0xdead', slippage: 0.01 });
    expect(request.tokenIn).toBe(market.pt.address);
    expect(request.tokenOut).toBe('0xdestpt');
  });
});

describe('gasCostUsd', () => {
  it('prices gas from units, gwei and native USD', () => {
    // 1,091,129 gas * 5 gwei = 0.005455645 ETH * $2710.76
    const usd = gasCostUsd('1091129', 5, 2710.76133394);
    expect(usd).toBeCloseTo(14.79, 1);
  });

  it('returns null when inputs are missing', () => {
    expect(gasCostUsd(null, 5, 2710)).toBeNull();
    expect(gasCostUsd('1091129', 5, null)).toBeNull();
    expect(gasCostUsd('not-a-number', 5, 2710)).toBeNull();
  });
});

describe('buildCost', () => {
  it('sums fee, impact and gas into USD and bps', () => {
    const cost = buildCost({ notionalUsd: 50_000, protocolFeeUsd: 20, priceImpact: -0.0004, gasUsd: 15 });
    expect(cost.priceImpactUsd).toBeCloseTo(20, 6);
    expect(cost.totalUsd).toBeCloseTo(55, 6);
    expect(cost.totalBps).toBeCloseTo(11, 6);
  });

  it('ignores null parts', () => {
    const cost = buildCost({ notionalUsd: 10_000, protocolFeeUsd: null, priceImpact: null, gasUsd: null });
    expect(cost.totalUsd).toBe(0);
    expect(cost.totalBps).toBe(0);
  });
});

describe('impliedApyImpactBps', () => {
  it('reports the bps move', () => {
    expect(impliedApyImpactBps(0.115, 0.1145)).toBeCloseTo(-5, 6);
    expect(impliedApyImpactBps(null, 0.1)).toBeNull();
  });
});

describe('simulateEntry', () => {
  const market = makeMarket();
  const tokenIn = makeAsset({ address: '0xusdc', symbol: 'USDC', decimals: 6 });

  it('values the position at maturity and nets out costs already baked into the quote', () => {
    const result = simulateEntry({
      market,
      tokenIn,
      sizeUsd: 50_000,
      quote: makeQuote(),
      gasPriceGwei: 5,
      nativePriceUsd: 2710,
      now: Date.now(),
    });

    // 51057857520 / 1e6 = 51057.85752 PT
    expect(result.ptOut).toBeCloseTo(51_057.85752, 4);
    expect(result.ptPriceUsd).toBeCloseTo(50_000 / 51_057.85752, 8);
    // accounting asset (USDC) is $1, so maturity value == PT count
    expect(result.valueAtMaturityUsd).toBeCloseTo(51_057.85752, 4);
    expect(result.profitAtMaturityUsd).toBeCloseTo(1_057.85752, 4);
    expect(result.simpleApy).toBeGreaterThan(0.03);
    expect(result.effectiveApy).toBeCloseTo(0.11321, 6);
    expect(result.impactBps).toBeCloseTo(-0.052, 3);
    // fee 20.1 + impact 21.015 + gas ~14.79
    expect(result.cost.totalUsd).toBeCloseTo(55.9, 0);
  });

  it('uses the accounting-asset price for volatile collateral', () => {
    const volatile = makeMarket({
      accountingAsset: makeAsset({ address: '0xweth', symbol: 'WETH', decimals: 18, priceUsd: 3000 }),
      pt: makeAsset({ address: '0xpt', decimals: 18 }),
    });
    const result = simulateEntry({
      market: volatile,
      tokenIn,
      sizeUsd: 50_000,
      quote: makeQuote({ outputs: [{ token: '0xpt', amount: '17000000000000000000' }] }),
      gasPriceGwei: 5,
      nativePriceUsd: 2710,
      now: Date.now(),
    });
    expect(result.ptOut).toBeCloseTo(17, 6);
    expect(result.valueAtMaturityUsd).toBeCloseTo(51_000, 6);
  });
});

describe('simulateExit', () => {
  it('computes proceeds and cost', () => {
    const market = makeMarket();
    const tokenOut = makeAsset({ address: '0xusdc', symbol: 'USDC', decimals: 6, priceUsd: 1 });
    const result = simulateExit({
      market,
      tokenOut,
      ptAmountUnits: '56357810912',
      quote: makeQuote({ outputs: [{ token: '0xusdc', amount: '55126536982' }], priceImpact: -0.00073, feeUsd: 22.17 }),
      gasPriceGwei: 5,
      nativePriceUsd: 2710,
      notionalUsd: 55_000,
    });
    expect(result.amountOut).toBeCloseTo(55_126.536982, 4);
    expect(result.proceedsUsd).toBeCloseTo(55_126.536982, 4);
    expect(result.cost.totalUsd).toBeGreaterThan(60);
  });
});

describe('simulateRoll', () => {
  it('reports destination APY drag and cost', () => {
    const source = makeMarket();
    const dest = makeMarket({ id: '1-0xdest', pt: makeAsset({ address: '0xdestpt', decimals: 6 }), impliedApy: 0.1 });
    const result = simulateRoll({
      source,
      dest,
      ptAmountUnits: '50000000000',
      quote: makeQuote({
        outputs: [{ token: '0xdestpt', amount: '50500000000' }],
        effectiveApy: 0.0985,
        priceImpact: -0.0005,
        feeUsd: 30,
      }),
      notionalUsd: 49_000,
      gasPriceGwei: 5,
      nativePriceUsd: 2710,
      sensitivity: [],
    });
    expect(result.destPtOut).toBeCloseTo(50_500, 4);
    expect(result.destHeadlineApy).toBe(0.1);
    expect(result.destEffectiveApy).toBeCloseTo(0.0985, 6);
    expect(result.dragBps).toBeCloseTo(-15, 6);
    expect(result.cost.protocolFeeUsd).toBe(30);
    expect(result.cost.priceImpactUsd).toBeCloseTo(24.5, 6);
  });

  it('leaves roll drag null when the API did not price an effective APY', () => {
    const source = makeMarket();
    const dest = makeMarket({ id: '1-0xdest' });
    const result = simulateRoll({
      source,
      dest,
      ptAmountUnits: '1000000',
      quote: makeQuote({ effectiveApy: null }),
      notionalUsd: 1000,
      gasPriceGwei: 5,
      nativePriceUsd: 2710,
    });
    expect(result.dragBps).toBeNull();
  });
});

describe('projectRollCost', () => {
  it('scales cost linearly from the smallest anchor', () => {
    const rows: SensitivityRow[] = [
      { sizeUsd: 25_000, totalCostUsd: 25, totalBps: 10, effectiveApy: 0.0999 },
      { sizeUsd: 100_000, totalCostUsd: 160, totalBps: 16, effectiveApy: 0.0995 },
    ];
    const projection = projectRollCost(rows, 200_000);
    expect(projection).not.toBeNull();
    // 10 bps at $25k -> 80 bps at $200k
    expect(projection!.bps).toBeCloseTo(80, 6);
    expect(projection!.costUsd).toBeCloseTo(1_600, 6);
  });

  it('returns null without anchors', () => {
    expect(projectRollCost([], 1000)).toBeNull();
  });
});

describe('summarizeHistory', () => {
  it('computes percentiles', () => {
    const points: HistoryPoint[] = [0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08, 0.09, 0.1].map((v, i) => ({
      timestamp: new Date(i * 3_600_000).toISOString(),
      impliedApy: v,
      ptPrice: null,
      totalTvl: null,
      underlyingApy: null,
    }));
    const summary = summarizeHistory(points);
    expect(summary.samples).toBe(10);
    expect(summary.min).toBeCloseTo(0.01, 6);
    expect(summary.max).toBeCloseTo(0.1, 6);
    expect(summary.p10).toBeCloseTo(0.019, 6);
    expect(summary.p90).toBeCloseTo(0.091, 6);
  });
});

describe('fairValuePath', () => {
  it('starts at the discounted price and ends exactly at par', () => {
    // $100 par, 10% implied, 365 days: day 0 is 100/1.1 = 90.909...
    const path = fairValuePath(100, 0.1, 365, 10);
    expect(path[0]!.day).toBe(0);
    expect(path[0]!.usd).toBeCloseTo(90.909, 3);
    expect(path[path.length - 1]!.day).toBe(365);
    expect(path[path.length - 1]!.usd).toBeCloseTo(100, 6);
  });

  it('increases monotonically toward par', () => {
    const path = fairValuePath(1000, 0.12, 180, 12);
    for (let i = 1; i < path.length; i += 1) {
      expect(path[i]!.usd).toBeGreaterThan(path[i - 1]!.usd);
    }
  });

  it('is flat when the implied rate is zero, and never divides by zero', () => {
    const flat = fairValuePath(100, 0, 90, 4);
    expect(flat.every((p) => p.usd === 100)).toBe(true);
    const guarded = fairValuePath(100, -5, 90, 4);
    expect(guarded.every((p) => Number.isFinite(p.usd))).toBe(true);
  });

  it('handles an already-mature market', () => {
    const path = fairValuePath(100, 0.1, 0, 4);
    expect(path.every((p) => p.usd === 100)).toBe(true);
    expect(path.every((p) => p.day === 0)).toBe(true);
  });
});

describe('buildTrajectories / compareScenarios', () => {
  const entry = simulateEntry({
    market: makeMarket(),
    tokenIn: makeAsset({ address: '0xusdc', symbol: 'USDC', decimals: 6 }),
    sizeUsd: 50_000,
    quote: makeQuote(),
    gasPriceGwei: 5,
    nativePriceUsd: 2710,
  });

  const roll = simulateRoll({
    source: makeMarket(),
    dest: makeMarket({ id: '1-0xdest', expiry: new Date(Date.now() + 300 * 86_400_000).toISOString(), impliedApy: 0.09 }),
    ptAmountUnits: '51057857520',
    quote: makeQuote({ outputs: [{ token: '0xdestpt', amount: '50500000000' }], effectiveApy: 0.088, priceImpact: -0.001, feeUsd: 25 }),
    notionalUsd: 49_980,
    gasPriceGwei: 5,
    nativePriceUsd: 2710,
  });

  it('produces one hold curve and, with a roll, a second curve to the later maturity', () => {
    const one = buildTrajectories({ entry });
    expect(one.series).toHaveLength(1);
    expect(one.series[0]!.id).toBe('hold');
    expect(one.exitTodayUsd).toBeNull();
    expect(one.costBasisUsd).toBe(50_000);

    const two = buildTrajectories({ entry, roll });
    expect(two.series.map((s) => s.id)).toEqual(['hold', 'roll']);
    // The x axis stretches to the furthest maturity.
    expect(two.xMaxDays).toBeCloseTo(roll.destDaysToMaturity, 3);
    expect(two.xMaxDays).toBeGreaterThan(entry.daysToMaturity);
  });

  it('anchors the roll curve at the mark you actually own, below its fair value', () => {
    const { series } = buildTrajectories({ entry, roll });
    const rollCurve = series.find((s) => s.id === 'roll')!;
    const mark = roll.destPtOut * (roll.destPtMarketPriceUsd ?? roll.destPtPriceUsd);
    expect(rollCurve.points[0]!.usd).toBeCloseTo(mark, 6);
    // …and converges to the destination par value.
    expect(rollCurve.points[rollCurve.points.length - 1]!.usd).toBeCloseTo(roll.destParValueUsd, 6);
  });

  it('summarises the three scenarios on a comparable footing', () => {
    const exit = simulateExit({
      market: makeMarket(),
      tokenOut: makeAsset({ address: '0xusdc', symbol: 'USDC', decimals: 6 }),
      ptAmountUnits: '51057857520',
      quote: makeQuote({ outputs: [{ token: '0xusdc', amount: '49900000000' }] }),
      notionalUsd: 49_980,
      gasPriceGwei: 5,
      nativePriceUsd: 2710,
    });

    const scenarios = compareScenarios({ entry, exit, roll });
    expect(scenarios.map((s) => s.id)).toEqual(['hold', 'exit', 'roll']);

    const hold = scenarios[0]!;
    expect(hold.profitUsd).toBeCloseTo(entry.profitAtMaturityUsd, 6);
    expect(hold.days).toBeCloseTo(entry.daysToMaturity, 6);

    const exitScenario = scenarios[1]!;
    expect(exitScenario.apy).toBeNull();
    expect(exitScenario.profitUsd).toBeCloseTo(49_900 - 50_000, 6);
    expect(exitScenario.days).toBe(0);

    const rollScenario = scenarios[2]!;
    expect(rollScenario.apy).toBeCloseTo(0.088, 6);
    expect(rollScenario.profitUsd).toBeCloseTo(roll.destParValueUsd - entry.sizeUsd, 6);
    expect(rollScenario.days).toBeCloseTo(roll.destDaysToMaturity, 6);
  });
});

describe('buildMaturityPlan', () => {
  const market = makeMarket();
  const successor = makeMarket({
    id: '1-0xsuccessor',
    expiry: new Date(Date.now() + 220 * 86_400_000).toISOString(),
    impliedApy: 0.095,
  });
  const entry = simulateEntry({
    market,
    tokenIn: makeAsset({ address: '0xusdc', symbol: 'USDC', decimals: 6 }),
    sizeUsd: 50_000,
    quote: makeQuote(),
    gasPriceGwei: 5,
    nativePriceUsd: 2710,
  });
  const successorEntry = simulateEntry({
    market: successor,
    tokenIn: makeAsset({ address: '0xusdc', symbol: 'USDC', decimals: 6 }),
    sizeUsd: entry.valueAtMaturityUsd,
    quote: makeQuote({ outputs: [{ token: '0xpt', amount: '52000000000' }] }),
    gasPriceGwei: 5,
    nativePriceUsd: 2710,
  });
  const rollNow = simulateRoll({
    source: market,
    dest: successor,
    ptAmountUnits: '51057857520',
    quote: makeQuote({ action: 'roll-over-pt', outputs: [{ token: '0xpt', amount: '50500000000' }], effectiveApy: 0.088 }),
    notionalUsd: 49_980,
    gasPriceGwei: 5,
    nativePriceUsd: 2710,
  });

  it('prices redeeming at par as gas-only, with no swap fee or impact', () => {
    const options = buildMaturityPlan({ entry, redeemGasUsd: 1.2 });
    expect(options).toHaveLength(1);
    const redeem = options[0]!;
    expect(redeem.id).toBe('redeem');
    expect(redeem.actionCostUsd).toBeCloseTo(1.2, 6);
    expect(redeem.basis).toBe('modelled');
    expect(redeem.endValueUsd).toBeCloseTo(entry.valueAtMaturityUsd, 6);
    expect(redeem.totalDays).toBeCloseTo(entry.daysToMaturity, 6);
    // Total friction is the entry cost plus the redemption gas.
    expect(redeem.totalFrictionUsd).toBeCloseTo(entry.cost.totalUsd + 1.2, 6);
    expect(redeem.note.toLowerCase()).toContain('no amm swap');
  });

  it('treats a maturity roll as a fresh entry, not a round trip', () => {
    const options = buildMaturityPlan({ entry, successor, successorEntry, redeemGasUsd: 1.2 });
    const rollOption = options.find((o) => o.id === 'roll-at-maturity')!;
    expect(rollOption.basis).toBe('quoted');
    // Redemption gas plus the successor purchase, and nothing for the exit leg.
    expect(rollOption.actionCostUsd).toBeCloseTo(1.2 + successorEntry.cost.totalUsd, 6);
    expect(rollOption.endValueUsd).toBeCloseTo(successorEntry.valueAtMaturityUsd, 6);
    expect(rollOption.totalDays).toBeGreaterThan(entry.daysToMaturity);
    expect(rollOption.netProfitUsd).toBeCloseTo(successorEntry.valueAtMaturityUsd - entry.sizeUsd, 6);
  });

  it('includes rolling today when that quote exists', () => {
    const options = buildMaturityPlan({ entry, successor, successorEntry, rollNow, redeemGasUsd: 1.2 });
    expect(options.map((o) => o.id)).toEqual(['redeem', 'roll-at-maturity', 'roll-now']);
    const now = options[2]!;
    expect(now.actionCostUsd).toBeCloseTo(rollNow.cost.totalUsd, 6);
    expect(now.endValueUsd).toBeCloseTo(rollNow.destParValueUsd, 6);
    expect(now.note).toContain('discounted price');
  });

  it('annualises each option so different holding periods compare fairly', () => {
    const options = buildMaturityPlan({ entry, successor, successorEntry, rollNow, redeemGasUsd: 1.2 });
    for (const option of options) {
      expect(option.netApy).not.toBeNull();
      const expected = option.netProfitUsd / entry.sizeUsd / (option.totalDays / 365);
      expect(option.netApy!).toBeCloseTo(expected, 8);
      expect(option.totalFrictionBps).toBeCloseTo((option.totalFrictionUsd / entry.sizeUsd) * 10_000, 6);
    }
  });

  it('omits options it has no data for', () => {
    const options = buildMaturityPlan({ entry, successor, successorEntry: null, rollNow: null, redeemGasUsd: null });
    expect(options.map((o) => o.id)).toEqual(['redeem']);
    expect(options[0]!.actionCostUsd).toBe(0);
  });
});
