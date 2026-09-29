/**
 * The storage layer, against a fake `chrome.storage.local`.
 *
 * This is the only module that knows the persisted key names, so it is the only
 * place a rename or a migration can silently lose a user's data.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addFavorite,
  clearCaches,
  DEFAULT_SETTINGS,
  getCachedHistory,
  getFavorites,
  getSettings,
  getSnapshot,
  removeFavorite,
  saveSettings,
  setCachedHistory,
  setFavorites,
  setSnapshot,
} from '../src/lib/storage/store';
import type { FavoriteItem, MarketSnapshot } from '../src/lib/domain/types';

let bag: Map<string, unknown>;

function installChromeMock(): void {
  bag = new Map();
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: async (key: string) => (bag.has(key) ? { [key]: bag.get(key) } : {}),
        set: async (values: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(values)) bag.set(key, value);
        },
        remove: async (keys: string | string[]) => {
          for (const key of typeof keys === 'string' ? [keys] : keys) bag.delete(key);
        },
      },
    },
  });
}

function favorite(marketId: string): FavoriteItem {
  return {
    marketId,
    chainId: 1,
    address: '0xmarket',
    name: 'PT-reUSD-10DEC2026',
    protocol: 're.xyz',
    expiry: '2026-12-10T00:00:00.000Z',
    addedAt: '2026-09-29T00:00:00.000Z',
    addedImpliedApy: 0.115,
    addedBenchmarkPct: 0.0335,
  };
}

beforeEach(installChromeMock);

describe('settings', () => {
  it('applies defaults and persists a patch', async () => {
    expect(await getSettings()).toEqual(DEFAULT_SETTINGS);
    const next = await saveSettings({ minLiquidityUsd: 2_000_000 });
    expect(next.minLiquidityUsd).toBe(2_000_000);
    // Unknown-to-the-defaults keys must survive a re-read.
    expect((await getSettings()).minLiquidityUsd).toBe(2_000_000);
    expect(bag.get('pf.settings.v1')).toMatchObject({ slippagePct: DEFAULT_SETTINGS.slippagePct });
  });
});

describe('favorites', () => {
  it('stores newest first and de-duplicates by market', async () => {
    await addFavorite(favorite('1-0xa'));
    await addFavorite(favorite('1-0xb'));
    const withDuplicate = await addFavorite(favorite('1-0xa'));
    expect(withDuplicate.map((f) => f.marketId)).toEqual(['1-0xa', '1-0xb']);

    expect((await removeFavorite('1-0xa')).map((f) => f.marketId)).toEqual(['1-0xb']);
    expect(await getFavorites()).toHaveLength(1);
  });

  it('returns an empty list rather than throwing when nothing is stored', async () => {
    expect(await getFavorites()).toEqual([]);
    await setFavorites([]);
    expect(await getFavorites()).toEqual([]);
  });

  it('adopts a pre-rename pf.watchlist.v1 list instead of losing it', async () => {
    // Anyone who starred a market before the feature was renamed has their list
    // under the old key. Losing it on upgrade would be silent and unforgivable.
    const legacy = [favorite('1-0xa'), favorite('1-0xb')];
    bag.set('pf.watchlist.v1', legacy);

    expect(await getFavorites()).toEqual(legacy);
    expect(bag.get('pf.favorites.v1')).toEqual(legacy);
    expect(bag.has('pf.watchlist.v1')).toBe(false);
  });

  it('prefers the new key and leaves the legacy one alone if both exist', async () => {
    bag.set('pf.watchlist.v1', [favorite('1-0xold')]);
    await setFavorites([favorite('1-0xnew')]);

    expect((await getFavorites()).map((f) => f.marketId)).toEqual(['1-0xnew']);
    expect(bag.has('pf.watchlist.v1')).toBe(true);
  });

  it('does nothing clever when the legacy key is empty', async () => {
    bag.set('pf.watchlist.v1', []);
    expect(await getFavorites()).toEqual([]);
    expect(bag.has('pf.favorites.v1')).toBe(false);
  });
});

describe('caches', () => {
  it('round-trips a snapshot', async () => {
    const snapshot: MarketSnapshot = { fetchedAt: '2026-09-29T00:00:00.000Z', chains: [], skippedExpired: 7 };
    expect(await getSnapshot()).toBeNull();
    await setSnapshot(snapshot);
    expect(await getSnapshot()).toEqual(snapshot);
  });

  it('round-trips history and clears everything on request', async () => {
    await setCachedHistory('1-0xa', [{ timestamp: 't', impliedApy: 0.1, ptPrice: 0.98, totalTvl: 1, underlyingApy: 0.05 }]);
    expect((await getCachedHistory('1-0xa'))?.points).toHaveLength(1);

    await setSnapshot({ fetchedAt: 'now', chains: [], skippedExpired: 0 });
    await clearCaches();
    expect(await getCachedHistory('1-0xa')).toBeNull();
    expect(await getSnapshot()).toBeNull();
  });

  it('leaves settings and favorites alone when caches are cleared', async () => {
    await saveSettings({ slippagePct: 2 });
    await addFavorite(favorite('1-0xa'));
    await clearCaches();
    expect((await getSettings()).slippagePct).toBe(2);
    expect(await getFavorites()).toHaveLength(1);
  });
});
