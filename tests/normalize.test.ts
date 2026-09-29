import { describe, expect, it } from 'vitest';
import {
  type RawMarketV1,
  type RawMarketV2,
  mergeMarkets,
  normalizeAsset,
  normalizeHistory,
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
