import { describe, expect, it } from 'vitest';
import {
  FACTOR_DOCS,
  FACTOR_LABELS,
  FACTOR_ORDER,
  FLAG_DOCS,
  LIQUIDITY_SCORE_RANGE,
  MATURITY_BANDS,
  SCORE_EXPLAINER,
  SCORE_WEIGHTS,
  SPREAD_SCORE_RANGE,
  VERDICT_LABEL,
  VERDICT_RULE,
  VERDICT_RULES,
  liquidityFactor,
  maturityFactor,
  scoreMarket,
  spreadVsBenchmark,
  decideVerdict,
} from '../src/lib/domain/score';
import { analyzeHistory, stabilityScore, STABILITY } from '../src/lib/domain/history';
import { formatPct } from '../src/lib/domain/format';
import type { HistoryPoint, Market } from '../src/lib/domain/types';
import { makeAsset, makeMarket } from './fixtures';

const CTX = { benchmarkPct: 0.035, minLiquidityUsd: 1_000_000 };

describe('liquidityFactor', () => {
  it('is 0 at $100k and 1 at $10M on a log scale', () => {
    expect(liquidityFactor(100_000)).toBeCloseTo(0, 5);
    expect(liquidityFactor(10_000_000)).toBeCloseTo(1, 5);
    expect(liquidityFactor(1_000_000)).toBeCloseTo(0.5, 5);
  });

  it('is monotonic and clamped', () => {
    expect(liquidityFactor(0)).toBe(0);
    expect(liquidityFactor(50_000_000)).toBe(1);
  });
});

describe('maturityFactor', () => {
  it('penalises very short and very long maturities', () => {
    expect(maturityFactor(10)).toBeLessThan(0.2);
    expect(maturityFactor(200)).toBe(1);
    expect(maturityFactor(1500)).toBeCloseTo(0.5, 5);
  });

  it('ramps up between 30 and 90 days', () => {
    expect(maturityFactor(60)).toBeGreaterThan(maturityFactor(40));
  });
});

describe('scoreMarket', () => {
  it('produces weights that sum to 1', () => {
    const score = scoreMarket(makeMarket(), CTX);
    const total = score.factors.reduce((acc, f) => acc + f.weight, 0);
    expect(total).toBeCloseTo(1, 6);
  });

  it('redistributes weight when history is unavailable', () => {
    const withOut = scoreMarket(makeMarket(), CTX);
    expect(withOut.factors.find((f) => f.key === 'stability')).toBeUndefined();
    const total = withOut.factors.reduce((acc, f) => acc + f.weight, 0);
    expect(total).toBeCloseTo(1, 6);
  });

  it('adds a stability factor when history is present', () => {
    const stable = Array.from({ length: 200 }, (_, i): HistoryPoint => ({
      timestamp: new Date(Date.now() - (200 - i) * 3_600_000).toISOString(),
      impliedApy: 0.11 + (i % 3) * 0.0002,
      ptPrice: 0.98,
      totalTvl: 1,
      underlyingApy: 0.07,
    }));
    const score = scoreMarket(makeMarket(), { ...CTX, historyStats: analyzeHistory(stable, 0.035) });
    const stability = score.factors.find((f) => f.key === 'stability');
    expect(stability).toBeDefined();
    expect(stability!.value).toBeGreaterThan(0.6);
  });

  it('scores a blue-chip stable market above a young volatile one', () => {
    const safe = makeMarket({ protocol: 'Aave', impliedApy: 0.085, liquidityUsd: 40_000_000, categoryIds: ['stables'] });
    const riskyMarket = makeMarket({
      id: '1-0xrisky',
      protocol: 'Totally New Protocol',
      impliedApy: 0.4,
      liquidityUsd: 400_000,
      categoryIds: ['other'],
    });
    expect(scoreMarket(safe, CTX).score).toBeGreaterThan(scoreMarket(riskyMarket, CTX).score);
    expect(scoreMarket(safe, CTX).verdict).toBe('safe');
    expect(scoreMarket(riskyMarket, CTX).verdict).toBe('avoid');
  });
});

describe('decideVerdict', () => {
  it('avoids expired markets', () => {
    const market = makeMarket({ expiry: new Date(Date.now() - 86_400_000).toISOString() });
    const score = scoreMarket(market, CTX);
    expect(score.verdict).toBe('avoid');
    expect(score.flags).toContain('expired');
  });

  it('avoids thin liquidity', () => {
    const score = scoreMarket(makeMarket({ liquidityUsd: 100_000 }), CTX);
    expect(score.verdict).toBe('avoid');
    expect(score.flags).toContain('thin-liquidity');
  });

  it('avoids a severely depegged accounting asset', () => {
    const market = makeMarket({ accountingAsset: { ...makeMarket().accountingAsset, priceUsd: 0.8 } });
    expect(decideVerdict(market, { days: 180, tier: 'A', assetClass: 'stable', spread: 0.05, minLiquidityUsd: 1_000_000, stability: null })).toBe('avoid');
    expect(scoreMarket(market, CTX).flags).toContain('accounting-asset-off-peg');
  });
});

describe('spreadVsBenchmark', () => {
  it('subtracts the benchmark', () => {
    expect(spreadVsBenchmark(makeMarket({ impliedApy: 0.1 }), 0.035)).toBeCloseTo(0.065, 6);
  });
});

describe('stabilityScore', () => {
  it('returns null when there are too few samples', () => {
    expect(stabilityScore({ points: 3, mean: 0.1, min: 0.1, max: 0.1, stddev: 0, coverage: 1, trendPerDay: 0 })).toBeNull();
  });

  it('rewards calm, above-benchmark history', () => {
    const calm = stabilityScore({ points: 500, mean: 0.1, min: 0.099, max: 0.101, stddev: 0.0005, coverage: 1, trendPerDay: 0 });
    const wild = stabilityScore({ points: 500, mean: 0.1, min: 0.01, max: 0.5, stddev: 0.08, coverage: 0.4, trendPerDay: 0 });
    expect(calm).toBeGreaterThan(0.8);
    expect(wild).toBeLessThan(0.3);
  });
});

/**
 * The Method view is generated from these same constants, so this suite is the
 * guard that keeps the user-facing explanation honest.
 */
describe('scoring documentation', () => {
  it('documents every factor, with every field filled in', () => {
    for (const key of FACTOR_ORDER) {
      const doc = FACTOR_DOCS[key];
      expect(doc.key).toBe(key);
      expect(FACTOR_LABELS[key].length).toBeGreaterThan(0);
      expect(SCORE_WEIGHTS[key]).toBeGreaterThan(0);
      expect(doc.question.length).toBeGreaterThan(20);
      expect(doc.method.length).toBeGreaterThan(40);
      expect(doc.why.length).toBeGreaterThan(40);
      expect(doc.caveat.length).toBeGreaterThan(40);
    }
    expect(Object.keys(FACTOR_DOCS).sort()).toEqual([...FACTOR_ORDER].sort());
  });

  it('keeps the base weights summing to 1', () => {
    const total = FACTOR_ORDER.reduce((sum, key) => sum + SCORE_WEIGHTS[key], 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it('quotes the real thresholds in the method text', () => {
    // If someone changes a constant without touching the prose, this fails.
    expect(FACTOR_DOCS.spread.method).toContain(formatPct(SPREAD_SCORE_RANGE.fullAtPct));
    expect(FACTOR_DOCS.liquidity.method).toContain(`$${(LIQUIDITY_SCORE_RANGE.fullAtUsd / 1e6).toFixed(0)}M`);
    expect(FACTOR_DOCS.maturity.method).toContain(String(MATURITY_BANDS.fullFromDays));
    expect(FACTOR_DOCS.maturity.method).toContain(String(MATURITY_BANDS.fullToDays));
    expect(FACTOR_DOCS.stability.method).toContain(String(STABILITY.minSamples));
    expect(FACTOR_DOCS.stability.method).toContain(formatPct(STABILITY.volatilityCap));
  });

  it('explains every verdict using the same bars the scorer applies', () => {
    for (const verdict of ['safe', 'balanced', 'degen', 'avoid'] as const) {
      expect(VERDICT_LABEL[verdict].length).toBeGreaterThan(0);
      expect(VERDICT_RULE[verdict].length).toBeGreaterThan(40);
    }
    expect(VERDICT_RULE.safe).toContain(`$${VERDICT_RULES.safe.minLiquidityUsd / 1e6}M`);
    expect(VERDICT_RULE.safe).toContain(String(VERDICT_RULES.safe.minDays));
    expect(VERDICT_RULE.balanced).toContain(String(VERDICT_RULES.balanced.minDays));
  });

  it('documents every flag the scorer can actually emit', () => {
    const unstable = analyzeHistory(
      Array.from({ length: 100 }, (_, i): HistoryPoint => ({
        timestamp: new Date(Date.now() - (100 - i) * 3_600_000).toISOString(),
        impliedApy: 0.02 + (i % 20) * 0.01,
        ptPrice: 0.98,
        totalTvl: 1000,
        underlyingApy: 0.05,
      })),
      0.035,
    );

    const fixtures: Market[] = [
      makeMarket({ id: '1-0xflags', liquidityUsd: 10_000, categoryIds: ['pt-looping'], info: { ...makeMarket().info, auditedUrl: null, riskInvolved: 'Risky' } }),
      makeMarket({ id: '1-0xsoon', expiry: new Date(Date.now() + 10 * 86_400_000).toISOString() }),
      makeMarket({ id: '1-0xlong', expiry: new Date(Date.now() + 900 * 86_400_000).toISOString() }),
      makeMarket({ id: '1-0xunknown', protocol: 'Zzz Brand New' }),
      // Null both ways: Pendle publishes nothing and the registry has no page yet.
      makeMarket({
        id: '1-0xnoaudit',
        protocol: 'Zzz Brand New',
        info: { ...makeMarket().info, auditedUrl: null },
      }),
      makeMarket({ id: '1-0xyoung', protocol: 'InfiniFi' }),
      makeMarket({ id: '1-0xdead', expiry: new Date(Date.now() - 86_400_000).toISOString() }),
      makeMarket({
        id: '1-0xpeg',
        accountingAsset: makeAsset({ address: '0xusdc', symbol: 'USDC', decimals: 6, priceUsd: 0.95 }),
      }),
    ];

    const emitted = new Set<string>();
    for (const market of fixtures) {
      for (const flag of scoreMarket(market, { ...CTX, historyStats: unstable }).flags) emitted.add(flag);
    }

    expect(emitted.size).toBeGreaterThanOrEqual(9);
    for (const flag of emitted) {
      expect(FLAG_DOCS[flag], `flag "${flag}" has no documentation`).toBeDefined();
    }
  });

  it('states a formula and its limitations', () => {
    expect(SCORE_EXPLAINER.formula).toContain('weight');
    expect(SCORE_EXPLAINER.redFlags.length).toBeGreaterThanOrEqual(3);
  });

  describe('the audit-link flag', () => {
    const ctx = { benchmarkPct: 0.035, minLiquidityUsd: 1_000_000 };

    it('stays silent when the registry links the protocol\u2019s audits', () => {
      const aave = makeMarket({ id: '1-0xaave', protocol: 'Aave', info: { ...makeMarket().info, auditedUrl: null } });
      expect(scoreMarket(aave, ctx).flags).not.toContain('no-audit-link');
    });

    it('fires when neither Pendle nor the registry has a link', () => {
      const unlisted = makeMarket({
        id: '1-0xz',
        protocol: 'ZzZ New Protocol',
        info: { ...makeMarket().info, auditedUrl: null },
      });
      expect(scoreMarket(unlisted, ctx).flags).toContain('no-audit-link');
    });

    it('does not claim the protocol is unaudited', () => {
      // The old text (“Pendle publishes no audit link”) read as “unaudited”, which
      // was wrong: it fired on 100% of markets, including Aave and re.xyz.
      expect(FLAG_DOCS['no-audit-link']).toMatch(/gap in our links/);
      expect(FLAG_DOCS['no-audit-link']).toMatch(/not evidence that no audit exists/);
    });
  });
});
