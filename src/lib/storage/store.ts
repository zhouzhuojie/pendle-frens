/**
 * chrome.storage.local access layer with defaults and versioned keys.
 *
 * Everything the extension persists lives behind this module so that the UI
 * and the service worker never touch raw storage keys.
 */

import type { Benchmark, HistoryPoint, MarketSnapshot, Settings, FavoriteItem } from '../domain/types';
import { DEFAULT_SECURITY } from '../api/treasury';

const KEYS = {
  settings: 'pf.settings.v1',
  favorites: 'pf.favorites.v1',
  snapshot: 'pf.snapshot.v1',
  history: 'pf.history.v1',
  benchmark: 'pf.benchmark.v1',
  nativePrice: 'pf.nativePrice.v1',
} as const;

/**
 * Favorites lived under this key before the feature was renamed. It is read
 * once, adopted, then deleted, so an existing list does not silently vanish on
 * upgrade. Safe to remove entirely once the extension leaves 0.x.
 */
const LEGACY_FAVORITES_KEY = 'pf.watchlist.v1';

export const DEFAULT_SETTINGS: Settings = {
  chains: [1, 42161],
  benchmarkOverridePct: null,
  slippagePct: 1,
  defaultSizeUsd: 50_000,
  minMaturityDays: 14,
  minLiquidityUsd: 1_000_000,
  gasPriceGwei: 5,
  showRiskNotes: true,
};

export const DEFAULT_BENCHMARK_SECURITY = DEFAULT_SECURITY;

export interface CachedHistory {
  fetchedAt: string;
  points: HistoryPoint[];
}

export interface CachedBenchmark {
  fetchedAt: string;
  benchmarks: Record<string, Benchmark>;
}

export interface CachedNativePrice {
  fetchedAt: string;
  byChain: Record<string, number>;
}

async function read<T>(key: string, fallback: T): Promise<T> {
  const bag = await chrome.storage.local.get(key);
  const value = bag[key];
  return (value as T | undefined) ?? fallback;
}

async function write(key: string, value: unknown): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}

/* -------------------------------- settings ------------------------------- */

export async function getSettings(): Promise<Settings> {
  const stored = await read<Partial<Settings>>(KEYS.settings, {});
  return { ...DEFAULT_SETTINGS, ...stored };
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  await write(KEYS.settings, next);
  return next;
}

/* ------------------------------- favorites ------------------------------- */

export async function getFavorites(): Promise<FavoriteItem[]> {
  const stored = await read<FavoriteItem[] | null>(KEYS.favorites, null);
  if (stored !== null) return stored;
  const legacy = await read<FavoriteItem[]>(LEGACY_FAVORITES_KEY, []);
  if (legacy.length === 0) return [];
  await write(KEYS.favorites, legacy);
  await chrome.storage.local.remove(LEGACY_FAVORITES_KEY);
  return legacy;
}

export async function setFavorites(items: FavoriteItem[]): Promise<void> {
  await write(KEYS.favorites, items);
}

export async function addFavorite(item: FavoriteItem): Promise<FavoriteItem[]> {
  const items = await getFavorites();
  const next = [item, ...items.filter((i) => i.marketId !== item.marketId)];
  await setFavorites(next);
  return next;
}

export async function removeFavorite(marketId: string): Promise<FavoriteItem[]> {
  const items = await getFavorites();
  const next = items.filter((i) => i.marketId !== marketId);
  await setFavorites(next);
  return next;
}

/* -------------------------------- snapshot ------------------------------- */

export async function getSnapshot(): Promise<MarketSnapshot | null> {
  return read<MarketSnapshot | null>(KEYS.snapshot, null);
}

export async function setSnapshot(snapshot: MarketSnapshot): Promise<void> {
  await write(KEYS.snapshot, snapshot);
}

/* --------------------------------- caches -------------------------------- */

export async function getCachedHistory(marketId: string): Promise<CachedHistory | null> {
  const bag = await read<Record<string, CachedHistory>>(KEYS.history, {});
  return bag[marketId] ?? null;
}

export async function setCachedHistory(marketId: string, points: HistoryPoint[]): Promise<void> {
  const bag = await read<Record<string, CachedHistory>>(KEYS.history, {});
  const next: Record<string, CachedHistory> = { [marketId]: { fetchedAt: new Date().toISOString(), points } };
  // Keep the cache bounded: retain the 12 most recently fetched markets.
  const entries = Object.entries(bag)
    .filter(([key]) => key !== marketId)
    .sort((a, b) => b[1].fetchedAt.localeCompare(a[1].fetchedAt))
    .slice(0, 11);
  for (const [key, value] of entries) next[key] = value;
  await write(KEYS.history, next);
}

export async function getCachedBenchmark(): Promise<CachedBenchmark | null> {
  return read<CachedBenchmark | null>(KEYS.benchmark, null);
}

export async function setCachedBenchmark(benchmarks: Record<string, Benchmark>): Promise<void> {
  await write(KEYS.benchmark, { fetchedAt: new Date().toISOString(), benchmarks } satisfies CachedBenchmark);
}

export async function getCachedNativePrice(): Promise<CachedNativePrice | null> {
  return read<CachedNativePrice | null>(KEYS.nativePrice, null);
}

export async function setCachedNativePrice(byChain: Record<string, number>): Promise<void> {
  await write(KEYS.nativePrice, { fetchedAt: new Date().toISOString(), byChain } satisfies CachedNativePrice);
}

export async function clearCaches(): Promise<void> {
  await chrome.storage.local.remove([KEYS.snapshot, KEYS.history, KEYS.benchmark, KEYS.nativePrice]);
}
