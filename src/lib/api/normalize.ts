/**
 * Raw Pendle API payloads -> normalized domain types.
 *
 * Kept separate from the HTTP layer so it can be unit tested against captured
 * fixtures and so an API field rename only breaks one file.
 */

import type { AssetRef, HistoryPoint, Market, MarketInfo, ProtocolRef } from '../domain/types';
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
  } | null;
}

export interface RawHistoryResponse {
  results?: {
    timestamp?: string;
    impliedApy?: number | null;
    ptPrice?: number | null;
    totalTvl?: number | null;
    underlyingApy?: number | null;
  }[];
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
