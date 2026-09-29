/**
 * End-to-end test: the real side-panel data client against the real APIs, with
 * a mocked `chrome` surface. This is the closest thing to loading the extension
 * in a browser that can run in CI.
 *
 * It deliberately exercises the same path the panel uses — no service worker in
 * the middle — and asserts that the worker does *not* become a network client
 * again.
 *
 *   PF_LIVE=1 npm test
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { toUnits } from '../src/lib/util/decimal';

const LIVE = process.env.PF_LIVE === '1';
const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const RECEIVER = '0x000000000000000000000000000000000000dEaD';

let client: typeof import('../src/lib/api/client');

/** Counts writes so we can prove the cache is actually being read, not refetched. */
const storageWrites: string[] = [];

function installChromeMock(): void {
  const bag = new Map<string, unknown>();
  const chromeMock = {
    storage: {
      local: {
        get: async (key: string) => (bag.has(key) ? { [key]: bag.get(key) } : {}),
        set: async (values: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(values)) {
            storageWrites.push(key);
            bag.set(key, value);
          }
        },
        remove: async (keys: string[]) => {
          for (const key of keys) bag.delete(key);
        },
      },
      onChanged: { addListener: () => undefined },
    },
    runtime: {
      onMessage: { addListener: () => undefined },
      onInstalled: { addListener: () => undefined },
      onStartup: { addListener: () => undefined },
      sendMessage: async () => {
        throw new Error('the panel must not talk to the worker over RPC any more');
      },
    },
    alarms: {
      create: () => {
        throw new Error('the extension must not use chrome.alarms');
      },
      onAlarm: { addListener: () => undefined },
    },
    sidePanel: { setPanelBehavior: async () => undefined },
    tabs: { create: async () => undefined },
  };
  vi.stubGlobal('chrome', chromeMock);
}

beforeAll(async () => {
  installChromeMock();
  client = await import('../src/lib/api/client');
  // The worker must still load and register its two listeners without touching
  // the network. `sendMessage` throwing above would surface any regression here.
  await import('../src/background/service-worker');
});

describe.skipIf(!LIVE)('side panel -> Pendle API', () => {
  it(
    'fetches a market snapshot and serves it from the persisted cache',
    async () => {
      const first = await client.getMarkets([1], true);
      expect(first.chains[0]!.markets.length).toBeGreaterThan(20);
      expect(storageWrites).toContain('pf.snapshot.v1');

      const writesAfterFirst = storageWrites.filter((key) => key === 'pf.snapshot.v1').length;
      const second = await client.getMarkets([1]);
      expect(second.fetchedAt).toBe(first.fetchedAt);
      // A cache hit must not write the snapshot again.
      expect(storageWrites.filter((key) => key === 'pf.snapshot.v1').length).toBe(writesAfterFirst);

      const market = first.chains[0]!.markets.find((m) => m.liquidityUsd > 5_000_000);
      expect(market).toBeDefined();
      expect(market!.pt.decimals).toBeGreaterThan(0);
      expect(market!.accountingAsset.symbol.length).toBeGreaterThan(0);

      // Expired markets must be dropped at the cache boundary but counted, so
      // the UI can say "N expired excluded" rather than hiding them.
      const now = Date.now();
      const expired = first.chains
        .flatMap((chain) => chain.markets)
        .filter((m) => new Date(m.expiry).getTime() <= now);
      expect(expired).toHaveLength(0);
      expect(first.skippedExpired ?? 0).toBeGreaterThan(0);
    },
    120_000,
  );

  it(
    'resolves the Treasury benchmark',
    async () => {
      const benchmarks = await client.getBenchmarks(true);
      const notes = benchmarks['Treasury Notes'];
      expect(notes).toBeDefined();
      expect(notes!.source).toBe('treasury');
      expect(notes!.pct).toBeGreaterThan(0);
      expect(notes!.pct).toBeLessThan(0.15);
    },
    60_000,
  );

  it(
    'fetches and caches market history',
    async () => {
      const snapshot = await client.getMarkets([1]);
      const market = snapshot.chains[0]!.markets
        .filter((m) => new Date(m.expiry).getTime() > Date.now() && m.liquidityUsd > 5_000_000)
        .sort((a, b) => b.liquidityUsd - a.liquidityUsd)[0]!;

      const points = await client.getHistory(market.id, market.chainId, market.address);
      expect(points.length).toBeGreaterThan(100);

      const cached = await client.getHistory(market.id, market.chainId, market.address);
      expect(cached.length).toBe(points.length);
    },
    120_000,
  );

  it(
    'prices a real quote and reports gas',
    async () => {
      const snapshot = await client.getMarkets([1]);
      const market = snapshot.chains[0]!.markets
        .filter((m) => m.accountingAsset.symbol === 'USDC' && m.liquidityUsd > 3_000_000)
        .sort((a, b) => b.liquidityUsd - a.liquidityUsd)[0]!;

      const { quote, nativePriceUsd } = await client.getConvert({
        chainId: 1,
        tokenIn: USDC,
        amountIn: toUnits('50000', 6),
        tokenOut: market.pt.address,
        receiver: RECEIVER,
        slippage: 0.01,
      });

      expect(quote.action).toBe('swap');
      expect(quote.outputs).toHaveLength(1);
      expect(Number(quote.outputs[0]!.amount)).toBeGreaterThan(0);
      expect(quote.effectiveApy).not.toBeNull();
      expect(nativePriceUsd).toBeGreaterThan(0);
    },
    120_000,
  );
});
