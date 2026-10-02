/**
 * Popup controller: owns state, talks to the background worker, renders views.
 *
 * Deliberately framework-free. Rendering is a full re-render of the active view
 * (`render()`), except for text inputs, which update state on `input` without a
 * re-render so focus is never stolen.
 */

import type {
  AssetRef,
  Benchmark,
  EntrySimulation,
  ExitSimulation,
  HistoryPoint,
  Market,
  MarketScore,
  MarketSnapshot,
  RollSimulation,
  SensitivityRow,
  Settings,
  FavoriteItem,
} from '../lib/domain/types';
import { CHAINS, STABLE_TOKENS, chainName, chainSlug, marketDeepLink } from '../lib/domain/chains';
import { scoreMarket, spreadVsBenchmark } from '../lib/domain/score';
import { buildProtocolFacts, type ProtocolFacts } from '../lib/domain/protocol';
import { analyzeHistory } from '../lib/domain/history';
import {
  SENSITIVITY_MULTIPLIERS,
  buildEntryRequest,
  buildExitRequest,
  buildRollRequest,
  simulateEntry,
  simulateExit,
  simulateRoll,
} from '../lib/domain/simulate';
import { resolveBenchmark } from '../lib/api/treasury';
import type { AssetClassFilter, Candidate, ScreenFilters, SortKey } from '../lib/domain/screen';
import { candidateFor } from '../lib/domain/screen';
import { findSuccessorMarket, type SuccessorMatch } from '../lib/domain/successor';
import { REDEEM_GAS_UNITS } from '../lib/domain/route';
import { gasCostUsd } from '../lib/domain/simulate';
import { toUnits } from '../lib/util/decimal';
import {
  getBenchmarks,
  getConvert,
  getHistory,
  getMarkets,
} from '../lib/api/client';
import {
  DEFAULT_SETTINGS,
  addFavorite,
  getSettings,
  getSnapshot,
  getFavorites,
  removeFavorite,
  saveSettings,
} from '../lib/storage/store';
import { el, mount, qs } from './dom';
import { SIMULATION_RECEIVER } from './constants';
import { renderDiscover } from './views/discover';
import { renderSimulate } from './views/simulate';
import { renderFavorites } from './views/favorites';
import { renderSettings } from './views/settings';
import { renderDetail } from './views/detail';
import { renderMethod } from './views/method';

export type TabId = 'discover' | 'simulate' | 'favorites' | 'settings';
/** Screening lives in the domain layer so it stays pure and testable. */
export type DiscoverFilters = ScreenFilters;
export type { AssetClassFilter, Candidate, SortKey };

export interface SimResults {
  entry: EntrySimulation | null;
  exit: ExitSimulation | null;
  roll: RollSimulation | null;
  /**
   * Entry into the *selected roll-over destination*, priced with the expected
   * maturity proceeds. This is what "roll at maturity" would cost, because a
   * matured PT redeems at par so the exit leg is free.
   */
  destinationEntry: EntrySimulation | null;
}

export interface SimState {
  marketId: string | null;
  destMarketId: string | null;
  /** Same asset, next expiry — the market you would roll into at maturity. */
  successorMarketId: string | null;
  sizeUsd: number;
  tokenAddress: string | null;
  ptAmount: number | null;
  /** All three scenarios are quoted together so they can be compared. */
  results: SimResults;
  sensitivity: SensitivityRow[];
  error: string | null;
  busy: boolean;
  /** Which scenario is being quoted right now, for progress feedback. */
  progress: string | null;
  quotedAt: string | null;
  nativePriceUsd: number | null;
}

const EMPTY_RESULTS: SimResults = { entry: null, exit: null, roll: null, destinationEntry: null };

export interface AppState {
  settings: Settings;
  favorites: FavoriteItem[];
  snapshot: MarketSnapshot | null;
  benchmarks: Record<string, Benchmark>;
  benchmark: Benchmark;
  scores: Map<string, MarketScore>;
  history: Map<string, HistoryPoint[]>;
  tab: TabId;
  detailMarketId: string | null;
  /** The "how scoring works" explainer is a view, like the market detail. */
  methodOpen: boolean;
  status: { message: string; kind: 'info' | 'error' | 'busy' } | null;
  loading: boolean;
  discover: DiscoverFilters;
  sim: SimState;
}

export function createInitialState(): AppState {
  return {
    settings: { ...DEFAULT_SETTINGS },
    favorites: [],
    snapshot: null,
    benchmarks: {},
    benchmark: resolveBenchmark(null, null),
    scores: new Map(),
    history: new Map(),
    tab: 'discover',
    detailMarketId: null,
    methodOpen: false,
    status: null,
    loading: true,
    discover: { query: '', sort: 'score', minSpreadPct: 0, assetClass: 'all', showHidden: false, chain: 'all' },
    sim: {
      marketId: null,
      destMarketId: null,
      successorMarketId: null,
      sizeUsd: DEFAULT_SETTINGS.defaultSizeUsd,
      tokenAddress: null,
      ptAmount: null,
      results: { ...EMPTY_RESULTS },
      sensitivity: [],
      error: null,
      busy: false,
      progress: null,
      quotedAt: null,
      nativePriceUsd: null,
    },
  };
}

export class App {
  // Initialised eagerly so that a render triggered before `boot()` resolves
  // (e.g. from a storage change event) can never read an undefined state.
  state: AppState = createInitialState();
  private readonly viewEl: HTMLElement;
  private readonly benchEl: HTMLElement;
  private readonly tabsEl: HTMLElement;
  private readonly statusEl: HTMLElement;
  private marketIndex = new Map<string, Market>();
  /** Per-protocol aggregates for the protocol factor; rebuilt with the snapshot. */
  private protocolFacts = new Map<string, ProtocolFacts>();

  constructor(root: HTMLElement) {
    this.viewEl = qs(root, '#view');
    this.benchEl = qs(root, '#bench');
    this.tabsEl = qs(root, '#tabs');
    this.statusEl = qs(root, '#status');
  }

  /* --------------------------------- boot -------------------------------- */

  async boot(): Promise<void> {
    const [settings, favorites, snapshot] = await Promise.all([getSettings(), getFavorites(), getSnapshot()]);
    this.state.settings = settings;
    this.state.favorites = favorites;
    this.state.benchmark = resolveBenchmark(settings.benchmarkOverridePct, null);
    this.state.sim.sizeUsd = settings.defaultSizeUsd;
    if (snapshot) {
      this.state.snapshot = snapshot;
      this.indexMarkets();
      this.recomputeScores();
      this.defaultSimSelection();
    }
    this.render();
    // Use the cache on open; only the ⟳ button forces a network refresh.
    await this.refresh(false);
  }

  /**
   * Adopt a market snapshot: index it, (re)score everything and pick sensible
   * simulator defaults. Kept separate from `refresh()` so it can be driven
   * without network access (see tests/panel.render.test.ts).
   */
  ingestSnapshot(snapshot: MarketSnapshot): void {
    this.state.snapshot = snapshot;
    this.indexMarkets();
    this.recomputeScores();
    this.defaultSimSelection();
  }

  async refresh(force = false): Promise<void> {
    this.setStatus('Loading Pendle markets…', 'busy');
    try {
      const [snapshot, benchmarks] = await Promise.all([
        getMarkets(this.state.settings.chains, force),
        getBenchmarks(force).catch(() => ({}) as Record<string, Benchmark>),
      ]);
      if (Object.keys(benchmarks).length > 0) this.state.benchmarks = benchmarks;
      this.state.benchmark = resolveBenchmark(
        this.state.settings.benchmarkOverridePct,
        this.state.benchmarks['Treasury Notes'] ?? null,
      );
      this.ingestSnapshot(snapshot);
      const count = this.markets().length;
      const expired = snapshot.skippedExpired ?? 0;
      const expiredNote = expired > 0 ? ` · ${expired} expired excluded` : '';
      this.setStatus(`${count} active markets${expiredNote} · updated ${new Date().toLocaleTimeString()}`, 'info');
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      this.state.loading = false;
      this.render();
    }
  }

  /* -------------------------------- lookups ------------------------------ */

  markets(): Market[] {
    return this.state.snapshot?.chains.flatMap((chain) => chain.markets) ?? [];
  }

  /** Every market paired with its score, spread and time to maturity. */
  candidates(): Candidate[] {
    const benchmarkPct = this.state.benchmark.pct;
    return this.markets().map((market) => candidateFor(market, this.scoreFor(market), benchmarkPct));
  }

  marketById(id: string | null | undefined): Market | undefined {
    return id ? this.marketIndex.get(id) : undefined;
  }

  scoreFor(market: Market): MarketScore {
    const existing = this.state.scores.get(market.id);
    if (existing) return existing;
    const computed = scoreMarket(market, {
      benchmarkPct: this.state.benchmark.pct,
      minLiquidityUsd: this.state.settings.minLiquidityUsd,
      historyStats: this.historyStats(market.id),
      protocolFacts: this.protocolFacts,
    });
    this.state.scores.set(market.id, computed);
    return computed;
  }

  spreadFor(market: Market): number {
    return spreadVsBenchmark(market, this.state.benchmark.pct);
  }

  historyStats(marketId: string) {
    const points = this.state.history.get(marketId);
    if (!points) return null;
    return analyzeHistory(points, this.state.benchmark.pct);
  }

  private indexMarkets(): void {
    this.marketIndex = new Map(this.markets().map((market) => [market.id, market]));
  }

  private recomputeScores(): void {
    this.protocolFacts = buildProtocolFacts(this.markets());
    const next = new Map<string, MarketScore>();
    for (const market of this.markets()) {
      next.set(
        market.id,
        scoreMarket(market, {
          benchmarkPct: this.state.benchmark.pct,
          minLiquidityUsd: this.state.settings.minLiquidityUsd,
          historyStats: this.historyStats(market.id),
          protocolFacts: this.protocolFacts,
        }),
      );
    }
    this.state.scores = next;
  }

  private defaultSimSelection(): void {
    const sim = this.state.sim;
    if (!sim.marketId || !this.marketIndex.has(sim.marketId)) {
      const best = this.markets()
        .slice()
        .sort((a, b) => this.scoreFor(b).score - this.scoreFor(a).score)[0];
      if (best) {
        sim.marketId = best.id;
        sim.tokenAddress = this.stableTokensFor(best.chainId)[0]?.address ?? null;
        sim.ptAmount = this.defaultPtAmount(best);
      }
    }
    if (!sim.destMarketId || !this.marketIndex.has(sim.destMarketId)) {
      sim.destMarketId = this.pickDestination(sim.marketId)?.id ?? null;
    }
    sim.ptAmount = sim.ptAmount ?? (this.currentMarket() ? this.defaultPtAmount(this.currentMarket()!) : null);
  }

  /**
   * Default roll-over destination: the best-scoring market on the same chain
   * that shares the source's accounting asset, so the comparison is like for
   * like. Falls back to any same-chain market so the scenario still renders.
   */
  pickDestination(sourceId: string | null): Market | undefined {
    const source = this.marketById(sourceId);
    if (!source) return undefined;
    const sameChain = this.markets().filter((m) => m.id !== source.id && m.chainId === source.chainId);
    const sameAsset = sameChain.filter(
      (m) => m.accountingAsset.address === source.accountingAsset.address && m.accountingAsset.symbol === source.accountingAsset.symbol,
    );
    const pool = sameAsset.length > 0 ? sameAsset : sameChain;
    return pool.sort((a, b) => this.scoreFor(b).score - this.scoreFor(a).score)[0];
  }

  stableTokensFor(chainId: number) {
    return STABLE_TOKENS[chainId] ?? [];
  }

  currentMarket(): Market | undefined {
    return this.marketById(this.state.sim.marketId);
  }

  currentToken(): AssetRef | null {
    const market = this.currentMarket();
    if (!market) return null;
    const address = this.state.sim.tokenAddress ?? this.stableTokensFor(market.chainId)[0]?.address;
    if (!address) return null;
    const match = this.stableTokensFor(market.chainId).find((t) => t.address === address);
    if (!match) return null;
    return {
      id: `${market.chainId}-${match.address}`,
      chainId: market.chainId,
      address: match.address,
      symbol: match.symbol,
      name: match.symbol,
      decimals: match.decimals,
      // Stable input is treated as $1.00; the field label says so.
      priceUsd: 1,
      tags: [],
      expiry: null,
    };
  }

  defaultPtAmount(market: Market): number {
    const price = market.pt.priceUsd ?? 1;
    return price > 0 ? this.state.settings.defaultSizeUsd / price : 0;
  }

  /** Same asset, next expiry: what you would roll into when this one matures. */
  successorMatch(): SuccessorMatch | null {
    const market = this.currentMarket();
    if (!market) return null;
    return findSuccessorMarket(market, this.markets(), {
      minLiquidityUsd: Math.max(this.state.settings.minLiquidityUsd, 250_000),
    });
  }

  successorMarket(): Market | undefined {
    return this.marketById(this.state.sim.successorMarketId);
  }

  /** Gas for a redemption, which cannot be quoted before expiry. */
  redeemGasUsd(): number | null {
    return gasCostUsd(String(REDEEM_GAS_UNITS), this.state.settings.gasPriceGwei, this.state.sim.nativePriceUsd);
  }

  /* -------------------------------- actions ------------------------------ */

  setStatus(message: string | null, kind: 'info' | 'error' | 'busy' = 'info'): void {
    this.state.status = message ? { message, kind } : null;
  }

  setTab(tab: TabId): void {
    this.state.tab = tab;
    this.state.detailMarketId = null;
    this.state.methodOpen = false;
    this.render();
  }

  openDetail(marketId: string): void {
    this.state.detailMarketId = marketId;
    this.state.methodOpen = false;
    this.state.tab = 'discover';
    this.render();
    void this.loadHistory(marketId);
  }

  closeDetail(): void {
    this.state.detailMarketId = null;
    this.render();
  }

  /** The scoring explainer, reachable from Discover and from any market. */
  openMethod(): void {
    this.state.methodOpen = true;
    this.state.detailMarketId = null;
    this.render();
  }

  closeMethod(): void {
    this.state.methodOpen = false;
    this.render();
  }

  openSimulator(marketId: string): void {
    const market = this.marketById(marketId);
    if (!market) return;
    const sim = this.state.sim;
    this.state.tab = 'simulate';
    this.state.detailMarketId = null;
    this.state.methodOpen = false;
    sim.marketId = marketId;
    sim.destMarketId = this.pickDestination(marketId)?.id ?? null;
    sim.successorMarketId = findSuccessorMarket(market, this.markets(), {
      minLiquidityUsd: Math.max(this.state.settings.minLiquidityUsd, 250_000),
    })?.market.id ?? null;
    // Prefer rolling into the successor: same exposure, later expiry.
    if (sim.successorMarketId) sim.destMarketId = sim.successorMarketId;
    sim.tokenAddress = this.stableTokensFor(market.chainId)[0]?.address ?? null;
    sim.ptAmount = this.defaultPtAmount(market);
    sim.results = { ...EMPTY_RESULTS };
    sim.sensitivity = [];
    sim.error = null;
    sim.quotedAt = null;
    this.render();
  }

  async loadHistory(marketId: string, force = false): Promise<void> {
    const market = this.marketById(marketId);
    if (!market) return;
    if (!force && this.state.history.has(marketId)) return;
    try {
      const points = await getHistory(marketId, market.chainId, market.address, force);
      this.state.history.set(marketId, points);
      const score = scoreMarket(market, {
        benchmarkPct: this.state.benchmark.pct,
        minLiquidityUsd: this.state.settings.minLiquidityUsd,
        historyStats: analyzeHistory(points, this.state.benchmark.pct),
        protocolFacts: this.protocolFacts,
      });
      this.state.scores.set(marketId, score);
      this.render();
    } catch (error) {
      this.setStatus(`History unavailable: ${error instanceof Error ? error.message : String(error)}`, 'error');
      this.render();
    }
  }

  async toggleFavorite(market: Market): Promise<void> {
    const exists = this.state.favorites.some((item) => item.marketId === market.id);
    if (exists) {
      this.state.favorites = await removeFavorite(market.id);
      this.setStatus(`Removed ${market.name} from favorites`, 'info');
    } else {
      const item: FavoriteItem = {
        marketId: market.id,
        chainId: market.chainId,
        address: market.address,
        name: market.name,
        protocol: market.protocol,
        expiry: market.expiry,
        addedAt: new Date().toISOString(),
        addedImpliedApy: market.impliedApy,
        addedBenchmarkPct: this.state.benchmark.pct,
      };
      this.state.favorites = await addFavorite(item);
      this.setStatus(`Added to favorites: ${market.name}`, 'info');
    }
    this.render();
  }

  isFavorite(marketId: string): boolean {
    return this.state.favorites.some((item) => item.marketId === marketId);
  }

  async updateSettings(patch: Partial<Settings>): Promise<void> {
    this.state.settings = await saveSettings(patch);
    this.state.benchmark = resolveBenchmark(
      this.state.settings.benchmarkOverridePct,
      this.state.benchmarks['Treasury Notes'] ?? null,
    );
    this.recomputeScores();
    if (patch.defaultSizeUsd !== undefined) this.state.sim.sizeUsd = patch.defaultSizeUsd;
    this.render();
    if (patch.chains) await this.refresh(true);
  }

  /**
   * Quote all three scenarios for the selected market in one pass.
   *
   * Runs sequentially on purpose: each quote costs 5–7 computing units, and a
   * burst of three parallel quotes is how you earn a 429. Entry runs first
   * because the exit and roll legs both use the PT amount it returns, which
   * keeps the three numbers mutually consistent.
   */
  async simulateAll(): Promise<void> {
    const sim = this.state.sim;
    const market = this.currentMarket();
    const token = this.currentToken();
    if (!market) {
      this.setStatus('Pick a market first', 'error');
      this.render();
      return;
    }
    if (!token) {
      this.setStatus('No supported stablecoin for this chain', 'error');
      this.render();
      return;
    }

    const slippage = Math.max(0.001, this.state.settings.slippagePct / 100);
    const sizeUsd = sim.sizeUsd > 0 ? sim.sizeUsd : this.state.settings.defaultSizeUsd;
    const gas = { gasPriceGwei: this.state.settings.gasPriceGwei };

    sim.busy = true;
    sim.error = null;
    sim.results = { ...EMPTY_RESULTS };
    sim.sensitivity = [];
    this.render();

    try {
      // 1. Entry: stablecoin -> PT.
      sim.progress = 'Quoting entry…';
      this.render();
      const entryQuote = await getConvert(
        buildEntryRequest({
          market,
          tokenIn: token,
          amountIn: toUnits(sizeUsd.toFixed(2), token.decimals),
          receiver: SIMULATION_RECEIVER,
          slippage,
        }),
      );
      const entry = simulateEntry({
        market,
        tokenIn: token,
        sizeUsd,
        quote: entryQuote.quote,
        nativePriceUsd: entryQuote.nativePriceUsd,
        ...gas,
      });
      sim.nativePriceUsd = entryQuote.nativePriceUsd;
      sim.ptAmount = entry.ptOut;
      sim.results.entry = entry;
      this.render();

      const ptUnits = toUnits(entry.ptOut.toFixed(6), market.pt.decimals);
      const notionalUsd = entry.ptOut * (market.pt.priceUsd ?? 1);

      // 2. Exit: the same PT back out to the stablecoin.
      sim.progress = 'Quoting exit…';
      this.render();
      try {
        const exitQuote = await getConvert(
          buildExitRequest({
            market,
            tokenOut: token,
            ptAmountUnits: ptUnits,
            receiver: SIMULATION_RECEIVER,
            slippage,
          }),
        );
        sim.results.exit = simulateExit({
          market,
          tokenOut: token,
          ptAmountUnits: ptUnits,
          quote: exitQuote.quote,
          notionalUsd,
          nativePriceUsd: exitQuote.nativePriceUsd,
          ...gas,
        });
      } catch (error) {
        // A single unavailable leg must not lose the other two.
        sim.error = `Exit quote failed: ${error instanceof Error ? error.message : String(error)}`;
      }
      this.render();

      // 3. Roll: the same PT into the destination market.
      const dest = this.marketById(sim.destMarketId);
      if (dest) {
        sim.progress = 'Quoting roll-over…';
        this.render();
        try {
          const rollQuote = await getConvert(
            buildRollRequest({
              source: market,
              dest,
              ptAmountUnits: ptUnits,
              receiver: SIMULATION_RECEIVER,
              slippage,
            }),
          );
          sim.results.roll = simulateRoll({
            source: market,
            dest,
            ptAmountUnits: ptUnits,
            quote: rollQuote.quote,
            notionalUsd,
            nativePriceUsd: rollQuote.nativePriceUsd,
            ...gas,
          });
        } catch (error) {
          sim.error = `Roll-over quote failed: ${error instanceof Error ? error.message : String(error)}`;
        }
      }

      // 4. The maturity plan: buy the destination PT with the redemption
      //    proceeds. Modelled as a fresh entry because PT redeems at par, so
      //    the exit leg of a maturity roll costs nothing.
      const destination = this.marketById(sim.destMarketId);
      if (destination && destination.id !== market.id && entry.valueAtMaturityUsd > 0) {
        sim.progress = 'Quoting the roll-over destination…';
        this.render();
        try {
          const accounting = market.accountingAsset;
          const price = accounting.priceUsd ?? 1;
          const amountIn = toUnits(
            (entry.valueAtMaturityUsd / price).toFixed(Math.min(accounting.decimals, 12)),
            accounting.decimals,
          );
          const destinationQuote = await getConvert(
            buildEntryRequest({
              market: destination,
              tokenIn: accounting,
              amountIn,
              receiver: SIMULATION_RECEIVER,
              slippage,
            }),
          );
          sim.results.destinationEntry = simulateEntry({
            market: destination,
            tokenIn: accounting,
            sizeUsd: entry.valueAtMaturityUsd,
            quote: destinationQuote.quote,
            nativePriceUsd: destinationQuote.nativePriceUsd,
            ...gas,
          });
        } catch (error) {
          sim.error = `Destination quote failed: ${error instanceof Error ? error.message : String(error)}`;
        }
      }

      sim.quotedAt = new Date().toISOString();
      if (!sim.error) this.setStatus('Three quotes received — they are point-in-time estimates', 'info');
    } catch (error) {
      sim.error = error instanceof Error ? error.message : String(error);
      this.setStatus(sim.error, 'error');
    } finally {
      sim.busy = false;
      sim.progress = null;
      this.render();
    }
  }

  /**
   * Sweep the roll-over size to show how *your* order moves the destination
   * market's implied APY. Runs sequentially on purpose: each quote costs
   * computing units and we do not want to burst the API.
   */
  async runSensitivity(): Promise<void> {
    const sim = this.state.sim;
    const source = this.currentMarket();
    const dest = this.marketById(sim.destMarketId);
    if (!source || !dest) return;
    const basePt = sim.ptAmount ?? this.defaultPtAmount(source);
    const baseNotional = basePt * (source.pt.priceUsd ?? 1);
    const slippage = Math.max(0.001, this.state.settings.slippagePct / 100);
    sim.busy = true;
    sim.error = null;
    this.render();

    const rows: SensitivityRow[] = [];
    try {
      for (const multiplier of SENSITIVITY_MULTIPLIERS) {
        const ptAmount = basePt * multiplier;
        const notionalUsd = baseNotional * multiplier;
        this.setStatus(`Quoting ${multiplier}× ($${Math.round(notionalUsd).toLocaleString('en-US')})…`, 'busy');
        this.render();
        const { quote, nativePriceUsd } = await getConvert(
          buildRollRequest({
            source,
            dest,
            ptAmountUnits: toUnits(ptAmount.toFixed(6), source.pt.decimals),
            receiver: SIMULATION_RECEIVER,
            slippage,
          }),
        );
        const roll = simulateRoll({
          source,
          dest,
          ptAmountUnits: toUnits(ptAmount.toFixed(6), source.pt.decimals),
          quote,
          notionalUsd,
          gasPriceGwei: this.state.settings.gasPriceGwei,
          nativePriceUsd,
        });
        rows.push({
          sizeUsd: notionalUsd,
          totalCostUsd: roll.cost.totalUsd,
          totalBps: roll.cost.totalBps,
          effectiveApy: roll.destEffectiveApy,
        });
      }
      sim.sensitivity = rows;
      if (sim.results.roll) sim.results.roll = { ...sim.results.roll, sensitivity: rows };
      this.setStatus('Size sweep complete', 'info');
    } catch (error) {
      sim.error = error instanceof Error ? error.message : String(error);
      sim.sensitivity = rows;
      this.setStatus(sim.error, 'error');
    } finally {
      sim.busy = false;
      this.render();
    }
  }

  marketLink(market: Market): string {
    return marketDeepLink(market.chainId, market.address, 'pt');
  }

  chainLabel(chainId: number): string {
    return chainName(chainId);
  }

  /* --------------------------------- render ------------------------------ */

  render(): void {
    this.renderBench();
    this.renderTabs();
    this.renderStatus();
    const detailId = this.state.detailMarketId;
    if (this.state.methodOpen) {
      mount(this.viewEl, renderMethod(this));
      return;
    }
    if (detailId && this.marketById(detailId)) {
      mount(this.viewEl, renderDetail(this, detailId));
      return;
    }
    switch (this.state.tab) {
      case 'simulate':
        mount(this.viewEl, renderSimulate(this));
        break;
      case 'favorites':
        mount(this.viewEl, renderFavorites(this));
        break;
      case 'settings':
        mount(this.viewEl, renderSettings(this));
        break;
      case 'discover':
      default:
        mount(this.viewEl, renderDiscover(this));
        break;
    }
  }

  private renderBench(): void {
    const bench = this.state.benchmark;
    const sourceLabel = bench.source === 'override' ? 'override' : bench.source === 'fallback' ? 'fallback' : 'US Treasury';
    mount(
      this.benchEl,
      el('span', { class: 'bench-label', text: 'Benchmark' }),
      el('span', { class: 'bench-value', text: `${(bench.pct * 100).toFixed(2)}%` }),
      el('span', { class: 'bench-source', text: sourceLabel, title: bench.label }),
    );
  }

  private renderTabs(): void {
    const tabs: { id: TabId; label: string }[] = [
      { id: 'discover', label: 'Discover' },
      { id: 'simulate', label: 'Simulate' },
      { id: 'favorites', label: `Favorites${this.state.favorites.length ? ` (${this.state.favorites.length})` : ''}` },
      { id: 'settings', label: 'Settings' },
    ];
    mount(
      this.tabsEl,
      ...tabs.map((tab) =>
        el('button', {
          class: `tab ${this.state.tab === tab.id && !this.state.detailMarketId ? 'active' : ''}`,
          text: tab.label,
          dataset: { tab: tab.id },
          on: { click: () => this.setTab(tab.id) },
        }),
      ),
    );
  }

  private renderStatus(): void {
    const status = this.state.status;
    mount(
      this.statusEl,
      status
        ? el('span', { class: `status status-${status.kind}`, text: status.message })
        : el('span', { class: 'status', text: 'Read-only · quotes are estimates' }),
    );
  }
}

export const chainOptions = CHAINS.map((chain) => ({ id: chain.id, name: chain.name, slug: chainSlug(chain.id) }));
