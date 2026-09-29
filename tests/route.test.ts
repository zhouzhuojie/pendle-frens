import { describe, expect, it } from 'vitest';
import { PENDLE_METHOD_SELECTORS, describeRoute, deriveFee } from '../src/lib/domain/route';
import { findSuccessorMarket, describeSuccessor } from '../src/lib/domain/successor';
import { simulateEntry, simulateRoll } from '../src/lib/domain/simulate';
import type { Market } from '../src/lib/domain/types';
import { makeAsset, makeMarket, makeQuote, makeRoute } from './fixtures';

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
const USDC = makeAsset({ address: '0xusdc', symbol: 'USDC', decimals: 6, priceUsd: 1 });

/* -------------------------------- successor ------------------------------- */

describe('findSuccessorMarket', () => {
  const source = makeMarket({
    id: '1-0xreusd-dec',
    expiry: inDays(72),
    underlyingAsset: makeAsset({ id: '1-0xreusd', address: '0xreusd', symbol: 'reUSD' }),
    liquidityUsd: 12_000_000,
  });

  it('picks the nearest later expiry of the same underlying', () => {
    const soon = makeMarket({ id: '1-0xreusd-mar', expiry: inDays(160), underlyingAsset: source.underlyingAsset, liquidityUsd: 8_000_000 });
    const later = makeMarket({ id: '1-0xreusd-jun', expiry: inDays(250), underlyingAsset: source.underlyingAsset, liquidityUsd: 9_000_000 });
    const older = makeMarket({ id: '1-0xreusd-old', expiry: inDays(10), underlyingAsset: source.underlyingAsset, liquidityUsd: 9_000_000 });

    const match = findSuccessorMarket(source, [source, later, soon, older]);
    expect(match?.market.id).toBe('1-0xreusd-mar');
    expect(match?.matchedOn).toBe('underlying');
    expect(match?.daysAfterSource).toBeGreaterThan(80);
  });

  it('skips illiquid later expiries when a liquid one exists', () => {
    const thin = makeMarket({ id: '1-0xthin', expiry: inDays(100), underlyingAsset: source.underlyingAsset, liquidityUsd: 5_000 });
    const liquid = makeMarket({ id: '1-0xliquid', expiry: inDays(200), underlyingAsset: source.underlyingAsset, liquidityUsd: 4_000_000 });
    const match = findSuccessorMarket(source, [thin, liquid], { minLiquidityUsd: 1_000_000 });
    expect(match?.market.id).toBe('1-0xliquid');
  });

  it('falls back to the nearest expiry when nothing is liquid enough', () => {
    const thin = makeMarket({ id: '1-0xthin', expiry: inDays(100), underlyingAsset: source.underlyingAsset, liquidityUsd: 5_000 });
    const match = findSuccessorMarket(source, [thin], { minLiquidityUsd: 1_000_000 });
    expect(match?.market.id).toBe('1-0xthin');
  });

  it('falls back to same collateral plus symbol when the underlying differs', () => {
    const rolled = makeMarket({
      id: '1-0xwrapped',
      expiry: inDays(200),
      underlyingAsset: makeAsset({ address: '0xother', symbol: 'reUSD' }),
      accountingAsset: source.accountingAsset,
      liquidityUsd: 5_000_000,
    });
    const match = findSuccessorMarket(source, [rolled]);
    expect(match?.matchedOn).toBe('collateral');
  });

  it('returns null when there is no later expiry on the same chain', () => {
    const otherChain = makeMarket({ id: '42161-0xreusd', chainId: 42161, expiry: inDays(300), underlyingAsset: source.underlyingAsset });
    expect(findSuccessorMarket(source, [otherChain, source])).toBeNull();
    expect(findSuccessorMarket(source, [])).toBeNull();
    expect(findSuccessorMarket(makeMarket({ expiry: inDays(-1) }), [otherChain])).toBeNull();
  });

  it('describes the match in plain language', () => {
    const later = makeMarket({ id: '1-0xlater', expiry: inDays(200), underlyingAsset: source.underlyingAsset, liquidityUsd: 5_000_000 });
    const match = findSuccessorMarket(source, [later])!;
    expect(describeSuccessor(source, match)).toContain('same underlying (reUSD)');
  });
});

/* ---------------------------------- fee ----------------------------------- */

describe('deriveFee', () => {
  const market = makeMarket({ feeRate: 0.002049, expiry: inDays(72) });

  it('reconstructs the fee as feeRate × notional × days/365', () => {
    const breakdown = deriveFee({ quote: makeQuote({ feeUsd: 20.07 }), market, destMarket: null, notionalUsd: 50_000, destNotionalUsd: 50_000 });
    // 0.002049 × 50000 × 71.6/365 ≈ 20.1
    expect(breakdown.derivedUsd).toBeCloseTo(20.1, 0);
    expect(breakdown.legs).toHaveLength(1);
    expect(breakdown.legs[0]!.feeRateBps).toBeCloseTo(20.49, 2);
    expect(breakdown.bpsOfNotional).toBeCloseTo(4.01, 1);
    // The reconstruction should explain the SDK's number within a few cents.
    expect(Math.abs(breakdown.deltaUsd!)).toBeLessThan(0.5);
    expect(breakdown.formula).toContain('daysToMaturity');
  });

  it('adds a second AMM leg for a roll-over', () => {
    const dest = makeMarket({ id: '1-0xdest', feeRate: 0.001693, expiry: inDays(149) });
    const breakdown = deriveFee({ quote: makeQuote({ feeUsd: 30 }), market, destMarket: dest, notionalUsd: 50_000, destNotionalUsd: 50_500 });
    expect(breakdown.legs).toHaveLength(2);
    // Source leg: 20.49 bps × $50,000 × 71.6/365 ≈ $20.1
    // Destination: 16.93 bps × $50,500 × 148.6/365 ≈ $34.8
    expect(breakdown.legs[0]!.feeUsd).toBeCloseTo(20.1, 0);
    expect(breakdown.legs[1]!.feeUsd).toBeCloseTo(34.8, 0);
    expect(breakdown.derivedUsd).toBeCloseTo(54.9, 0);
    // Two AMM legs is why a roll-over costs more than an entry of the same size.
    expect(breakdown.derivedUsd!).toBeGreaterThan(breakdown.legs[0]!.feeUsd * 2);
  });

  it('reports a null bps when there is no notional', () => {
    const breakdown = deriveFee({ quote: makeQuote({ feeUsd: null }), market, destMarket: null, notionalUsd: 0, destNotionalUsd: 0 });
    expect(breakdown.bpsOfNotional).toBeNull();
    expect(breakdown.deltaUsd).toBeNull();
  });
});

/* --------------------------------- route ---------------------------------- */

describe('describeRoute', () => {
  const market = makeMarket({ expiry: inDays(72) });

  it('names the searchable Pendle router selectors', () => {
    expect(PENDLE_METHOD_SELECTORS['0x594a88cc']).toBe('swapExactPtForToken');
    expect(PENDLE_METHOD_SELECTORS['0xc81f847a']).toBe('swapExactTokenForPt');
  });

  it('splits an entry into a token→SY leg and an AMM leg', () => {
    const breakdown = describeRoute({
      quote: makeQuote(),
      market,
      counterAsset: USDC,
      notionalUsd: 50_000,
      gasPriceGwei: 5,
      nativePriceUsd: 2710,
    });
    expect(breakdown.kind).toBe('entry');
    expect(breakdown.legs).toHaveLength(2);
    expect(breakdown.legs[0]!.venue).toContain('KYBERSWAP');
    expect(breakdown.legs[1]!.venue).toBe('Pendle AMM');
    expect(breakdown.legs[1]!.feeUsd).toBeCloseTo(20.1, 6);
    expect(breakdown.legs[0]!.impactBps).toBeCloseTo(-1.02, 2);
    expect(breakdown.legs[1]!.impactBps).toBeCloseTo(-3.18, 2);
    // Impact in USD is scaled by the notional.
    expect(breakdown.impact.internalUsd).toBeCloseTo(15.9, 1);
    expect(breakdown.impact.totalBps).toBeCloseTo(-4.203, 5);
    expect(breakdown.limitOrderFills).toBe(0);
  });

  it('marks a direct mint instead of an external swap', () => {
    const breakdown = describeRoute({
      quote: makeQuote({ aggregatorType: 'VOID', externalPriceImpact: 0, route: makeRoute({ swapType: '0', externalRouter: null }) }),
      market,
      counterAsset: USDC,
      notionalUsd: 50_000,
      gasPriceGwei: 5,
      nativePriceUsd: 2710,
    });
    expect(breakdown.usesExternalSwap).toBe(false);
    expect(breakdown.legs[0]!.venue).toBe('direct mint');
    expect(breakdown.notes.some((note) => note.includes('no external swap'))).toBe(true);
  });

  it('flags bundled limit-order fills', () => {
    const breakdown = describeRoute({
      quote: makeQuote({ route: makeRoute({ limitOrderFills: 2 }) }),
      market,
      counterAsset: USDC,
      notionalUsd: 50_000,
      gasPriceGwei: 5,
      nativePriceUsd: 2710,
    });
    expect(breakdown.limitOrderFills).toBe(2);
    expect(breakdown.notes.some((note) => note.includes('limit-order fill'))).toBe(true);
  });

  it('names the two steps of a roll-over', () => {
    const dest = makeMarket({ id: '1-0xdest', expiry: inDays(149) });
    const breakdown = describeRoute({
      quote: makeQuote({
        action: 'roll-over-pt',
        route: makeRoute({ method: 'callAndReflect', composedSelectors: ['0x594a88cc', '0xc81f847a'] }),
      }),
      market,
      destMarket: dest,
      counterAsset: market.accountingAsset,
      notionalUsd: 50_000,
      destNotionalUsd: 50_500,
      gasPriceGwei: 5,
      nativePriceUsd: 2710,
    });
    expect(breakdown.kind).toBe('roll');
    expect(breakdown.steps.map((s) => s.method)).toEqual(['swapExactPtForToken', 'swapExactTokenForPt']);
    expect(breakdown.legs).toHaveLength(2);
    expect(breakdown.legs[1]!.venue).toContain(dest.name);
    expect(breakdown.fee.legs).toHaveLength(2);
    expect(breakdown.notes.some((note) => note.includes('two AMM legs'))).toBe(true);
  });

  it('builds exit legs in the reverse order', () => {
    const breakdown = describeRoute({
      quote: makeQuote({ outputs: [{ token: '0xusdc', amount: '49936400000' }], route: makeRoute({ method: 'swapExactPtForToken' }) }),
      market,
      counterAsset: USDC,
      notionalUsd: 49_980,
      gasPriceGwei: 5,
      nativePriceUsd: 2710,
    });
    expect(breakdown.kind).toBe('exit');
    expect(breakdown.legs[0]!.venue).toBe('Pendle AMM');
    expect(breakdown.legs[1]!.venue).toContain('KYBERSWAP');
    expect(breakdown.notes.some((note) => note.includes('intermediate SY amount'))).toBe(true);
  });

  it('survives a quote with no route data at all', () => {
    const sparse = makeQuote({
      route: makeRoute({ method: null, router: null, syAmount: null, netAmountIn: null, externalRouter: null, swapType: null }),
      internalPriceImpact: null,
      externalPriceImpact: null,
      priceImpact: null,
      feeUsd: null,
      gasUsed: null,
    });
    const breakdown = describeRoute({
      quote: sparse,
      market,
      counterAsset: USDC,
      notionalUsd: 50_000,
      gasPriceGwei: 5,
      nativePriceUsd: null,
    });
    expect(breakdown.legs).toHaveLength(2);
    expect(breakdown.impact.totalUsd).toBeNull();
    expect(breakdown.gas.usd).toBeNull();
  });
});

/* --------------------------- route from real quotes ----------------------- */

describe('route built from the simulator', () => {
  it('attaches the raw quote to each simulation so the route can be shown', () => {
    const market = makeMarket();
    const entry = simulateEntry({
      market,
      tokenIn: USDC,
      sizeUsd: 50_000,
      quote: makeQuote(),
      gasPriceGwei: 5,
      nativePriceUsd: 2710,
    });
    const roll = simulateRoll({
      source: market,
      dest: makeMarket({ id: '1-0xdest', expiry: inDays(149) }),
      ptAmountUnits: '51057857520',
      quote: makeQuote({ action: 'roll-over-pt', outputs: [{ token: '0xpt', amount: '50412700000' }] }),
      notionalUsd: 49_980,
      gasPriceGwei: 5,
      nativePriceUsd: 2710,
    });
    expect(entry.quote.route.method).toBe('swapExactTokenForPt');
    expect(roll.quote.action).toBe('roll-over-pt');
    expect(roll.destParValueUsd).toBeGreaterThan(0);
    const breakdown = describeRoute({
      quote: roll.quote,
      market: market as Market,
      destMarket: makeMarket({ id: '1-0xdest', expiry: inDays(149) }),
      counterAsset: market.accountingAsset,
      notionalUsd: roll.notionalUsd,
      destNotionalUsd: roll.destPtOut * (roll.destPtMarketPriceUsd ?? roll.destPtPriceUsd),
      gasPriceGwei: 5,
      nativePriceUsd: 2710,
    });
    expect(breakdown.fee.legs).toHaveLength(2);
  });
});
