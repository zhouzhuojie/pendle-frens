import { describe, expect, it } from 'vitest';
import {
  PROTOCOL_DEPTH,
  buildProtocolFacts,
  protocolDepthScore,
} from '../src/lib/domain/protocol';
import { scoreMarket } from '../src/lib/domain/score';
import { makeMarket } from './fixtures';

const CTX = { benchmarkPct: 0.035, minLiquidityUsd: 1_000_000 };

const protocolFactor = (score: ReturnType<typeof scoreMarket>) => score.factors.find((f) => f.key === 'protocol')!;

describe('buildProtocolFacts', () => {
  it('groups the API spellings of one protocol into a single bucket', () => {
    const markets = [
      makeMarket({ id: '1-a', protocol: 'USD.ai', tvlUsd: 1_000_000 }),
      makeMarket({ id: '1-b', protocol: 'USD.AI', tvlUsd: 2_000_000 }),
    ];
    const facts = buildProtocolFacts(markets);
    expect(facts.size).toBe(1);
    const entry = facts.get('usd.ai')!;
    expect(entry.markets).toBe(2);
    expect(entry.tvlUsd).toBe(3_000_000);
  });

  it('sums TVL, counts distinct chains and ORs the Prime flag', () => {
    const markets = [
      makeMarket({ id: '1-a', protocol: 'Saturn', chainId: 1, tvlUsd: 5_000_000, isPrime: false }),
      makeMarket({ id: '1-b', protocol: 'Saturn', chainId: 1, tvlUsd: 1_000_000, isPrime: true }),
      makeMarket({ id: '42161-c', protocol: 'SATURN', chainId: 42161, tvlUsd: 2_000_000, isPrime: false }),
    ];
    const entry = buildProtocolFacts(markets).get('saturn')!;
    expect(entry.markets).toBe(3);
    expect(entry.chains).toBe(2);
    expect(entry.tvlUsd).toBe(8_000_000);
    expect(entry.isPrime).toBe(true);
  });
});

describe('protocolDepthScore', () => {
  it('sits on the floor for a protocol with no measurable depth', () => {
    const score = protocolDepthScore({ protocol: 'X', markets: 1, chains: 1, tvlUsd: 0, isPrime: false });
    expect(score).toBeCloseTo(PROTOCOL_DEPTH.floor, 6);
  });

  it('is capped below 1, however large the protocol looks', () => {
    const score = protocolDepthScore({ protocol: 'X', markets: 80, chains: 8, tvlUsd: 50_000_000_000, isPrime: true });
    expect(score).toBeLessThanOrEqual(PROTOCOL_DEPTH.ceiling);
  });

  it('rises with depth, monotonically', () => {
    const thin = protocolDepthScore({ protocol: 'X', markets: 1, chains: 1, tvlUsd: 200_000, isPrime: false });
    const mid = protocolDepthScore({ protocol: 'X', markets: 4, chains: 1, tvlUsd: 10_000_000, isPrime: false });
    const thick = protocolDepthScore({ protocol: 'X', markets: 8, chains: 3, tvlUsd: 80_000_000, isPrime: true });
    expect(mid).toBeGreaterThan(thin);
    expect(thick).toBeGreaterThan(mid);
  });
});

describe('scoreMarket with protocol facts', () => {
  it('scores the protocol factor from depth, for any protocol', () => {
    const market = makeMarket({ id: '1-saturn', protocol: 'Saturn', tvlUsd: 20_000_000 });
    const facts = buildProtocolFacts([market]);

    const without = scoreMarket(market, CTX);
    const withFacts = scoreMarket(market, { ...CTX, protocolFacts: facts });

    expect(protocolFactor(without).value).toBeCloseTo(PROTOCOL_DEPTH.floor, 6);
    expect(protocolFactor(withFacts).value).toBeGreaterThan(PROTOCOL_DEPTH.floor);
    expect(protocolFactor(withFacts).value).toBeLessThanOrEqual(PROTOCOL_DEPTH.ceiling);
    expect(withFacts.protocolDepth).not.toBeNull();
    expect(withFacts.protocolDepth!.markets).toBe(1);
    expect(withFacts.protocolDepth!.tvlUsd).toBe(20_000_000);
    expect(protocolFactor(withFacts).detail).toMatch(/depth/i);
  });

  it('applies the same depth rule to a famous protocol and an unknown one', () => {
    // No curated tier: both are scored purely by the facts in the snapshot.
    const famous = makeMarket({ id: '1-aave', protocol: 'Aave', tvlUsd: 20_000_000 });
    const nobody = makeMarket({ id: '1-zzz', protocol: 'Brand New', tvlUsd: 20_000_000 });
    const facts = buildProtocolFacts([famous, nobody]);
    expect(protocolFactor(scoreMarket(famous, { ...CTX, protocolFacts: facts })).value).toBeCloseTo(
      protocolFactor(scoreMarket(nobody, { ...CTX, protocolFacts: facts })).value,
      6,
    );
  });

  it('falls back to the floor when the snapshot produced no facts', () => {
    const market = makeMarket({ id: '1-x', protocol: 'Brand New' });
    const score = scoreMarket(market, CTX);
    expect(score.protocolDepth).toBeNull();
    expect(protocolFactor(score).value).toBeCloseTo(PROTOCOL_DEPTH.floor, 6);
  });
});
