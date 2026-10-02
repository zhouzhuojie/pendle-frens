/**
 * The side panel's data client: fetch, cache, de-duplicate.
 *
 * This used to live in the service worker behind a message-passing RPC layer,
 * on the assumption that network I/O had to happen there. It does not. MV3
 * grants cross-origin access to "an extension service worker **or foreground
 * tab**" that holds `host_permissions` — only content scripts are confined to
 * their page's origin — and a side panel is a foreground extension page. This
 * extension has no content scripts, so nothing ever needed the indirection.
 *
 * What that indirection cost: a whole RPC protocol, a second serialisation of
 * the ~0.3 MB snapshot per refresh (the worker to panel `sendMessage` clone),
 * and a class of failures where an idle-killed worker answers nothing.
 *
 * What it bought: the worker could finish a fetch after the panel closed, and
 * two panels in two windows shared one in-flight request. Both are now covered
 * by the layer below — every cache here is persisted in `chrome.storage.local`,
 * which is shared across contexts, so a second panel reads the fresh snapshot
 * instead of refetching. The remaining duplicate is two *simultaneous* cold
 * opens, which costs one extra markets request (~10 computing units).
 *
 * The service worker still exists, for the one job the platform requires it
 * for: `sidePanel.setPanelBehavior` at install. It touches no network.
 */

import {
  convert as convertApi,
  fetchHistory,
  fetchLimitOrderBook,
  fetchLiveRate,
  fetchLongHistory,
  fetchLoopOptions,
  fetchMarkets,
  fetchNativePrice,
} from './pendle';
import { fetchTreasuryBenchmarks } from './treasury';
import type {
  Benchmark,
  ChainMarkets,
  ConvertParams,
  HistoryPoint,
  LimitOrderBook,
  LiveRate,
  LoopOption,
  MarketSnapshot,
} from '../domain/types';
import { isExpired } from '../domain/screen';
import {
  getCachedBenchmark,
  getCachedHistory,
  getCachedNativePrice,
  getSnapshot,
  setCachedBenchmark,
  setCachedHistory,
  setCachedNativePrice,
  setSnapshot,
  clearCaches,
} from '../storage/store';
import { SingleFlight } from '../util/async';

/**
 * A fixed-yield discovery list does not move second-to-second, and each full
 * refresh costs ~10 computing units, so five minutes is a deliberate trade of
 * freshness for API budget. Everything is overridable with the ⟳ button, which
 * passes `force`.
 */
export const MARKET_TTL_MS = 5 * 60_000;
export const HISTORY_TTL_MS = 30 * 60_000;
/** A monthly official series: no point asking more than twice a day. */
export const BENCHMARK_TTL_MS = 6 * 60 * 60_000;
export const NATIVE_PRICE_TTL_MS = 10 * 60_000;
/**
 * Detail-page extras. Daily history and looping venues are slow-moving; the
 * order book and the spot rate are not, so they get short windows. All four are
 * fetched lazily when a market's detail page opens, never on a list render.
 */
export const LONG_HISTORY_TTL_MS = 30 * 60_000;
export const BOOK_TTL_MS = 2 * 60_000;
export const LOOP_TTL_MS = 30 * 60_000;
export const LIVE_RATE_TTL_MS = 60_000;

/**
 * In-flight de-duplication within this context. `chrome.storage` has no
 * compare-and-swap, so this also keeps concurrent callers from racing on the
 * same write.
 */
const marketCache = new SingleFlight<string, MarketSnapshot>(MARKET_TTL_MS);
const benchmarkCache = new SingleFlight<'benchmarks', Record<string, Benchmark>>(BENCHMARK_TTL_MS);
const nativePriceCache = new SingleFlight<string, number | null>(NATIVE_PRICE_TTL_MS);
const longHistoryCache = new SingleFlight<string, HistoryPoint[]>(LONG_HISTORY_TTL_MS);
const bookCache = new SingleFlight<string, LimitOrderBook>(BOOK_TTL_MS);
const loopCache = new SingleFlight<string, LoopOption[]>(LOOP_TTL_MS);
const liveRateCache = new SingleFlight<string, LiveRate>(LIVE_RATE_TTL_MS);

const marketKey = (chainId: number, address: string) => `${chainId}-${address.toLowerCase()}`;

/** Markets, with expired ones dropped at the cache boundary but counted. */
export async function getMarkets(chains: number[], force = false): Promise<MarketSnapshot> {
  const sorted = [...chains].sort((a, b) => a - b);
  const key = sorted.join(',');

  // Serve a fresh persisted snapshot before touching the network.
  if (!force) {
    const persisted = await getSnapshot();
    if (persisted && persisted.chains.map((c) => c.chainId).join(',') === key) {
      const age = Date.now() - new Date(persisted.fetchedAt).getTime();
      if (age < MARKET_TTL_MS) return persisted;
    }
  }

  return marketCache.run(
    key,
    async () => {
      const results = await fetchMarkets(sorted);
      // Pendle's `isActive` filter still returns expired markets; they made up
      // ~90% of the payload. Drop them here, but report how many.
      let skippedExpired = 0;
      const built: ChainMarkets[] = results.map((result) => {
        const live = result.markets.filter((market) => !isExpired(market));
        skippedExpired += result.markets.length - live.length;
        return { chainId: result.chainId, fetchedAt: new Date().toISOString(), markets: live };
      });
      const snapshot: MarketSnapshot = { fetchedAt: new Date().toISOString(), chains: built, skippedExpired };
      await setSnapshot(snapshot);
      return snapshot;
    },
    force,
  );
}

export async function getHistory(
  marketId: string,
  chainId: number,
  address: string,
  force = false,
): Promise<import('../domain/types').HistoryPoint[]> {
  if (!force) {
    const cached = await getCachedHistory(marketId);
    if (cached && Date.now() - new Date(cached.fetchedAt).getTime() < HISTORY_TTL_MS) return cached.points;
  }
  const points = await fetchHistory(chainId, address);
  await setCachedHistory(marketId, points);
  return points;
}

/**
 * The long (daily) history, cached in memory only — it is context for the
 * detail page and is never part of the score.
 */
export async function getLongHistory(
  chainId: number,
  address: string,
  force = false,
): Promise<HistoryPoint[]> {
  return longHistoryCache.run(marketKey(chainId, address), () => fetchLongHistory(chainId, address), force);
}

export async function getLimitOrderBook(chainId: number, address: string, force = false): Promise<LimitOrderBook> {
  return bookCache.run(marketKey(chainId, address), () => fetchLimitOrderBook(chainId, address), force);
}

export async function getLoopOptions(chainId: number, ptAddress: string, force = false): Promise<LoopOption[]> {
  return loopCache.run(marketKey(chainId, ptAddress), () => fetchLoopOptions(chainId, ptAddress), force);
}

export async function getLiveRate(chainId: number, address: string, force = false): Promise<LiveRate> {
  return liveRateCache.run(marketKey(chainId, address), () => fetchLiveRate(chainId, address), force);
}

export async function getBenchmarks(force = false): Promise<Record<string, Benchmark>> {
  if (!force) {
    const cached = await getCachedBenchmark();
    if (cached && Date.now() - new Date(cached.fetchedAt).getTime() < BENCHMARK_TTL_MS) return cached.benchmarks;
  }
  return benchmarkCache.run(
    'benchmarks',
    async () => {
      const benchmarks = await fetchTreasuryBenchmarks();
      if (Object.keys(benchmarks).length > 0) await setCachedBenchmark(benchmarks);
      return benchmarks;
    },
    force,
  );
}

/** Native token price, used to turn gas units into dollars. */
export async function getNativePrice(chainId: number): Promise<number | null> {
  const cached = await getCachedNativePrice();
  const fresh = cached && Date.now() - new Date(cached.fetchedAt).getTime() < NATIVE_PRICE_TTL_MS;
  if (fresh && cached.byChain[String(chainId)] !== undefined) return cached.byChain[String(chainId)] ?? null;
  const price = await nativePriceCache.run(String(chainId), () => fetchNativePrice(chainId));
  if (price !== null) {
    const byChain = { ...(cached?.byChain ?? {}), [String(chainId)]: price };
    await setCachedNativePrice(byChain);
  }
  return price;
}

/** Never cached: a quote is a point-in-time estimate and the UI shows when it was taken. */
export async function getConvert(params: ConvertParams) {
  const [quote, nativePriceUsd] = await Promise.all([convertApi(params), getNativePrice(params.chainId)]);
  return { quote, nativePriceUsd };
}

/** Settings → "Clear cached data". */
export async function clearRemoteCaches(): Promise<void> {
  await clearCaches();
  marketCache.clear();
  benchmarkCache.clear();
  nativePriceCache.clear();
  longHistoryCache.clear();
  bookCache.clear();
  loopCache.clear();
  liveRateCache.clear();
}

