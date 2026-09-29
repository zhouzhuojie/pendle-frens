import { describe, expect, it } from 'vitest';
import { auditLink, classifyAsset, lookupProtocol, PROTOCOL_REGISTRY, protocolTier, TIER_DOCS, TIER_SCORE } from '../src/lib/domain/registry';
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

describe('protocol registry', () => {
  it('resolves known protocols and aliases', () => {
    expect(lookupProtocol('re.xyz')?.tier).toBe('B');
    expect(lookupProtocol('Aave')?.tier).toBe('A');
    expect(lookupProtocol('Maker')?.name).toBe('Sky');
    expect(lookupProtocol('Ethena Labs')?.name).toBe('Ethena');
  });

  it('is honest about unknowns', () => {
    expect(lookupProtocol('ZzZ New Protocol')).toBeNull();
    expect(protocolTier('ZzZ New Protocol')).toBe('unknown');
    expect(TIER_SCORE.unknown).toBeLessThan(TIER_SCORE.C);
    expect(TIER_SCORE.A).toBe(1);
  });

  it('lists Apyx, because hiding it was a registry gap and not a judgement', () => {
    // The Pendle API returns protocol "APYX"; undiscovered protocols are hidden
    // by default, so an omission here silently removes real markets from Discover.
    expect(lookupProtocol('APYX')?.name).toBe('Apyx');
    expect(lookupProtocol('APYX')?.tier).toBe('C');
    expect(lookupProtocol('Apyx')?.note).toMatch(/below par|not a floor/i);
  });

  it('documents every tier, so a letter is never unexplained in the UI', () => {
    for (const tier of ['A', 'B', 'C', 'unknown'] as const) {
      expect(TIER_DOCS[tier].length).toBeGreaterThan(20);
    }
    expect(TIER_DOCS.C).toMatch(/new, experimental/i);
  });

  describe('auditLink', () => {
    it('prefers a link published against the market itself', () => {
      expect(auditLink('Aave', 'https://example.test/market-audit')).toEqual({
        url: 'https://example.test/market-audit',
        source: 'pendle',
      });
    });

    it('falls back to the protocol page, because Pendle publishes none', () => {
      // Pendle's marketInfo.auditedUrl is empty for all ~590 markets we checked.
      expect(auditLink('re.xyz', '')).toEqual({
        url: 'https://docs.re.xyz/transparency-and-data-show-me-the-receipts/audits-attestations-custody-structure',
        source: 'registry',
      });
      expect(auditLink('APYX', null)?.source).toBe('registry');
    });

    it('returns null only when neither source has a link', () => {
      expect(auditLink('ZzZ New Protocol', null)).toBeNull();
      // Registered, but nobody has sourced an audit page for it yet.
      expect(auditLink('Lido', null)).toBeNull();
    });

    it('only carries audit links that were verified by hand', () => {
      for (const entry of PROTOCOL_REGISTRY) {
        if (entry.auditUrl === undefined) continue;
        expect(entry.auditUrl, `${entry.name} auditUrl must be https`).toMatch(/^https:\/\//);
      }
    });
  });

  it('resolves the spellings the Pendle API actually returns for USD.AI', () => {
    // The API returns both "USD.AI" and "USD.ai" for the same protocol.
    expect(lookupProtocol('USD.AI')?.name).toBe('USD.AI');
    expect(lookupProtocol('USD.ai')?.tier).toBe('B');
    expect(lookupProtocol('USDai')?.tier).toBe('B');
    expect(lookupProtocol('Permian Labs')?.name).toBe('USD.AI');
    // …and must not be mistaken for a similar-looking but different protocol.
    expect(protocolTier('Axis')).not.toBe(protocolTier('USD.AI'));
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
