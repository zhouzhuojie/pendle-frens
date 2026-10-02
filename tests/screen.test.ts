import { describe, expect, it } from 'vitest';
import {
  HIDE_REASON_LABEL,
  candidateFor,
  screenMarkets,
  sortCandidates,
  summarizeHidden,
  type Candidate,
  type HideReason,
  type ScreenFilters,
} from '../src/lib/domain/screen';
import { scoreMarket } from '../src/lib/domain/score';
import type { Market, Settings } from '../src/lib/domain/types';
import { DEFAULT_SETTINGS } from '../src/lib/storage/store';
import { makeAsset, makeMarket } from './fixtures';

const BENCHMARK = 0.035;
const SETTINGS: Settings = { ...DEFAULT_SETTINGS, minMaturityDays: 30, minLiquidityUsd: 1_000_000 };
const FILTERS: ScreenFilters = { query: '', sort: 'score', minSpreadPct: 0, assetClass: 'all', chain: 'all', showHidden: false };

function candidate(market: Market): Candidate {
  const score = scoreMarket(market, { benchmarkPct: BENCHMARK, minLiquidityUsd: SETTINGS.minLiquidityUsd });
  return candidateFor(market, score, BENCHMARK);
}

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

const GOOD = makeMarket({
  id: '1-0xgood',
  protocol: 'Aave',
  categoryIds: ['stables'],
  impliedApy: 0.08,
  liquidityUsd: 40_000_000,
  expiry: inDays(180),
});

/** Each entry is a market that should be hidden for exactly one named reason. */
const HIDE_CASES: { reason: HideReason; market: Market; filters?: Partial<ScreenFilters> }[] = [
  { reason: 'expired', market: makeMarket({ id: '1-0x1', protocol: 'Aave', categoryIds: ['stables'], expiry: inDays(-5) }) },
  { reason: 'non-positive-rate', market: makeMarket({ id: '1-0x2', protocol: 'Aave', categoryIds: ['stables'], impliedApy: 0, expiry: inDays(180) }) },
  { reason: 'thin-liquidity', market: makeMarket({ id: '1-0x3', protocol: 'Aave', categoryIds: ['stables'], liquidityUsd: 50_000, expiry: inDays(180) }) },
  {
    reason: 'off-peg',
    market: makeMarket({
      id: '1-0x4',
      protocol: 'Aave',
      categoryIds: ['stables'],
      liquidityUsd: 40_000_000,
      expiry: inDays(180),
      accountingAsset: makeAsset({ address: '0xusdc', symbol: 'USDC', decimals: 6, priceUsd: 0.95 }),
    }),
  },
  { reason: 'maturity', market: makeMarket({ id: '1-0x6', protocol: 'Aave', categoryIds: ['stables'], liquidityUsd: 40_000_000, expiry: inDays(20) }) },
  {
    reason: 'spread',
    // 4.0% fixed vs a 3.5% benchmark = +0.5pp, under the 2pp bar.
    market: makeMarket({
      id: '1-0x7',
      protocol: 'Aave',
      categoryIds: ['stables'],
      impliedApy: 0.04,
      liquidityUsd: 40_000_000,
      expiry: inDays(180),
    }),
    filters: { minSpreadPct: 2 },
  },
  {
    reason: 'chain',
    market: makeMarket({ id: '42161-0x8', chainId: 42161, protocol: 'Aave', categoryIds: ['stables'], liquidityUsd: 40_000_000, expiry: inDays(180) }),
    filters: { chain: 1 },
  },
  {
    reason: 'asset-class',
    market: makeMarket({ id: '1-0x9', protocol: 'Aave', categoryIds: ['stables'], liquidityUsd: 40_000_000, expiry: inDays(180) }),
    filters: { assetClass: 'btc' },
  },
  { reason: 'query', market: GOOD, filters: { query: 'zzzz' } },
];

describe('screenMarkets', () => {
  it('keeps a market that clears every bar', () => {
    const result = screenMarkets([candidate(GOOD)], FILTERS, SETTINGS);
    expect(result.included).toHaveLength(1);
    expect(result.totalHidden).toBe(0);
  });

  for (const testCase of HIDE_CASES) {
    it(`attributes the "${testCase.reason}" reason`, () => {
      const filters = { ...FILTERS, ...testCase.filters };
      const result = screenMarkets([candidate(testCase.market)], filters, SETTINGS);
      // Exactly one reason, attributed to this market — no double counting.
      expect([...result.hidden.entries()]).toEqual([[testCase.reason, 1]]);
      expect(result.totalHidden).toBe(1);
      expect(result.included).toHaveLength(0);
    });
  }

  it('makes the hidden counts add up to the number of candidates', () => {
    const candidates = [candidate(GOOD), ...HIDE_CASES.map((c) => candidate(c.market))];
    const result = screenMarkets(candidates, FILTERS, SETTINGS);
    const counted = [...result.hidden.values()].reduce((a, b) => a + b, 0);
    expect(result.included.length + counted).toBe(candidates.length);
    expect(result.totalHidden).toBe(counted);
  });

  it('gives every hide reason exactly one attribution', () => {
    // The expired market also has a stale rate; it must be reported once, as
    // `expired`, not counted twice.
    const stale = makeMarket({
      id: '1-0xstale',
      protocol: 'Zzz Brand New',
      categoryIds: ['stables'],
      impliedApy: 0,
      liquidityUsd: 1000,
      expiry: inDays(-30),
    });
    const result = screenMarkets([candidate(stale)], FILTERS, SETTINGS);
    expect([...result.hidden.entries()]).toEqual([['expired', 1]]);
    expect(result.totalHidden).toBe(1);
  });

  it('reveals bar-hidden markets when showHidden is on', () => {
    const candidates = [candidate(GOOD), ...HIDE_CASES.filter((c) => !c.filters).map((c) => candidate(c.market))];
    const result = screenMarkets(candidates, { ...FILTERS, showHidden: true }, SETTINGS);
    expect(result.totalHidden).toBe(0);
    expect(result.included).toHaveLength(candidates.length);
  });

  it('still respects explicit choices when showHidden is on', () => {
    const other = makeMarket({ id: '42161-0xother', chainId: 42161, protocol: 'Aave', categoryIds: ['stables'], expiry: inDays(180) });
    const result = screenMarkets([candidate(GOOD), candidate(other)], { ...FILTERS, showHidden: true, chain: 1 }, SETTINGS);
    expect(result.included.map((c) => c.market.id)).toEqual(['1-0xgood']);
    expect(result.hidden.get('chain')).toBe(1);
  });

  it('applies the search query case-insensitively across asset and protocol', () => {
    const bySymbol = screenMarkets([candidate(GOOD)], { ...FILTERS, query: 'REUSD' }, SETTINGS);
    const byProtocol = screenMarkets([candidate(GOOD)], { ...FILTERS, query: 'aave' }, SETTINGS);
    const byName = screenMarkets([candidate(GOOD)], { ...FILTERS, query: 'pendle-lpt' }, SETTINGS);
    expect(bySymbol.included).toHaveLength(1);
    expect(byProtocol.included).toHaveLength(1);
    expect(byName.included).toHaveLength(1);
  });
});

describe('sortCandidates', () => {
  const high = candidate(makeMarket({ id: '1-0xhi', protocol: 'Aave', categoryIds: ['stables'], impliedApy: 0.12, liquidityUsd: 5_000_000, expiry: inDays(300) }));
  const deep = candidate(makeMarket({ id: '1-0xdeep', protocol: 'Aave', categoryIds: ['stables'], impliedApy: 0.06, liquidityUsd: 90_000_000, expiry: inDays(30) }));

  it('sorts by the requested key, descending', () => {
    expect(sortCandidates([deep, high], 'apy')[0]!.market.id).toBe('1-0xhi');
    expect(sortCandidates([high, deep], 'liquidity')[0]!.market.id).toBe('1-0xdeep');
    expect(sortCandidates([deep, high], 'maturity')[0]!.market.id).toBe('1-0xdeep');
    expect(sortCandidates([deep, high], 'spread')[0]!.market.id).toBe('1-0xhi');
  });
});

describe('summarizeHidden', () => {
  it('orders by count and truncates', () => {
    const hidden = new Map<HideReason, number>([
      ['expired', 412],
      ['avoided', 16],
      ['maturity', 2],
      ['spread', 1],
      ['thin-liquidity', 1],
    ]);
    const text = summarizeHidden(hidden, 3);
    expect(text).toBe('412 expired · 16 model would avoid · 2 too close to maturity · …');
  });

  it('returns an empty string when nothing is hidden', () => {
    expect(summarizeHidden(new Map())).toBe('');
  });

  it('labels every reason', () => {
    for (const reason of Object.keys(HIDE_REASON_LABEL)) {
      expect(HIDE_REASON_LABEL[reason as HideReason].length).toBeGreaterThan(0);
    }
  });
});
