/**
 * Live integration test against the real Pendle + U.S. Treasury APIs.
 *
 * Skipped by default (it hits the network and spends API computing units):
 *
 *   PF_LIVE=1 npm test
 *
 * It exists so that a maintainer can verify, in one command, that the data
 * path still works end to end: markets -> scoring -> history -> real quotes.
 */

import { describe, expect, it } from 'vitest';
import { fetchChainMarkets, fetchHistory, fetchNativePrice, convert } from '../src/lib/api/pendle';
import { fetchTreasuryBenchmarks, resolveBenchmark } from '../src/lib/api/treasury';
import { analyzeHistory, stabilityScore } from '../src/lib/domain/history';
import { findSuccessorMarket } from '../src/lib/domain/successor';
import { describeRoute } from '../src/lib/domain/route';
import { buildMaturityPlan } from '../src/lib/domain/simulate';
import { scoreMarket } from '../src/lib/domain/score';
import { buildEntryRequest, buildExitRequest, buildRollRequest, buildTrajectories, compareScenarios, simulateEntry, simulateExit, simulateRoll } from '../src/lib/domain/simulate';
import { formatPct, formatUsd } from '../src/lib/domain/format';
import type { Market } from '../src/lib/domain/types';
import { toUnits } from '../src/lib/util/decimal';

const LIVE = process.env.PF_LIVE === '1';
const RECEIVER = '0x000000000000000000000000000000000000dEaD';
const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';

describe.skipIf(!LIVE)('live integration', () => {
  it(
    'scores real Ethereum markets against the real Treasury benchmark',
    async () => {
      const [chain, benchmarks] = await Promise.all([fetchChainMarkets(1), fetchTreasuryBenchmarks()]);
      const benchmark = resolveBenchmark(null, benchmarks['Treasury Notes'] ?? null);

      expect(chain.markets.length).toBeGreaterThan(20);
      expect(benchmark.pct).toBeGreaterThan(0);
      expect(benchmark.pct).toBeLessThan(0.15);

      const scored = chain.markets
        .filter((market) => new Date(market.expiry).getTime() > Date.now())
        .map((market) => ({ market, score: scoreMarket(market, { benchmarkPct: benchmark.pct, minLiquidityUsd: 1_000_000 }) }))
        .sort((a, b) => b.score.score - a.score.score);

      const top = scored.slice(0, 10);
      // eslint-disable-next-line no-console
      console.log(
        `benchmark ${(benchmark.pct * 100).toFixed(2)}% (${benchmark.source}, as of ${benchmark.asOf})\n` +
          top
            .map(
              ({ market, score }) =>
                `${String(score.score).padStart(3)} ${score.verdict.padEnd(8)} ${(market.impliedApy * 100).toFixed(
                  2,
                )}% ${market.name} · ${market.underlyingAsset.symbol} · liq $${Math.round(
                  market.liquidityUsd / 1e6,
                )}M · ${market.expiry.slice(0, 10)} [${market.protocol}]`,
            )
            .join('\n'),
      );

      expect(top[0]!.score.score).toBeGreaterThan(50);
      // Every scored market must carry a full, auditable factor breakdown.
      for (const { score } of scored) {
        expect(score.factors.length).toBeGreaterThanOrEqual(5);
        const weight = score.factors.reduce((acc, f) => acc + f.weight, 0);
        expect(weight).toBeCloseTo(1, 6);
      }

      // The v1+v2 merge must actually deliver Pendle's curated risk metadata.
      const withRiskText = chain.markets.filter((m) => m.info.assetDescription || m.info.riskInvolved).length;
      const withProtocols = chain.markets.filter((m) => m.info.utilizedProtocols.length > 0).length;
      // eslint-disable-next-line no-console
      console.log(
        `risk metadata: ${withRiskText}/${chain.markets.length} markets with notes, ${withProtocols} with utilizedProtocols`,
      );
      expect(withRiskText).toBeGreaterThan(chain.markets.length * 0.5);
      expect(withProtocols).toBeGreaterThan(chain.markets.length * 0.5);

      // Pendle never fills `auditedUrl` — verified empty on all 586 markets of
      // Ethereum + Arbitrum — so the registry is the only source of audit links,
      // and the flag must not fire for protocols it does know (re.xyz was the
      // false "no audit link" the user reported).
      const auditedByPendle = chain.markets.filter((m) => m.info.auditedUrl).length;
      const reUsd = chain.markets.find((m) => m.underlyingAsset.symbol === 'reUSD' && m.protocol === 're.xyz');
      // eslint-disable-next-line no-console
      console.log(`audit links: Pendle published ${auditedByPendle}/${chain.markets.length}`);
      expect(auditedByPendle).toBe(0);
      if (reUsd) {
        expect(reUsd.info.auditedUrl).toBeFalsy();
        expect(scoreMarket(reUsd, { benchmarkPct: benchmark.pct, minLiquidityUsd: 1_000_000 }).flags).not.toContain(
          'no-audit-link',
        );
      }
    },
    180_000,
  );

  it(
    'prices a real $50k entry, exit and roll-over',
    async () => {
      const chain = await fetchChainMarkets(1);
      const liquid = chain.markets
        .filter((market) => new Date(market.expiry).getTime() > Date.now() + 60 * 86_400_000 && market.liquidityUsd > 3_000_000)
        .sort((a, b) => b.liquidityUsd - a.liquidityUsd);

      const market = liquid.find((m) => m.accountingAsset.symbol === 'USDC') ?? liquid[0];
      expect(market).toBeDefined();
      const nativePriceUsd = await fetchNativePrice(1);

      // Entry: 50,000 USDC -> PT
      const entryQuote = await convert({
        ...buildEntryRequest({
          market: market as Market,
          tokenIn: {
            id: '1-usdc',
            chainId: 1,
            address: USDC,
            symbol: 'USDC',
            name: 'USDC',
            decimals: 6,
            priceUsd: 1,
            tags: [],
            expiry: null,
          },
          amountIn: toUnits('50000', 6),
          receiver: RECEIVER,
          slippage: 0.01,
        }),
      });
      const entry = simulateEntry({
        market: market as Market,
        tokenIn: {
          id: '1-usdc',
          chainId: 1,
          address: USDC,
          symbol: 'USDC',
          name: 'USDC',
          decimals: 6,
          priceUsd: 1,
          tags: [],
          expiry: null,
        },
        sizeUsd: 50_000,
        quote: entryQuote,
        gasPriceGwei: 5,
        nativePriceUsd,
      });

      expect(entry.ptOut).toBeGreaterThan(0);
      expect(entry.ptPriceUsd).toBeGreaterThan(0);
      expect(entry.cost.totalBps).toBeGreaterThanOrEqual(0);
      expect(entry.cost.totalBps).toBeLessThan(300);

      // Exit the exact PT amount we just bought.
      const exitQuote = await convert({
        ...buildExitRequest({
          market: market as Market,
          tokenOut: {
            id: '1-usdc',
            chainId: 1,
            address: USDC,
            symbol: 'USDC',
            name: 'USDC',
            decimals: 6,
            priceUsd: 1,
            tags: [],
            expiry: null,
          },
          ptAmountUnits: toUnits(entry.ptOut.toFixed(6), (market as Market).pt.decimals),
          receiver: RECEIVER,
          slippage: 0.01,
        }),
      });
      const exitOut = Number(exitQuote.outputs[0]?.amount ?? '0') / 1e6;
      expect(exitOut).toBeGreaterThan(0);
      expect(exitOut).toBeLessThanOrEqual(50_000 * 1.15);
      const exit = simulateExit({
        market: market as Market,
        tokenOut: {
          id: '1-usdc',
          chainId: 1,
          address: USDC,
          symbol: 'USDC',
          name: 'USDC',
          decimals: 6,
          priceUsd: 1,
          tags: [],
          expiry: null,
        },
        ptAmountUnits: toUnits(entry.ptOut.toFixed(6), (market as Market).pt.decimals),
        quote: exitQuote,
        notionalUsd: entry.ptOut * ((market as Market).pt.priceUsd ?? 1),
        gasPriceGwei: 5,
        nativePriceUsd,
      });

      // Roll the same position into a different market with the same collateral.
      const destination = liquid.find((m) => m.id !== market!.id && m.accountingAsset.symbol === (market as Market).accountingAsset.symbol);
      let roll: ReturnType<typeof simulateRoll> | null = null;
      if (destination) {
        const rollQuote = await convert({
          ...buildRollRequest({
            source: market as Market,
            dest: destination,
            ptAmountUnits: toUnits(entry.ptOut.toFixed(6), (market as Market).pt.decimals),
            receiver: RECEIVER,
            slippage: 0.01,
          }),
        });
        roll = simulateRoll({
          source: market as Market,
          dest: destination,
          ptAmountUnits: toUnits(entry.ptOut.toFixed(6), (market as Market).pt.decimals),
          quote: rollQuote,
          // Current market value of the source PT, not its maturity value.
          notionalUsd: entry.ptOut * ((market as Market).pt.priceUsd ?? 1),
          gasPriceGwei: 5,
          nativePriceUsd,
        });
        expect(roll.destPtOut).toBeGreaterThan(0);
      }

      // The combined view the panel renders: three comparable scenarios plus the
      // value trajectory. This is the whole point of the feature, so assert it
      // holds together on live numbers.
      const scenarios = compareScenarios({ entry, exit, roll });
      const trajectories = buildTrajectories({ entry, exit, roll });
      expect(scenarios.map((s) => s.id)).toEqual(roll ? ['hold', 'exit', 'roll'] : ['hold', 'exit']);
      expect(trajectories.series[0]!.points).toHaveLength(25);
      expect(trajectories.costBasisUsd).toBe(50_000);
      expect(trajectories.exitTodayUsd).toBeCloseTo(exit.proceedsUsd, 6);
      for (const scenario of scenarios) {
        expect(Number.isFinite(scenario.endValueUsd)).toBe(true);
        expect(Number.isFinite(scenario.profitUsd)).toBe(true);
      }
      if (roll) expect(trajectories.series).toHaveLength(2);

      // eslint-disable-next-line no-console
      console.log(
        scenarios
          .map(
            (s) =>
              `${s.label}: ${s.apy === null ? 'realised' : `${(s.apy * 100).toFixed(2)}%`} · ends ${s.endValueUsd.toFixed(
                0,
              )} · profit ${s.profitUsd.toFixed(0)} · cost ${s.cost.totalUsd.toFixed(2)} (${s.cost.totalBps.toFixed(
                1,
              )} bps) · ${Math.round(s.days)}d`,
          )
          .join('\n'),
      );
    },
    180_000,
  );

  it(
    'prices the maturity plan and reconstructs the fee from market parameters',
    async () => {
      const chain = await fetchChainMarkets(1);
      const market = chain.markets
        .filter((m) => new Date(m.expiry).getTime() > Date.now() + 30 * 86_400_000 && m.accountingAsset.symbol === 'USDC' && m.liquidityUsd > 5_000_000)
        .sort((a, b) => b.liquidityUsd - a.liquidityUsd)[0];
      expect(market).toBeDefined();

      const token: Parameters<typeof convert>[0] extends never ? never : import('../src/lib/domain/types').AssetRef = {
        id: '1-usdc',
        chainId: 1,
        address: USDC,
        symbol: 'USDC',
        name: 'USDC',
        decimals: 6,
        priceUsd: 1,
        tags: [],
        expiry: null,
      };
      const nativePriceUsd = await fetchNativePrice(1);

      const entryQuote = await convert(
        buildEntryRequest({ market: market!, tokenIn: token, amountIn: toUnits('50000', 6), receiver: RECEIVER, slippage: 0.01 }),
      );
      const entry = simulateEntry({ market: market!, tokenIn: token, sizeUsd: 50_000, quote: entryQuote, gasPriceGwei: 5, nativePriceUsd });

      // The fee reconstruction must explain the SDK's own fee number.
      const breakdown = describeRoute({
        quote: entryQuote,
        market: market!,
        counterAsset: token,
        notionalUsd: entry.sizeUsd,
        gasPriceGwei: 5,
        nativePriceUsd,
      });
      expect(breakdown.legs).toHaveLength(2);
      expect(breakdown.fee.reportedUsd).not.toBeNull();
      expect(breakdown.fee.derivedUsd).not.toBeNull();
      const feeError = Math.abs(breakdown.fee.deltaUsd!) / breakdown.fee.reportedUsd!;
      // Within 5% (limit-order fills can shift it slightly).
      expect(feeError).toBeLessThan(0.05);

      // Successor detection plus a purchase sized at the maturity proceeds.
      const match = findSuccessorMarket(market!, chain.markets);
      let plan = buildMaturityPlan({ entry, redeemGasUsd: 1 });
      expect(plan.map((o) => o.id)).toEqual(['redeem']);

      if (match) {
        const successorQuote = await convert(
          buildEntryRequest({
            market: match.market,
            tokenIn: market!.accountingAsset,
            amountIn: toUnits(entry.valueAtMaturityUsd.toFixed(6), market!.accountingAsset.decimals),
            receiver: RECEIVER,
            slippage: 0.01,
          }),
        );
        const successorEntry = simulateEntry({
          market: match.market,
          tokenIn: market!.accountingAsset,
          sizeUsd: entry.valueAtMaturityUsd,
          quote: successorQuote,
          gasPriceGwei: 5,
          nativePriceUsd,
        });
        plan = buildMaturityPlan({ entry, successor: match.market, successorEntry, redeemGasUsd: 1 });
        expect(plan.map((o) => o.id)).toEqual(['redeem', 'roll-at-maturity']);
        expect(plan[1]!.totalDays).toBeGreaterThan(entry.daysToMaturity);
      }

      // eslint-disable-next-line no-console
      console.log(
        `\n${market!.underlyingAsset.symbol} · fee reported $${breakdown.fee.reportedUsd!.toFixed(2)} vs derived $${breakdown.fee.derivedUsd!.toFixed(2)} ` +
          `(${(feeError * 100).toFixed(2)}% off, ${breakdown.fee.legs.length} AMM leg) · route ${breakdown.legs.map((l) => l.venue.split(' ')[0]).join(' > ')}\n` +
          plan
            .map(
              (o) =>
                `  ${o.label.padEnd(46)} cost@maturity ${formatUsd(o.actionCostUsd).padStart(9)} · ends ${formatUsd(o.endValueUsd).padStart(9)} · ${String(Math.round(o.totalDays)).padStart(4)}d · net ${o.netProfitUsd.toFixed(0).padStart(6)} · ${formatPct(o.netApy)}`,
            )
            .join('\n'),
      );
    },
    180_000,
  );

  it(
    'computes history stability for a real market',
    async () => {
      const chain = await fetchChainMarkets(1);
      const market = chain.markets
        .filter((m) => new Date(m.expiry).getTime() > Date.now() && m.liquidityUsd > 5_000_000)
        .sort((a, b) => b.liquidityUsd - a.liquidityUsd)[0];
      expect(market).toBeDefined();

      const points = await fetchHistory(1, market!.address);
      expect(points.length).toBeGreaterThan(100);
      const stats = analyzeHistory(points, 0.035);
      expect(stats.points).toBeGreaterThan(100);
      expect(stats.coverage).not.toBeNull();
      // eslint-disable-next-line no-console
      console.log(
        `history ${market!.name}: n=${stats.points} mean=${((stats.mean ?? 0) * 100).toFixed(2)}% σ=${((stats.stddev ?? 0) * 100).toFixed(
          2,
        )}% coverage=${((stats.coverage ?? 0) * 100).toFixed(0)}% stability=${stabilityScore(stats)?.toFixed(2)}`,
      );
    },
    120_000,
  );
});
