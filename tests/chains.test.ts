import { describe, expect, it } from 'vitest';
import { classifyAsset } from '../src/lib/domain/score';
import { chainMeta, chainSlug, marketDeepLink, marketsListDeepLink, STABLE_TOKENS } from '../src/lib/domain/chains';
import { renderSettings } from '../src/panel/views/settings';

describe('classifyAsset', () => {
  it('prefers Pendle category tags', () => {
    expect(classifyAsset(['stables'], [])).toBe('stable');
    expect(classifyAsset(['rwa'], ['USDC'])).toBe('rwa');
    expect(classifyAsset(['lst'], ['wstETH'])).toBe('eth-staking');
    expect(classifyAsset(['btc'], ['cbBTC'])).toBe('btc');
    expect(classifyAsset(['eth'], ['ETH'])).toBe('eth');
  });

  it('falls back to symbols', () => {
    expect(classifyAsset([], ['USDe'])).toBe('stable');
    expect(classifyAsset([], ['weETH'])).toBe('eth-staking');
    expect(classifyAsset([], ['solvBTC'])).toBe('btc');
    expect(classifyAsset([], ['MKR'])).toBe('other');
    expect(classifyAsset([], [])).toBe('unknown');
  });
});

describe('chains and deep links', () => {
  it('maps chain ids to slugs', () => {
    expect(chainSlug(1)).toBe('ethereum');
    expect(chainSlug(42161)).toBe('arbitrum');
    expect(chainMeta(8453)?.name).toBe('Base');
    expect(chainSlug(999999)).toBe('ethereum');
  });

  it('builds the Pendle swap deep link used by the app', () => {
    const url = marketDeepLink(1, '0xABC', 'pt');
    expect(url).toBe('https://app.pendle.finance/trade/markets/0xABC/swap?chain=ethereum&view=pt');
    expect(marketsListDeepLink(42161)).toBe('https://app.pendle.finance/trade/markets?chains=arbitrum');
  });

  it('only lists stable input tokens it can price as $1', () => {
    expect(STABLE_TOKENS[1]!.map((t) => t.symbol)).toContain('USDC');
    expect(STABLE_TOKENS[1]!.every((t) => t.decimals > 0)).toBe(true);
  });
});

describe('settings view import safety', () => {
  it('exposes a render function without touching the DOM at import time', () => {
    expect(typeof renderSettings).toBe('function');
  });
});
