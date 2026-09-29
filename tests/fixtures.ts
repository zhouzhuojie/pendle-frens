import type { AssetRef, ConvertQuote, ConvertRoute, Market, MarketInfo } from '../src/lib/domain/types';

export function makeAsset(overrides: Partial<AssetRef> = {}): AssetRef {
  return {
    id: '1-0xasset',
    chainId: 1,
    address: '0xasset',
    symbol: 'ASSET',
    name: 'Asset',
    decimals: 18,
    priceUsd: 1,
    tags: [],
    expiry: null,
    ...overrides,
  };
}

export function makeInfo(overrides: Partial<MarketInfo> = {}): MarketInfo {
  return {
    assetDescription: 'A yield bearing stablecoin.',
    riskInvolved: null,
    importantQuirks: null,
    auditedUrl: 'https://example.com/audit',
    initiatedBy: 'RE',
    conversionRate: null,
    utilizedProtocols: [{ id: 're.xyz', name: 're.xyz', url: 'https://re.xyz' }],
    withdrawalNote: null,
    ...overrides,
  };
}

export function makeMarket(overrides: Partial<Market> = {}): Market {
  return {
    id: '1-0xmarket',
    chainId: 1,
    address: '0xmarket',
    name: 'PENDLE-LPT',
    protocol: 're.xyz',
    expiry: new Date(Date.now() + 180 * 86_400_000).toISOString(),
    pt: makeAsset({ id: '1-0xpt', address: '0xpt', symbol: 'PT-reUSD-10DEC2026', decimals: 6, priceUsd: 0.979 }),
    yt: makeAsset({ id: '1-0xyt', address: '0xyt', symbol: 'YT-reUSD', decimals: 6 }),
    sy: makeAsset({ id: '1-0xsy', address: '0xsy', symbol: 'SY-reUSD', decimals: 18 }),
    accountingAsset: makeAsset({ id: '1-0xusdc', address: '0xusdc', symbol: 'USDC', decimals: 6, priceUsd: 1 }),
    underlyingAsset: makeAsset({ id: '1-0xreusd', address: '0xreusd', symbol: 'reUSD', decimals: 18, priceUsd: 1.1 }),
    basePricingAsset: null,
    categoryIds: ['stables', 'rwa'],
    isPrime: false,
    liquidityUsd: 12_000_000,
    tvlUsd: 217_000_000,
    tradingVolumeUsd: 700_000,
    impliedApy: 0.115,
    underlyingApy: 0.07,
    ptDiscount: 0.021,
    swapFeeApy: 0.0004,
    pendleApy: 0.003,
    ytFloatingApy: -0.9,
    feeRate: 0.002,
    floatingPt: 200_000_000,
    info: makeInfo(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

export function makeRoute(overrides: Partial<ConvertRoute> = {}): ConvertRoute {
  return {
    method: 'swapExactTokenForPt',
    router: '0x888888888889758f76e7103c6cbf23abbf58f946',
    pendleSwap: '0xd4f480965d2347d421f1bec7f545682e5ec2151d',
    wrapToken: '0xreusd',
    netAmountIn: '50000000000',
    syAmount: '45287471080914885256437',
    externalRouter: '0x6131b5fae19ea4f9d964eac0408e4408b66337b5',
    swapType: '1',
    limitOrderFills: 0,
    composedSelectors: [],
    requiredApprovals: [{ token: '0xusdc', amount: '50000000000' }],
    ...overrides,
  };
}

export function makeQuote(overrides: Partial<ConvertQuote> = {}): ConvertQuote {
  return {
    action: 'swap',
    outputs: [{ token: '0xpt', amount: '51057857520' }],
    priceImpact: -0.0004203,
    internalPriceImpact: -0.000318,
    externalPriceImpact: -0.000102,
    feeUsd: 20.1,
    gasUsed: '1091129',
    impliedApyBefore: 0.1150128,
    impliedApyAfter: 0.1150076,
    effectiveApy: 0.11321,
    aggregatorType: 'KYBERSWAP',
    route: makeRoute(),
    ...overrides,
  };
}
