import { describe, expect, it } from 'vitest';
import {
  type RawMarketV1,
  type RawMarketV2,
  mergeMarkets,
  normalizeAsset,
  normalizeHistory,
  normalizeLimitOrderBook,
  normalizeLiveRate,
  normalizeLoopOptions,
  normalizeMarket,
} from '../src/lib/api/normalize';

const rawV1: RawMarketV1 = {
  id: '1-0xmarket',
  chainId: 1,
  address: '0xMARKET',
  name: 'PENDLE-LPT',
  protocol: 're.xyz',
  expiry: '2026-12-10T00:00:00.000Z',
  pt: {
    id: '1-0xpt',
    chainId: 1,
    address: '0xPT',
    symbol: 'PT-reUSD-10DEC2026',
    decimals: 6,
    price: { usd: 0.9788 },
    expiry: '2026-12-10T00:00:00.000Z',
    types: ['PT'],
  },
  yt: { address: '0xYT', symbol: 'YT-reUSD', decimals: 6 },
  sy: { address: '0xSY', symbol: 'SY-reUSD', decimals: 18 },
  accountingAsset: { address: '0xUSDC', symbol: 'USDC', decimals: 6, price: { usd: 0.9999 } },
  underlyingAsset: { address: '0xreUSD', symbol: 'reUSD', decimals: 18, price: { usd: 1.1038 } },
  basePricingAsset: { address: '0xUSDC', symbol: 'USDC', decimals: 6 },
  categoryIds: ['stables', 'rwa', 'rexyz'],
  liquidity: { usd: 12_148_962 },
  tradingVolume: 756_211,
  impliedApy: 0.115,
  underlyingApy: 0.0699,
  ptDiscount: 0.0211,
  swapFeeApy: 0.00043,
  pendleApy: 0.0031,
  ytFloatingApy: -0.92,
  timestamp: '2026-09-29T07:26:00.000Z',
  extendedInfo: { feeRate: 0.00204, floatingPt: 209_380_732.9 },
};

const rawV2: RawMarketV2 = {
  chainId: 1,
  address: '0xmarket',
  isPrime: false,
  isVolatile: false,
  marketType: 'discrete_yield',
  icon: 'https://storage.googleapis.com/logo.svg',
  points: [{ key: 'Asseto', type: 'multiplier', pendleAsset: 'basic', value: 40, perDollarLp: null }],
  lpApyBreakdown: {
    categories: [
      { label: 'LP Rewards', apy: 0.21, items: [{ id: 'PENDLE', apy: 0.21, tags: ['INCENTIVE', 'BOOSTABLE'] }] },
    ],
  },
  ytApyBreakdown: {
    categories: [{ label: 'Protocol Yield', apy: 0.117, items: [{ id: '1-0xsy', apy: 0.117, tags: ['INTEREST', 'AUTO'] }] }],
  },
  pendleEmission: { totalIncentive: 405.6, tvlIncentive: 3.9, feeIncentive: 1.1, discretionaryIncentive: 400, limitOrderIncentive: 0.5 },
  limitOrderIncentive: { impliedApy: 0.164, long: { minApy: 0.16, maxApy: 0.168 }, short: { minApy: 0.16, maxApy: 0.168 } },
  externalProtocols: {
    pt: [
      {
        protocol: { id: 'morpho', name: 'Morpho', category: 'money market', url: 'https://app.morpho.org' },
        subtitle: 'USDC',
        liquidity: 12_030_288,
        borrowApy: 0.0888,
        maxLtv: 0.915,
        maxLoopingApy: 0.337,
      },
    ],
  },
  marketInfo: {
    assetDescription: '<p>reUSD is a <b>stable</b> token</p>',
    riskInvolved: '<p>Can go negative</p>',
    auditedUrl: '',
    utilizedProtocols: [{ id: 're.xyz', name: 're.xyz', url: 'https://re.xyz' }],
    conversionRate: { rate: 1.1038, fromUnit: 'reUSD', toUnit: 'USDC' },
    withdrawal: { description: '<p>Wait several days</p>' },
  },
  details: {
    liquidity: 12_148_962,
    totalTvl: 217_109_331,
    tradingVolume: 756_211,
    impliedApy: 0.115,
    underlyingApy: 0.0699,
    feeRate: 0.00204,
    yieldRange: { min: 0.09, max: 0.28 },
    ptRoi: 0.0289,
    ytRoi: -0.288,
  },
};

describe('normalizeAsset', () => {
  it('lowercases addresses and reads nested prices', () => {
    const asset = normalizeAsset(rawV1.pt, 1);
    expect(asset).not.toBeNull();
    expect(asset!.address).toBe('0xpt');
    expect(asset!.decimals).toBe(6);
    expect(asset!.priceUsd).toBeCloseTo(0.9788, 6);
    expect(asset!.tags).toEqual(['PT']);
  });

  it('accepts a bare numeric price', () => {
    const asset = normalizeAsset({ address: '0xabc', price: 1.5, decimals: 18 }, 1);
    expect(asset!.priceUsd).toBe(1.5);
  });

  it('defaults decimals to 18 and returns null without an address', () => {
    expect(normalizeAsset({ address: '0xabc' }, 1)!.decimals).toBe(18);
    expect(normalizeAsset(undefined, 1)).toBeNull();
  });
});

describe('normalizeMarket', () => {
  const market = normalizeMarket(rawV1, rawV2);

  it('merges v1 asset data with v2 risk info', () => {
    expect(market).not.toBeNull();
    expect(market!.id).toBe('1-0xmarket');
    expect(market!.address).toBe('0xmarket');
    expect(market!.pt.decimals).toBe(6);
    expect(market!.accountingAsset.symbol).toBe('USDC');
    expect(market!.underlyingAsset.symbol).toBe('reUSD');
  });

  it('prefers v1 numbers and fills TVL from v2', () => {
    expect(market!.liquidityUsd).toBeCloseTo(12_148_962, 2);
    expect(market!.tvlUsd).toBeCloseTo(217_109_331, 2);
    expect(market!.impliedApy).toBeCloseTo(0.115, 6);
    expect(market!.feeRate).toBeCloseTo(0.00204, 8);
    expect(market!.floatingPt).toBeCloseTo(209_380_732.9, 1);
  });

  it('strips HTML from risk notes and keeps structured fields', () => {
    expect(market!.info.assetDescription).toBe('reUSD is a stable token');
    expect(market!.info.riskInvolved).toBe('Can go negative');
    expect(market!.info.auditedUrl).toBeNull();
    expect(market!.info.utilizedProtocols).toHaveLength(1);
    expect(market!.info.conversionRate).toContain('USDC');
    expect(market!.info.withdrawalNote).toBe('Wait several days');
  });

  it('carries the yield-source, reward and looping fields from the v2 payload', () => {
    expect(market!.isVolatile).toBe(false);
    expect(market!.marketType).toBe('discrete_yield');
    expect(market!.icon).toContain('storage.googleapis.com');
    expect(market!.points).toHaveLength(1);
    expect(market!.points[0]!.key).toBe('Asseto');
    expect(market!.ytBreakdown!.categories[0]!.label).toBe('Protocol Yield');
    expect(market!.lpBreakdown!.categories[0]!.apy).toBeCloseTo(0.21, 6);
    expect(market!.emissions!.totalIncentive).toBeCloseTo(405.6, 1);
    expect(market!.limitOrderIncentive!.impliedApy).toBeCloseTo(0.164, 6);
    expect(market!.yieldRange).toEqual({ min: 0.09, max: 0.28 });
    expect(market!.externalProtocols[0]!.name).toBe('Morpho');
    expect(market!.externalProtocols[0]!.debtSymbol).toBe('USDC');
    expect(market!.externalProtocols[0]!.maxLoopingApy).toBeCloseTo(0.337, 6);
    expect(market!.ptRoi).toBeCloseTo(0.0289, 6);
  });

  it('leaves the new fields empty when the payload omits them', () => {
    const bare = normalizeMarket(rawV1, { chainId: 1, address: '0xmarket' });
    expect(bare!.points).toEqual([]);
    expect(bare!.lpBreakdown).toBeNull();
    expect(bare!.emissions).toBeNull();
    expect(bare!.yieldRange).toBeNull();
    expect(bare!.externalProtocols).toEqual([]);
    expect(bare!.isVolatile).toBe(false);
  });

  it('returns null when required assets are missing', () => {
    expect(normalizeMarket({ address: '0xabc', chainId: 1 }, null)).toBeNull();
  });

  it('derives a discount from PT price when the field is absent', () => {
    const derived = normalizeMarket({ ...rawV1, ptDiscount: undefined }, null);
    expect(derived!.ptDiscount).toBeCloseTo(1 - 0.9788, 8);
  });
});

describe('mergeMarkets', () => {
  it('deduplicates by id and attaches v2 data by key', () => {
    const v2 = new Map([['1-0xmarket', rawV2]]);
    const merged = mergeMarkets([rawV1, { ...rawV1, address: '0xother' }], v2);
    expect(merged).toHaveLength(2);
    expect(merged[0]!.tvlUsd).toBeCloseTo(217_109_331, 2);
    expect(merged[1]!.tvlUsd).toBeCloseTo(12_148_962, 2);
  });
});

describe('normalizeHistory', () => {
  it('maps and filters malformed points', () => {
    const points = normalizeHistory({
      results: [
        { timestamp: '2026-09-29T07:00:00.000Z', impliedApy: 0.11, ptPrice: 0.979, totalTvl: 100, underlyingApy: 0.07 },
        { timestamp: '', impliedApy: 0.5 },
        { timestamp: '2026-09-29T08:00:00.000Z', impliedApy: null },
      ],
    });
    expect(points).toHaveLength(2);
    expect(points[0]!.impliedApy).toBeCloseTo(0.11, 6);
    expect(points[1]!.impliedApy).toBeNull();
  });
});

describe('normalizeLimitOrderBook', () => {
  it('keeps rate levels and raw size strings untouched', () => {
    const book = normalizeLimitOrderBook({
      longYieldEntries: [{ impliedApy: 0.091, limitOrderSize: '91779259', ammSize: '0' }],
      shortYieldEntries: [{ impliedApy: 0.092, limitOrderSize: '0', ammSize: '9361037507029135851519' }],
    });
    expect(book.long).toHaveLength(1);
    expect(book.long[0]!.limitOrderSize).toBe('91779259');
    expect(book.short[0]!.ammSize).toBe('9361037507029135851519');
  });

  it('returns empty sides for a missing payload', () => {
    expect(normalizeLimitOrderBook({})).toEqual({ long: [], short: [] });
  });
});

describe('normalizeLoopOptions', () => {
  const single = {
    options: [
      {
        chainId: 1,
        protocol: 'Morpho',
        moneyMarketName: 'Morpho',
        moneyMarketAddress: '0xMM',
        debtSymbol: 'USDC',
        debtDecimals: 6,
        data: {
          lltv: 0.915,
          borrowApy: 0.047,
          borrowApy7dAvg: 0.0486,
          maxLeverage: 8.89,
          liquidityUsd: 98_874,
          maxApy: 0.0867,
          reference: { positionUsd: 50_000, leverage: 8.89, fixedApy: 0.084, borrowApy: 0.0837 },
        },
        risks: {
          overall: { label: 'Overall Medium Risk', level: 'low' },
          items: [{ name: 'PT Price', status: { label: 'No Risk', level: 'none' }, summary: 'Linear', detail: { rationale: 'Because.' } }],
          ptOracleType: 'linear',
          debtOracleType: 'marketPrice',
        },
      },
    ],
  };

  it('reads the single-PT response and its risk panel', () => {
    const parsed = normalizeLoopOptions(single);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.moneyMarketAddress).toBe('0xmm');
    expect(parsed[0]!.maxLeverage).toBeCloseTo(8.89, 2);
    expect(parsed[0]!.reference!.leverage).toBeCloseTo(8.89, 2);
    expect(parsed[0]!.risks!.overallLevel).toBe('low');
    expect(parsed[0]!.risks!.items[0]!.level).toBe('none');
    expect(parsed[0]!.risks!.items[0]!.rationale).toBe('Because.');
  });

  it('reads the chain-list shape too', () => {
    expect(normalizeLoopOptions([{ ptAddress: '0xpt', info: single }])).toHaveLength(1);
  });

  it('returns nothing for an unknown payload', () => {
    expect(normalizeLoopOptions(null)).toEqual([]);
  });
});

describe('normalizeLiveRate', () => {
  it('maps the spot rates', () => {
    const rate = normalizeLiveRate({ underlyingTokenToPtRate: 1.4096, ptToUnderlyingTokenRate: 0.0007, impliedApy: 0.1614 });
    expect(rate.impliedApy).toBeCloseTo(0.1614, 6);
    expect(rate.ptPerUnderlying).toBeCloseTo(1.4096, 6);
    expect(rate.underlyingPerPt).toBeCloseTo(0.0007, 6);
  });
});
