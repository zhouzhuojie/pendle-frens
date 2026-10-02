/**
 * Raw Pendle API payloads -> normalized domain types.
 *
 * Kept separate from the HTTP layer so it can be unit tested against captured
 * fixtures and so an API field rename only breaks one file.
 */

import type {
  ApyBreakdown,
  ApyCategory,
  ApyItem,
  AssetRef,
  BookLevel,
  ExternalProtocol,
  HistoryPoint,
  LimitOrderBook,
  LimitOrderIncentive,
  LiveRate,
  LoopOption,
  LoopReference,
  LoopRisk,
  LoopRiskItem,
  Market,
  MarketInfo,
  PendleEmission,
  PointProgram,
  ProtocolRef,
  RiskLevel,
  YieldRange,
} from '../domain/types';
import { stripHtml } from '../util/text';

/* ------------------------------- raw shapes ------------------------------ */

export interface RawAsset {
  id?: string;
  chainId?: number;
  address?: string;
  symbol?: string;
  name?: string;
  decimals?: number;
  price?: { usd?: number } | number | null;
  tags?: string[];
  types?: string[];
  expiry?: string | null;
}

export interface RawMarketV1 {
  id?: string;
  chainId?: number;
  address?: string;
  name?: string;
  protocol?: string;
  expiry?: string;
  pt?: RawAsset;
  yt?: RawAsset;
  sy?: RawAsset;
  accountingAsset?: RawAsset;
  underlyingAsset?: RawAsset;
  basePricingAsset?: RawAsset;
  categoryIds?: string[];
  liquidity?: { usd?: number } | number | null;
  tradingVolume?: { usd?: number } | number | null;
  underlyingApy?: number;
  impliedApy?: number;
  ptDiscount?: number;
  swapFeeApy?: number;
  pendleApy?: number;
  ytFloatingApy?: number;
  ptRoi?: number;
  timestamp?: string;
  extendedInfo?: {
    feeRate?: number;
    floatingPt?: number;
    pyUnit?: string;
    ptEqualsPyUnit?: boolean;
  } | null;
}

export interface RawMarketV2 {
  chainId?: number;
  address?: string;
  isPrime?: boolean;
  timestamp?: string;
  icon?: string | null;
  isVolatile?: boolean;
  marketType?: string | null;
  points?: unknown[];
  lpApyBreakdown?: unknown;
  ytApyBreakdown?: unknown;
  underlyingRewardApyBreakdown?: unknown;
  pendleEmission?: unknown;
  limitOrderIncentive?: unknown;
  externalProtocols?: unknown;
  marketInfo?: Record<string, unknown> | null;
  details?: {
    liquidity?: number;
    totalTvl?: number;
    tradingVolume?: number;
    impliedApy?: number;
    underlyingApy?: number;
    swapFeeApy?: number;
    pendleApy?: number;
    ytFloatingApy?: number;
    feeRate?: number;
    yieldRange?: unknown;
    ptRoi?: number;
    ytRoi?: number;
  } | null;
}

export interface RawHistoryResponse {
  results?: {
    timestamp?: string;
    impliedApy?: number | null;
    ptPrice?: number | null;
    ytPrice?: number | null;
    lpPrice?: number | null;
    totalTvl?: number | null;
    underlyingApy?: number | null;
  }[];
}

export interface RawOrderBook {
  longYieldEntries?: unknown[];
  shortYieldEntries?: unknown[];
}

export interface RawSwappingPrices {
  underlyingTokenToPtRate?: number | null;
  ptToUnderlyingTokenRate?: number | null;
  impliedApy?: number | null;
}

/* --------------------------------- helpers ------------------------------- */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const num = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const numOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const str = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value : null);

/** API objects are sometimes `{ usd: n }`, sometimes a bare number. */
const usdOf = (value: unknown): number => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (isRecord(value)) return num(value.usd, 0);
  return 0;
};

const lower = (address: string | undefined): string => (address ?? '').toLowerCase();

export function assetId(chainId: number, address: string): string {
  return `${chainId}-${lower(address)}`;
}

export function normalizeAsset(raw: RawAsset | undefined | null, chainId: number, fallbackSymbol = '—'): AssetRef | null {
  if (!raw || !raw.address) return null;
  const priceRaw = raw.price;
  const priceUsd = typeof priceRaw === 'number' ? priceRaw : isRecord(priceRaw) ? numOrNull(priceRaw.usd) : null;
  return {
    id: raw.id ?? assetId(raw.chainId ?? chainId, raw.address),
    chainId: raw.chainId ?? chainId,
    address: lower(raw.address),
    symbol: raw.symbol ?? fallbackSymbol,
    name: raw.name ?? raw.symbol ?? fallbackSymbol,
    decimals: Number.isInteger(raw.decimals) ? (raw.decimals as number) : 18,
    priceUsd,
    tags: raw.tags ?? raw.types ?? [],
    expiry: raw.expiry && raw.expiry !== '' ? raw.expiry : null,
  };
}

function normalizeMarketInfo(raw: Record<string, unknown> | null | undefined): MarketInfo {
  if (!raw) {
    return {
      assetDescription: null,
      riskInvolved: null,
      importantQuirks: null,
      auditedUrl: null,
      initiatedBy: null,
      conversionRate: null,
      utilizedProtocols: [],
      withdrawalNote: null,
    };
  }
  const protocols: ProtocolRef[] = Array.isArray(raw.utilizedProtocols)
    ? raw.utilizedProtocols
        .filter(isRecord)
        .map((p) => ({
          id: String(p.id ?? p.name ?? ''),
          name: String(p.name ?? p.id ?? ''),
          url: String(p.url ?? ''),
        }))
        .filter((p) => p.name !== '')
    : [];

  const conversion = isRecord(raw.conversionRate) ? raw.conversionRate : null;
  const withdrawal = isRecord(raw.withdrawal) ? raw.withdrawal : null;

  return {
    assetDescription: stripHtml(str(raw.assetDescription)),
    riskInvolved: stripHtml(str(raw.riskInvolved)),
    importantQuirks: stripHtml(str(raw.importantQuirks)),
    auditedUrl: str(raw.auditedUrl),
    initiatedBy: str(raw.initiatedBy),
    conversionRate: conversion
      ? `${num(conversion.rate, 1)} ${str(conversion.fromUnit) ?? '?'} → ${str(conversion.toUnit) ?? '?'}`
      : null,
    utilizedProtocols: protocols,
    withdrawalNote: withdrawal ? stripHtml(str(withdrawal.description)) : null,
  };
}

/* --------------------- yield sources, rewards, looping ------------------- */

function normalizeApyBreakdown(raw: unknown): ApyBreakdown | null {
  if (!isRecord(raw)) return null;
  const rawCategories = Array.isArray(raw.categories) ? raw.categories : [];
  const categories: ApyCategory[] = rawCategories
    .filter(isRecord)
    .map((category) => {
      const rawItems = Array.isArray(category.items) ? category.items : [];
      const items: ApyItem[] = rawItems
        .filter(isRecord)
        .map((item) => ({
          id: String(item.id ?? ''),
          apy: num(item.apy),
          tags: Array.isArray(item.tags) ? item.tags.filter((t): t is string => typeof t === 'string') : [],
          source: str(item.source),
        }));
      return { label: String(category.label ?? ''), apy: num(category.apy), items };
    })
    .filter((category) => category.label !== '');
  return categories.length > 0 ? { categories } : null;
}

function normalizePoints(raw: unknown): PointProgram[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(isRecord)
    .map((point) => ({
      key: String(point.key ?? ''),
      type: String(point.type ?? 'multiplier'),
      pendleAsset: String(point.pendleAsset ?? 'basic'),
      value: num(point.value),
      perDollarLp: typeof point.perDollarLp === 'boolean' ? point.perDollarLp : null,
    }))
    .filter((point) => point.key !== '');
}

function normalizeEmission(raw: unknown): PendleEmission | null {
  if (!isRecord(raw)) return null;
  const emission: PendleEmission = {
    totalIncentive: num(raw.totalIncentive),
    tvlIncentive: num(raw.tvlIncentive),
    feeIncentive: num(raw.feeIncentive),
    discretionaryIncentive: num(raw.discretionaryIncentive),
    limitOrderIncentive: num(raw.limitOrderIncentive),
  };
  const total =
    emission.totalIncentive +
    emission.tvlIncentive +
    emission.feeIncentive +
    emission.discretionaryIncentive +
    emission.limitOrderIncentive;
  return total > 0 ? emission : null;
}

function normalizeLimitOrderIncentive(raw: unknown): LimitOrderIncentive | null {
  if (!isRecord(raw)) return null;
  const long = isRecord(raw.long) ? raw.long : null;
  const short = isRecord(raw.short) ? raw.short : null;
  const impliedApy = num(raw.impliedApy);
  // A present-but-zero incentive means the market has no maker programme; do
  // not offer the reader a 0.00% "incentive".
  if (impliedApy <= 0) return null;
  return {
    impliedApy,
    longMinApy: long ? numOrNull(long.minApy) : null,
    longMaxApy: long ? numOrNull(long.maxApy) : null,
    shortMinApy: short ? numOrNull(short.minApy) : null,
    shortMaxApy: short ? numOrNull(short.maxApy) : null,
  };
}

function normalizeYieldRange(raw: unknown): YieldRange | null {
  if (!isRecord(raw)) return null;
  const min = numOrNull(raw.min);
  const max = numOrNull(raw.max);
  return min === null || max === null ? null : { min, max };
}

/** The `pt` group of the provider's external-protocol object (looping venues). */
function normalizeExternalProtocols(raw: unknown): ExternalProtocol[] {
  if (!isRecord(raw)) return [];
  const pt = Array.isArray(raw.pt) ? raw.pt : [];
  return pt
    .filter(isRecord)
    .map((entry) => {
      const protocol = isRecord(entry.protocol) ? entry.protocol : {};
      return {
        id: String(protocol.id ?? protocol.name ?? ''),
        name: String(protocol.name ?? protocol.id ?? ''),
        category: str(protocol.category),
        url: str(protocol.url),
        debtSymbol: str(entry.subtitle),
        liquidityUsd: num(entry.liquidity),
        borrowApy: numOrNull(entry.borrowApy),
        maxLtv: numOrNull(entry.maxLtv),
        maxLoopingApy: numOrNull(entry.maxLoopingApy),
      };
    })
    .filter((protocol) => protocol.name !== '');
}

function normalizeRiskLevel(value: unknown): RiskLevel {
  const level = typeof value === 'string' ? value.toLowerCase() : '';
  return level === 'none' || level === 'low' || level === 'medium' || level === 'high' ? level : 'unknown';
}

function normalizeLoopRisk(raw: unknown): LoopRisk | null {
  if (!isRecord(raw)) return null;
  const overall = isRecord(raw.overall) ? raw.overall : {};
  const rawItems = Array.isArray(raw.items) ? raw.items : [];
  const items: LoopRiskItem[] = rawItems.filter(isRecord).map((item) => {
    const status = isRecord(item.status) ? item.status : {};
    const detail = isRecord(item.detail) ? item.detail : {};
    return {
      name: String(item.name ?? ''),
      label: String(status.label ?? ''),
      level: normalizeRiskLevel(status.level),
      summary: String(item.summary ?? ''),
      rationale: str(detail.rationale),
    };
  });
  return {
    overallLabel: String(overall.label ?? ''),
    overallLevel: normalizeRiskLevel(overall.level),
    items,
    ptOracleType: str(raw.ptOracleType),
    debtOracleType: str(raw.debtOracleType),
  };
}

function normalizeLoopReference(raw: unknown): LoopReference | null {
  if (!isRecord(raw)) return null;
  const positionUsd = numOrNull(raw.positionUsd);
  const leverage = numOrNull(raw.leverage);
  const fixedApy = numOrNull(raw.fixedApy);
  const borrowApy = numOrNull(raw.borrowApy);
  if (positionUsd === null || leverage === null || fixedApy === null || borrowApy === null) return null;
  return { positionUsd, leverage, fixedApy, borrowApy };
}

/**
 * The single-PT looping endpoint returns `{ options: [...] }`; the chain list
 * returns `[{ ptAddress, info: { options } }]`. Accept either.
 */
export function normalizeLoopOptions(raw: unknown): LoopOption[] {
  let options: unknown[] = [];
  if (Array.isArray(raw)) {
    const first = raw[0];
    options = isRecord(first) && isRecord(first.info) && Array.isArray(first.info.options) ? first.info.options : raw;
  } else if (isRecord(raw) && Array.isArray(raw.options)) {
    options = raw.options;
  }

  return options
    .filter(isRecord)
    .map((option) => {
      const data = isRecord(option.data) ? option.data : {};
      return {
        chainId: num(option.chainId),
        protocol: String(option.protocol ?? ''),
        moneyMarketName: String(option.moneyMarketName ?? option.protocol ?? ''),
        moneyMarketAddress: lower(typeof option.moneyMarketAddress === 'string' ? option.moneyMarketAddress : ''),
        url: str(option.url),
        marketUrl: str(option.marketUrl),
        debtSymbol: String(option.debtSymbol ?? ''),
        debtDecimals: Number.isInteger(option.debtDecimals) ? (option.debtDecimals as number) : 18,
        lltv: numOrNull(data.lltv),
        borrowApy: numOrNull(data.borrowApy),
        borrowApy7dAvg: numOrNull(data.borrowApy7dAvg),
        maxLeverage: numOrNull(data.maxLeverage),
        liquidityUsd: num(data.liquidityUsd),
        totalSupplyUsd: numOrNull(data.totalSupplyUsd),
        supplyCapUsd: numOrNull(data.supplyCapUsd),
        maxApy: numOrNull(data.maxApy),
        reference: normalizeLoopReference(data.reference),
        utilization: numOrNull(data.utilization),
        risks: normalizeLoopRisk(option.risks),
      };
    })
    .filter((option) => option.moneyMarketName !== '' || option.moneyMarketAddress !== '');
}

function normalizeBookLevels(raw: unknown): BookLevel[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(isRecord)
    .map((entry) => ({
      impliedApy: num(entry.impliedApy),
      limitOrderSize: String(entry.limitOrderSize ?? '0'),
      ammSize: String(entry.ammSize ?? '0'),
    }))
    .filter((level) => Number.isFinite(level.impliedApy));
}

export function normalizeLimitOrderBook(raw: RawOrderBook): LimitOrderBook {
  return { long: normalizeBookLevels(raw.longYieldEntries), short: normalizeBookLevels(raw.shortYieldEntries) };
}

export function normalizeLiveRate(raw: RawSwappingPrices): LiveRate {
  return {
    impliedApy: numOrNull(raw.impliedApy),
    ptPerUnderlying: numOrNull(raw.underlyingTokenToPtRate),
    underlyingPerPt: numOrNull(raw.ptToUnderlyingTokenRate),
  };
}

/**
 * Merge the chain-scoped (rich: assets, decimals, prices) market with the
 * cross-chain market payload (rich: risk notes, TVL details).
 */
export function normalizeMarket(rawV1: RawMarketV1, rawV2?: RawMarketV2 | null): Market | null {
  const address = lower(rawV1.address ?? rawV2?.address);
  const chainId = rawV1.chainId ?? rawV2?.chainId;
  if (!address || !chainId) return null;

  const pt = normalizeAsset(rawV1.pt, chainId, 'PT');
  const sy = normalizeAsset(rawV1.sy, chainId, 'SY');
  const accounting = normalizeAsset(rawV1.accountingAsset, chainId, '—');
  const underlying = normalizeAsset(rawV1.underlyingAsset, chainId, accounting?.symbol ?? '—');
  if (!pt || !sy || !accounting || !underlying) return null;

  const yt = normalizeAsset(rawV1.yt, chainId, 'YT') ?? pt;
  const basePricing = normalizeAsset(rawV1.basePricingAsset, chainId);

  const details = rawV2?.details ?? null;
  const info = normalizeMarketInfo(rawV2?.marketInfo ?? null);

  const liquidityUsd = usdOf(rawV1.liquidity) || num(details?.liquidity);
  const tvlUsd = num(details?.totalTvl) || liquidityUsd;
  const tradingVolumeUsd = usdOf(rawV1.tradingVolume) || num(details?.tradingVolume);

  const impliedApy = num(rawV1.impliedApy) || num(details?.impliedApy);
  const ptDiscount = num(rawV1.ptDiscount, pt.priceUsd !== null ? Math.max(0, 1 - pt.priceUsd) : 0);

  return {
    id: `${chainId}-${address}`,
    chainId,
    address,
    name: rawV1.name ?? str(rawV1.pt?.symbol) ?? address,
    protocol: str(rawV1.protocol) ?? 'Unknown',
    expiry: rawV1.expiry ?? '',
    pt,
    yt,
    sy,
    accountingAsset: accounting,
    underlyingAsset: underlying,
    basePricingAsset: basePricing,
    categoryIds: rawV1.categoryIds ?? [],
    isPrime: rawV2?.isPrime ?? false,
    liquidityUsd,
    tvlUsd,
    tradingVolumeUsd,
    impliedApy,
    underlyingApy: num(rawV1.underlyingApy) || num(details?.underlyingApy),
    ptDiscount,
    swapFeeApy: num(rawV1.swapFeeApy) || num(details?.swapFeeApy),
    pendleApy: num(rawV1.pendleApy) || num(details?.pendleApy),
    ytFloatingApy: num(rawV1.ytFloatingApy) || num(details?.ytFloatingApy),
    feeRate: num(rawV1.extendedInfo?.feeRate) || num(details?.feeRate),
    floatingPt: numOrNull(rawV1.extendedInfo?.floatingPt),
    icon: str(rawV2?.icon),
    isVolatile: rawV2?.isVolatile ?? false,
    marketType: str(rawV2?.marketType),
    points: normalizePoints(rawV2?.points),
    lpBreakdown: normalizeApyBreakdown(rawV2?.lpApyBreakdown),
    ytBreakdown: normalizeApyBreakdown(rawV2?.ytApyBreakdown),
    underlyingRewardBreakdown: normalizeApyBreakdown(rawV2?.underlyingRewardApyBreakdown),
    emissions: normalizeEmission(rawV2?.pendleEmission),
    limitOrderIncentive: normalizeLimitOrderIncentive(rawV2?.limitOrderIncentive),
    yieldRange: normalizeYieldRange(details?.yieldRange),
    externalProtocols: normalizeExternalProtocols(rawV2?.externalProtocols),
    ptRoi: numOrNull(rawV1.ptRoi) ?? numOrNull(details?.ptRoi),
    ytRoi: numOrNull(details?.ytRoi),
    info,
    updatedAt: rawV1.timestamp ?? rawV2?.timestamp ?? new Date().toISOString(),
  };
}

export function normalizeHistory(raw: RawHistoryResponse): HistoryPoint[] {
  const results = raw.results ?? [];
  return results
    .map((point) => ({
      timestamp: point.timestamp ?? '',
      impliedApy: numOrNull(point.impliedApy),
      ptPrice: numOrNull(point.ptPrice),
      ytPrice: numOrNull(point.ytPrice),
      lpPrice: numOrNull(point.lpPrice),
      totalTvl: numOrNull(point.totalTvl),
      underlyingApy: numOrNull(point.underlyingApy),
    }))
    .filter((p) => p.timestamp !== '');
}

export function mergeMarkets(v1: RawMarketV1[], v2ByKey: Map<string, RawMarketV2>): Market[] {
  const out: Market[] = [];
  const seen = new Set<string>();
  for (const raw of v1) {
    const key = assetId(raw.chainId ?? 0, raw.address ?? '');
    const market = normalizeMarket(raw, v2ByKey.get(key) ?? null);
    if (market && !seen.has(market.id)) {
      out.push(market);
      seen.add(market.id);
    }
  }
  return out;
}
