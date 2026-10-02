import { describe, expect, it } from 'vitest';
import { buildDecisionBrief } from '../src/lib/domain/decision';
import { scoreMarket } from '../src/lib/domain/score';
import { buildProtocolFacts } from '../src/lib/domain/protocol';
import type { HistoryStats, Market, MarketScore } from '../src/lib/domain/types';
import { makeAsset, makeMarket } from './fixtures';

const BENCH = 0.035;

const steady: HistoryStats = { points: 60, mean: 0.115, min: 0.11, max: 0.12, stddev: 0.004, coverage: 1, trendPerDay: 0 };

function brief(market: Market, stats: HistoryStats | null = null, sizeUsd = 50_000, score?: MarketScore) {
  const marketScore =
    score ??
    scoreMarket(market, { benchmarkPct: BENCH, minLiquidityUsd: 1_000_000, historyStats: stats });
  return buildDecisionBrief(market, marketScore, { benchmarkPct: BENCH, historyStats: stats, sizeUsd });
}

describe('buildDecisionBrief', () => {
  it('states the rate, the term and the excess over the benchmark', () => {
    const b = brief(makeMarket());
    expect(b.headline).toContain('11.50%');
    expect(b.headline).toContain('180 days');
    expect(b.headline).toContain('+8.00pp');
    expect(b.spread).toBeCloseTo(0.08, 10);
  });

  it('shows a negative premium as a negative spread', () => {
    const b = brief(makeMarket({ impliedApy: 0.02 }));
    expect(b.headline).toContain('-1.50pp');
    expect(b.spread).toBeCloseTo(-0.015, 10);
  });

  it('works out what you pay and what you get back', () => {
    const b = brief(makeMarket());
    expect(b.payout.ptPriceUsd).toBeCloseTo(0.979, 10);
    expect(b.payout.ptReceived).toBeCloseTo(50_000 / 0.979, 6);
    expect(b.payout.valueAtMaturityUsd).toBeCloseTo(50_000 / 0.979, 6);
    expect(b.payout.profitUsd).toBeCloseTo(50_000 / 0.979 - 50_000, 6);
    expect(b.payout.markedToToday).toBe(false);
  });

  it('marks the payout to today when the accounting asset is not $1', () => {
    const market = makeMarket({
      accountingAsset: makeAsset({ address: '0xeth', symbol: 'ETH', decimals: 18, priceUsd: 2710 }),
      pt: makeAsset({ id: '1-0xpt', address: '0xpt', symbol: 'PT-ETH', decimals: 18, priceUsd: 2400 }),
    });
    const b = brief(market);
    expect(b.payout.markedToToday).toBe(true);
    expect(b.payout.valueAtMaturityUsd).toBeCloseTo((50_000 / 2400) * 2710, 6);
  });

  it('degrades cleanly when the PT price is unknown', () => {
    const market = makeMarket({ pt: makeAsset({ id: '1-0xpt', address: '0xpt', priceUsd: null }) });
    const b = brief(market);
    expect(b.payout.ptReceived).toBeNull();
    expect(b.payout.valueAtMaturityUsd).toBeNull();
    expect(b.payout.profitUsd).toBeNull();
    expect(b.payout.ptPriceUsd).toBeNull();
  });

  it('estimates the AMM fee to enter from the verified formula', () => {
    const b = brief(makeMarket(), null, 50_000);
    expect(b.entryCost.feeUsd).toBeCloseTo(0.002 * 50_000 * (180 / 365), 6);
    expect(b.entryCost.bps).toBeCloseTo(((0.002 * 50_000 * (180 / 365)) / 50_000) * 10_000, 6);
    expect(b.entryCost.formula).toContain('feeRate');
  });

  it('classifies exit liquidity by the same bars as the verdicts', () => {
    expect(brief(makeMarket({ liquidityUsd: 12_000_000 })).exit.level).toBe('deep');
    expect(brief(makeMarket({ liquidityUsd: 2_000_000 })).exit.level).toBe('workable');
    expect(brief(makeMarket({ liquidityUsd: 300_000 })).exit.level).toBe('thin');
  });

  it('argues for the trade from the data, not from boilerplate', () => {
    const b = brief(makeMarket(), steady);
    const joined = b.caseFor.join(' ');
    expect(joined).toContain('+8.00pp');
    expect(joined).toContain('USDC');
    expect(joined).toContain('steady');
    expect(joined).toContain('exit liquidity');
  });

  it('warns on thin liquidity and missing history', () => {
    const b = brief(makeMarket({ liquidityUsd: 300_000 }), null);
    const joined = b.caseAgainst.join(' ');
    expect(joined).toContain('Thin exit liquidity');
    expect(joined).toContain('No usable price history');
  });

  it('warns when the collateral is not a dollar exposure', () => {
    const market = makeMarket({ protocol: 'Some ETH protocol', categoryIds: ['eth'] });
    const b = brief(market);
    expect(b.caseAgainst.join(' ')).toContain('fixed in that asset, not in dollars');
  });

  it('warns when the accounting asset is off peg', () => {
    const market = makeMarket({
      accountingAsset: makeAsset({ address: '0xusdc', symbol: 'USDC', decimals: 6, priceUsd: 0.94 }),
    });
    expect(brief(market).caseAgainst.join(' ')).toContain('below $1');
  });

  it('warns when the rate is fading or volatile', () => {
    const fading: HistoryStats = { ...steady, stddev: 0.04, coverage: 0.3, trendPerDay: -0.0009 };
    const joined = brief(makeMarket(), fading).caseAgainst.join(' ');
    expect(joined).toContain('volatile');
    expect(joined).toContain('fading');
    expect(joined).toContain('Below the benchmark more than half');
  });

  it('names a thin protocol footprint', () => {
    const market = makeMarket({ protocol: 'Brand New', tvlUsd: 50_000 });
    const facts = buildProtocolFacts([market]);
    const score = scoreMarket(market, { benchmarkPct: BENCH, minLiquidityUsd: 1_000_000, protocolFacts: facts });
    expect(brief(market, null, 50_000, score).caseAgainst.join(' ')).toContain('Thin protocol footprint');
  });

  it('names an established footprint when the protocol is deep', () => {
    const markets = [
      makeMarket({ id: '1-a', protocol: 'Aave', tvlUsd: 80_000_000, isPrime: true }),
      makeMarket({ id: '1-b', protocol: 'Aave', tvlUsd: 80_000_000 }),
      makeMarket({ id: '42161-c', protocol: 'Aave', chainId: 42161, tvlUsd: 80_000_000 }),
    ];
    const facts = buildProtocolFacts(markets);
    const score = scoreMarket(markets[0]!, { benchmarkPct: BENCH, minLiquidityUsd: 1_000_000, protocolFacts: facts });
    const joined = brief(markets[0]!, steady, 50_000, score).caseFor.join(' ');
    expect(joined).toContain('Established footprint');
    expect(joined).toContain('Prime');
  });

  it('never lets either case list be empty', () => {
    // A market that is bad on every axis still has to render something to read.
    const awful = makeMarket({
      impliedApy: 0.01,
      liquidityUsd: 10_000,
      categoryIds: ['other'],
      protocol: 'Nobody',
      tvlUsd: 1_000,
      info: { ...makeMarket().info, riskInvolved: 'Very risky' },
    });
    const b = brief(awful, null);
    expect(b.caseFor.length).toBeGreaterThan(0);
    expect(b.caseAgainst.length).toBeGreaterThan(0);
  });
});
