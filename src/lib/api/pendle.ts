/**
 * Pendle hosted API client.
 *
 * Endpoints used (all public, no API key):
 *   GET  /v1/{chainId}/markets            rich chain-scoped markets (assets, decimals, prices)
 *   GET  /v2/markets/all                  cross-chain markets (risk notes, TVL, yield sources,
 *                                          points, emissions, looping venues)
 *   GET  /v3/{chainId}/markets/{addr}/historical-data   [time_frame=day for the long view]
 *   GET  /v2/limit-orders/book/{chainId}  resting limit orders + AMM depth
 *   GET  /v1/pt-looping/loop/pts/{chainId}/{pt}/looping leverage venues + risk panel
 *   GET  /v1/sdk/{chainId}/markets/{addr}/swapping-prices  block-fresh spot rate
 *   POST /v3/sdk/{chainId}/convert        transaction/quote builder (entry, exit, roll)
 *
 * All requests must run in the extension background context (see service-worker)
 * so that host_permissions bypass CORS for the US Treasury API too.
 */

import type {
  ConvertParams,
  ConvertQuote,
  ConvertRoute,
  HistoryPoint,
  LimitOrderBook,
  LiveRate,
  LoopOption,
  Market,
} from '../domain/types';
import { chainMeta } from '../domain/chains';
import { mapLimit, withRetry } from '../util/async';
import { getJson, isRetryable, postJson } from './http';
import {
  type RawHistoryResponse,
  type RawMarketV1,
  type RawMarketV2,
  type RawOrderBook,
  type RawSwappingPrices,
  mergeMarkets,
  normalizeHistory,
  normalizeLimitOrderBook,
  normalizeLiveRate,
  normalizeLoopOptions,
} from './normalize';

export const PENDLE_API = 'https://api-v2.pendle.finance/core';

const PAGE = 100;
const MAX_PAGES = 12;

interface PagedV1 {
  total?: number;
  results?: RawMarketV1[];
}

interface PagedV2 {
  total?: number;
  results?: RawMarketV2[];
}

async function fetchV1Markets(chainId: number): Promise<RawMarketV1[]> {
  const all: RawMarketV1[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const skip = page * PAGE;
    const url = `${PENDLE_API}/v1/${chainId}/markets?limit=${PAGE}&skip=${skip}&isActive=true`;
    const body = await withRetry(() => getJson<PagedV1>(url), { shouldRetry: isRetryable });
    const results = body.results ?? [];
    all.push(...results);
    if (results.length < PAGE || all.length >= (body.total ?? all.length)) break;
  }
  return all;
}

async function fetchV2Risk(chainId: number): Promise<Map<string, RawMarketV2>> {
  const map = new Map<string, RawMarketV2>();
  try {
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const skip = page * PAGE;
      const url = `${PENDLE_API}/v2/markets/all?chainId=${chainId}&limit=${PAGE}&skip=${skip}`;
      const body = await withRetry(() => getJson<PagedV2>(url), { attempts: 2, shouldRetry: isRetryable });
      const results = body.results ?? [];
      for (const raw of results) {
        if (raw.address) map.set(`${raw.chainId ?? chainId}-${raw.address.toLowerCase()}`, raw);
      }
      if (results.length < PAGE || map.size >= (body.total ?? map.size)) break;
    }
  } catch {
    // Risk notes are a nice-to-have; never fail the whole snapshot for them.
  }
  return map;
}

export interface ChainMarketResult {
  chainId: number;
  markets: Market[];
  /** true when the optional risk-info fetch succeeded. */
  hasRiskInfo: boolean;
}

export async function fetchChainMarkets(chainId: number): Promise<ChainMarketResult> {
  const [v1, v2] = await Promise.all([fetchV1Markets(chainId), fetchV2Risk(chainId)]);
  return { chainId, markets: mergeMarkets(v1, v2), hasRiskInfo: v2.size > 0 };
}

export async function fetchMarkets(chainIds: number[]): Promise<ChainMarketResult[]> {
  return mapLimit(chainIds, 3, (chainId) => fetchChainMarkets(chainId));
}

export async function fetchHistory(chainId: number, marketAddress: string): Promise<HistoryPoint[]> {
  const fields = 'impliedApy,ptPrice,totalTvl,underlyingApy';
  const url = `${PENDLE_API}/v3/${chainId}/markets/${marketAddress}/historical-data?fields=${fields}`;
  const body = await withRetry(() => getJson<RawHistoryResponse>(url), { shouldRetry: isRetryable });
  return normalizeHistory(body);
}

/**
 * Daily history. Pendle caps every series at ~1440 points, so hourly covers
 * only ~2 months while daily reaches back years — the window the score's
 * stability factor deliberately does *not* use, because it would then mix
 * regimes.
 */
export async function fetchLongHistory(chainId: number, marketAddress: string): Promise<HistoryPoint[]> {
  const fields = 'impliedApy,ptPrice,ytPrice,lpPrice,underlyingApy';
  const url = `${PENDLE_API}/v3/${chainId}/markets/${marketAddress}/historical-data?time_frame=day&fields=${fields}`;
  const body = await withRetry(() => getJson<RawHistoryResponse>(url), { shouldRetry: isRetryable });
  return normalizeHistory(body);
}

export async function fetchLimitOrderBook(chainId: number, marketAddress: string): Promise<LimitOrderBook> {
  const url = `${PENDLE_API}/v2/limit-orders/book/${chainId}?market=${marketAddress}&precisionDecimal=2&includeAmm=true`;
  const body = await withRetry(() => getJson<RawOrderBook>(url), { attempts: 2, shouldRetry: isRetryable });
  return normalizeLimitOrderBook(body);
}

/** Money markets this PT can be looped through, with Pendle's risk panel. */
export async function fetchLoopOptions(chainId: number, ptAddress: string): Promise<LoopOption[]> {
  const url = `${PENDLE_API}/v1/pt-looping/loop/pts/${chainId}/${ptAddress}/looping`;
  const body = await withRetry(() => getJson<unknown>(url), { attempts: 2, shouldRetry: isRetryable });
  return normalizeLoopOptions(body);
}

/** Block-fresh spot rate; lighter than a convert quote for a ticker. */
export async function fetchLiveRate(chainId: number, marketAddress: string): Promise<LiveRate> {
  const url = `${PENDLE_API}/v1/sdk/${chainId}/markets/${marketAddress}/swapping-prices`;
  const body = await withRetry(() => getJson<RawSwappingPrices>(url), { shouldRetry: isRetryable });
  return normalizeLiveRate(body);
}

export interface ConvertApiInput extends ConvertParams {}

export async function convert(params: ConvertApiInput): Promise<ConvertQuote> {
  const url = `${PENDLE_API}/v3/sdk/${params.chainId}/convert`;
  const body = {
    receiver: params.receiver,
    slippage: params.slippage,
    inputs: [{ token: params.tokenIn, amount: params.amountIn }],
    outputs: [params.tokenOut],
    enableAggregator: params.enableAggregator ?? true,
    additionalData: 'impliedApy,effectiveApy',
  };
  const raw = await withRetry(() => postJson<RawConvertResponse>(url, body), { attempts: 2, shouldRetry: isRetryable });
  return normalizeConvert(raw);
}

export interface RawContractParamInfo {
  method?: string;
  contractCallParamsName?: string[];
  contractCallParams?: unknown[];
}

export interface RawConvertResponse {
  action?: string;
  requiredApprovals?: { token?: string; amount?: string }[];
  routes?: {
    outputs?: { token?: string; amount?: string }[];
    tx?: { to?: string; from?: string; value?: string };
    contractParamInfo?: RawContractParamInfo;
    data?: {
      aggregatorType?: string;
      priceImpact?: number;
      effectiveApy?: number;
      fee?: { usd?: number };
      gasUsed?: string;
      intermediateSyAmount?: string;
      impliedApy?: { before?: number; after?: number };
      priceImpactBreakDown?: { internalPriceImpact?: number; externalPriceImpact?: number };
    };
  }[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function normalizeConvert(raw: RawConvertResponse): ConvertQuote {
  const route = raw.routes?.[0];
  const data = route?.data ?? {};

  return {
    action: raw.action ?? 'unknown',
    outputs: (route?.outputs ?? [])
      .filter((o): o is { token: string; amount: string } => typeof o.token === 'string' && typeof o.amount === 'string')
      .map((o) => ({ token: o.token, amount: o.amount })),
    priceImpact: numberOrNull(data.priceImpact),
    internalPriceImpact: numberOrNull(data.priceImpactBreakDown?.internalPriceImpact),
    externalPriceImpact: numberOrNull(data.priceImpactBreakDown?.externalPriceImpact),
    feeUsd: numberOrNull(data.fee?.usd),
    gasUsed: typeof data.gasUsed === 'string' ? data.gasUsed : null,
    impliedApyBefore: numberOrNull(data.impliedApy?.before),
    impliedApyAfter: numberOrNull(data.impliedApy?.after),
    effectiveApy: numberOrNull(data.effectiveApy),
    aggregatorType: typeof data.aggregatorType === 'string' ? data.aggregatorType : null,
    route: normalizeRoute(route?.contractParamInfo, route?.tx?.to, data.intermediateSyAmount, raw.requiredApprovals),
  };
}

/**
 * Parameter *names* are zipped with values because names and order differ per
 * method (`input` for entries, `output` for exits, none for composed rolls).
 */
export function normalizeRoute(
  info: RawContractParamInfo | undefined,
  router: string | undefined,
  syAmount: string | undefined,
  approvals: { token?: string; amount?: string }[] | undefined,
): ConvertRoute {
  const named = new Map<string, unknown>();
  const names = info?.contractCallParamsName ?? [];
  const params = info?.contractCallParams ?? [];
  names.forEach((name, index) => named.set(name, params[index]));

  const hop = [named.get('input'), named.get('output')].find(isRecord) ?? null;
  const swapData = hop && isRecord(hop.swapData) ? hop.swapData : null;
  const limitRecord = named.get('limit');
  const limit = isRecord(limitRecord) ? limitRecord : null;

  const normalFills = limit && Array.isArray(limit.normalFills) ? limit.normalFills.length : 0;
  const flashFills = limit && Array.isArray(limit.flashFills) ? limit.flashFills.length : 0;

  return {
    method: typeof info?.method === 'string' ? info.method : null,
    router: typeof router === 'string' ? router.toLowerCase() : null,
    pendleSwap: stringOrNull(hop?.pendleSwap),
    wrapToken: stringOrNull(hop?.tokenMintSy ?? hop?.tokenRedeemSy),
    netAmountIn: stringOrNull(hop?.netTokenIn ?? named.get('exactPtIn')),
    syAmount: typeof syAmount === 'string' ? syAmount : null,
    externalRouter: stringOrNull(swapData?.extRouter),
    swapType: swapData?.swapType === undefined || swapData?.swapType === null ? null : String(swapData.swapType),
    limitOrderFills: normalFills + flashFills,
    composedSelectors: ['selfCall1', 'selfCall2', 'reflectCall']
      .map((key) => named.get(key))
      .filter((value): value is string => typeof value === 'string' && value.length >= 10)
      .map((value) => value.slice(0, 10)),
    requiredApprovals: (approvals ?? [])
      .filter((a): a is { token: string; amount: string } => typeof a.token === 'string' && typeof a.amount === 'string')
      .map((a) => ({ token: a.token, amount: a.amount })),
  };
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** USD price of the chain's wrapped native token, used to price gas. */
export async function fetchNativePrice(chainId: number): Promise<number | null> {
  const meta = chainMeta(chainId);
  if (!meta) return null;
  try {
    const url = `${PENDLE_API}/v1/prices/assets?ids=${chainId}-${meta.wrappedNative}`;
    const body = await getJson<{ prices?: Record<string, number> }>(url);
    const price = body.prices?.[`${chainId}-${meta.wrappedNative}`];
    return typeof price === 'number' && Number.isFinite(price) ? price : null;
  } catch {
    return null;
  }
}
