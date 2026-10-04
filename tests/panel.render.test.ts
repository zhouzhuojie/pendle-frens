/**
 * @vitest-environment jsdom
 *
 * Renders every view in a real DOM. This is the test that catches DOM-helper
 * regressions (argument spreading, <option selected>, missing containers)
 * without needing a browser.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { App, type AppState } from '../src/panel/app';
import { DEFAULT_SETTINGS } from '../src/lib/storage/store';
import { resolveBenchmark } from '../src/lib/api/treasury';
import type { EntrySimulation, ExitSimulation, HistoryPoint, MarketSnapshot, RollSimulation, FavoriteItem } from '../src/lib/domain/types';
import { makeAsset, makeMarket, makeQuote, makeRoute } from './fixtures';

const marketA = makeMarket({
  id: '1-0xa',
  address: '0xa',
  name: 'reUSD market',
  protocol: 're.xyz',
  points: [{ key: 'Asseto', type: 'multiplier', pendleAsset: 'basic', value: 40, perDollarLp: null }],
  yieldRange: { min: 0.09, max: 0.28 },
  ytBreakdown: {
    categories: [{ label: 'Protocol Yield', apy: 0.117, items: [{ id: '1-0xsy', apy: 0.117, tags: ['INTEREST', 'AUTO'], source: null }] }],
  },
});
const marketB = makeMarket({
  id: '1-0xb',
  address: '0xb',
  name: 'sUSDS market',
  protocol: 'Sky Protocol',
  categoryIds: ['stables'],
  impliedApy: 0.048,
  liquidityUsd: 7_000_000,
});

/** Expired on purpose: Discover must report it as hidden, not silently drop it. */
const marketExpired = makeMarket({
  id: '1-0xexpired',
  address: '0xexpired',
  name: 'Old USDai market',
  protocol: 'USD.ai',
  categoryIds: ['stables'],
  impliedApy: 0.09,
  liquidityUsd: 40_000_000,
  expiry: new Date(Date.now() - 5 * 86_400_000).toISOString(),
});

const snapshot: MarketSnapshot = {
  fetchedAt: new Date().toISOString(),
  chains: [{ chainId: 1, fetchedAt: new Date().toISOString(), markets: [marketA, marketB, marketExpired] }],
};

const history: HistoryPoint[] = Array.from({ length: 60 }, (_, i) => ({
  timestamp: new Date(Date.now() - (60 - i) * 3_600_000).toISOString(),
  impliedApy: 0.11 + Math.sin(i / 5) * 0.002,
  ptPrice: 0.979,
  totalTvl: 1_000_000,
  underlyingApy: 0.07,
}));

function makeState(): AppState {
  const favorites: FavoriteItem[] = [
    {
      marketId: marketA.id,
      chainId: 1,
      address: marketA.address,
      name: marketA.name,
      protocol: marketA.protocol,
      expiry: marketA.expiry,
      addedAt: new Date().toISOString(),
      addedImpliedApy: 0.1,
      addedBenchmarkPct: 0.035,
    },
  ];
  return {
    settings: { ...DEFAULT_SETTINGS },
    favorites,
    snapshot,
    benchmarks: {},
    benchmark: resolveBenchmark(null, null),
    scores: new Map(),
    history: new Map([[marketA.id, history]]),
    extras: new Map(),
    tab: 'discover',
    detailMarketId: null,
    methodOpen: false,
    status: null,
    loading: false,
    discover: { query: '', sort: 'score', minSpreadPct: 0, assetClass: 'all', showHidden: false, chain: 'all' },
    sim: {
      marketId: marketA.id,
      destMarketId: marketB.id,
      successorMarketId: marketB.id,
      sizeUsd: 50_000,
      tokenAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      ptAmount: 51_057,
      results: { entry: null, exit: null, roll: null, destinationEntry: null },
      sensitivity: [],
      error: null,
      busy: false,
      progress: null,
      quotedAt: null,
      nativePriceUsd: 2710,
    },
  };
}

const entryResult: EntrySimulation = {
  kind: 'entry',
  marketId: marketA.id,
  quote: makeQuote(),
  sizeUsd: 50_000,
  tokenIn: { id: '1-usdc', chainId: 1, address: '0xusdc', symbol: 'USDC', name: 'USDC', decimals: 6, priceUsd: 1, tags: [], expiry: null },
  ptOut: 51_057.86,
  ptPriceUsd: 0.9793,
  valueAtMaturityUsd: 51_057.86,
  profitAtMaturityUsd: 1_057.86,
  simpleApy: 0.0428,
  effectiveApy: 0.1132,
  impliedApyMarket: 0.115,
  impliedApyAfterTrade: 0.1150076,
  impactBps: -0.52,
  daysToMaturity: 72,
  breakEvenDays: 3.2,
  cost: { notionalUsd: 50_000, protocolFeeUsd: 20.1, priceImpactUsd: 21, gasUsd: 14.8, totalUsd: 55.9, totalBps: 11.2 },
};

const exitResult: ExitSimulation = {
  kind: 'exit',
  marketId: marketA.id,
  quote: makeQuote({ outputs: [{ token: '0xusdc', amount: '49936400000' }], action: 'swap' }),
  ptIn: 51_057.86,
  notionalUsd: 49_980,
  tokenOut: { id: '1-usdc', chainId: 1, address: '0xusdc', symbol: 'USDC', name: 'USDC', decimals: 6, priceUsd: 1, tags: [], expiry: null },
  amountOut: 49_936.4,
  proceedsUsd: 49_936.4,
  effectiveApy: 0.1162,
  impliedApyAfterTrade: 0.1159,
  cost: { notionalUsd: 49_980, protocolFeeUsd: 22.2, priceImpactUsd: 36.5, gasUsd: 10.4, totalUsd: 69.1, totalBps: 13.8 },
};

const rollResult: RollSimulation = {
  kind: 'roll',
  quote: makeQuote({
    action: 'roll-over-pt',
    outputs: [{ token: '0xpt', amount: '50412700000' }],
    route: makeRoute({ method: 'callAndReflect', composedSelectors: ['0x594a88cc', '0xc81f847a'], swapType: '1' }),
  }),
  sourceMarketId: marketA.id,
  destMarketId: marketB.id,
  destLabel: 'sUSDS market · sUSDS',
  ptIn: 51_057.86,
  notionalUsd: 49_980,
  destPtOut: 50_412.7,
  destPtPriceUsd: 0.9914,
  destPtMarketPriceUsd: 0.993,
  destParValueUsd: 50_412.7,
  destDaysToMaturity: 149,
  destHeadlineApy: 0.1084,
  destEffectiveApy: 0.1049,
  dragBps: -35,
  cost: { notionalUsd: 49_980, protocolFeeUsd: 25.3, priceImpactUsd: 152, gasUsd: 6.1, totalUsd: 183.4, totalBps: 36.7 },
  sensitivity: [
    { sizeUsd: 12_495, totalCostUsd: 31, totalBps: 24.8, effectiveApy: 0.1068 },
    { sizeUsd: 49_980, totalCostUsd: 183.4, totalBps: 36.7, effectiveApy: 0.1049 },
    { sizeUsd: 249_900, totalCostUsd: 1_420, totalBps: 56.8, effectiveApy: 0.0991 },
  ],
};

let app: App;
let view: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = `
    <div id="app">
      <div id="bench"></div>
      <nav id="tabs"></nav>
      <main id="view"></main>
      <div id="status"></div>
    </div>`;
  app = new App(document.getElementById('app') as HTMLElement);
  app.state = makeState();
  app.ingestSnapshot(snapshot);
  view = document.getElementById('view') as HTMLElement;
});

describe('side panel rendering', () => {
  it('renders the Discover list with a card per visible market', () => {
    app.render();
    expect(view.querySelectorAll('.card').length).toBe(2);
    expect(view.textContent).toContain('reUSD market');
    expect(view.textContent).toContain('sUSDS market');
    // Tabs and benchmark chrome are populated too.
    expect(document.querySelectorAll('#tabs .tab').length).toBe(4);
    expect(document.getElementById('bench')!.textContent).toContain('Benchmark');
  });

  it('explains which markets it hid, and can reveal them on request', () => {
    app.render();
    expect(view.textContent).toContain('Showing 2 of 3 markets');
    expect(view.textContent).toContain('Hidden: 1 expired');
    expect(view.textContent).not.toContain('Old USDai market');

    (view.querySelector('.callout .btn') as HTMLButtonElement).click();

    expect(app.state.discover.showHidden).toBe(true);
    expect(view.textContent).toContain('Showing everything');
    expect(view.textContent).toContain('Old USDai market');
    expect(view.querySelectorAll('.card').length).toBe(3);
  });

  it('shows the score once per card, with no duplicate progress bar', () => {
    app.render();
    // The card used to render the composite score twice: as a number and again
    // as a bar with the same value. One representation, colour-coded by verdict.
    expect(view.querySelectorAll('.card').length).toBe(2);
    expect(view.querySelectorAll('.card .scoreblock').length).toBe(2);
    expect(view.querySelector('.scorebar')).toBeNull();
  });

  it('renders the Simulate view and preselects the current market', () => {
    app.state.tab = 'simulate';
    app.render();
    const select = view.querySelector('select') as HTMLSelectElement;
    expect(select).not.toBeNull();
    expect(select.value).toBe(marketA.id);
    // The option elements must carry `selected`, not `checked`.
    const selected = Array.from(select.options).filter((o) => o.selected);
    expect(selected).toHaveLength(1);
    expect(selected[0]!.value).toBe(marketA.id);
  });

  it('keeps the forensics behind disclosures instead of stacked under the answer', () => {
    app.state.tab = 'simulate';
    app.state.sim.results = { entry: entryResult, exit: exitResult, roll: rollResult, destinationEntry: null };
    app.render();

    const disclosures = [...view.querySelectorAll('details.disclosure')];
    const titles = disclosures.map((d) => d.querySelector('.disclosure-title')!.textContent);
    expect(titles).toEqual([
      'Assumptions behind these quotes',
      'How these options are calculated',
      'Full cost breakdown',
      'Where the fee and the price impact come from',
      'Roll-over size sensitivity',
    ]);
    // Collapsed by default: the page opens on the answer, not on the derivation.
    for (const d of disclosures) expect(d.hasAttribute('open')).toBe(false);

    // A collapsed block still states what is inside it, so nothing is hidden
    // behind a click without a visible reason to click.
    expect(disclosures[2]!.querySelector('.disclosure-summary')!.textContent).toContain('all in');
    expect(disclosures[3]!.querySelector('.disclosure-summary')!.textContent).toMatch(/bps to enter/);

    // The deep numbers really are inside one, not loose on the page...
    expect(view.querySelector('.route')!.closest('details.disclosure')).not.toBeNull();
    expect(view.querySelector('.bar-row')!.closest('details.disclosure')).not.toBeNull();
    // ...while the answer, the maturity decision and the chart stay open.
    expect(view.querySelector('.scenarios')!.closest('details')).toBeNull();
    expect(view.querySelector('.plan-table')!.closest('details')).toBeNull();
    expect(view.querySelector('svg.chart-svg')!.closest('details')).toBeNull();

    // And each option in the headline grid carries one visible answer, not a
    // paragraph of prose. The reasoning lives in the maturity plan.
    const card = view.querySelector('.scenario')!;
    expect(card.querySelector('.scenario-apy')!.textContent).toMatch(/%|realised/);
    expect(card.querySelectorAll('.scenario-row').length).toBe(3);
  });

  it('renders a simulated entry result with a full cost breakdown', () => {
    app.state.tab = 'simulate';
    app.state.sim.results = { entry: entryResult, exit: null, roll: null, destinationEntry: null };
    app.render();
    expect(view.textContent).toContain('Entry —');
    expect(view.textContent).toContain('Cost breakdown');
    expect(view.textContent).toContain('Protocol swap fee');
    expect(view.textContent).toContain('11.32%');
  });

  it('compares all three scenarios, charts the value path and compares costs', () => {
    app.state.tab = 'simulate';
    app.state.sim.results = { entry: entryResult, exit: exitResult, roll: rollResult, destinationEntry: null };
    app.render();

    // Three scenario cards, each with an annualised rate.
    expect(view.querySelectorAll('.scenario').length).toBe(3);
    expect(view.textContent).toContain('Three ways to play');
    expect(view.textContent).toContain('Exit today');
    expect(view.textContent).toContain('Roll to');

    // Value trajectory chart: one polyline per scenario, plus reference lines.
    const lines = view.querySelectorAll('svg.chart-svg polyline');
    expect(view.querySelector('svg.chart-svg')).not.toBeNull();
    expect(lines.length).toBe(2);
    expect(view.querySelectorAll('.chart-swatch').length).toBeGreaterThanOrEqual(4);

    // Cost comparison bars and the assumption disclosure.
    expect(view.querySelectorAll('.bar-row').length).toBe(3);
    expect(view.textContent).toContain('Assumptions behind these quotes');
    expect(view.textContent).toContain('Roll-over size sensitivity');
  });

  it('prices the maturity options and shows route forensics for every quote', () => {
    app.state.tab = 'simulate';
    app.state.sim.results = { entry: entryResult, exit: exitResult, roll: rollResult, destinationEntry: null };
    app.render();

    // Maturity plan: what you would do when this PT matures.
    expect(view.textContent).toContain('What happens when it matures');
    expect(view.textContent).toContain('Redeem at par and stop');
    expect(view.textContent).toContain('Roll over today instead');
    expect(view.querySelectorAll('.plan-table tbody tr').length).toBeGreaterThanOrEqual(2);
    // The redeem option is modelled, not quoted, and says so.
    expect(view.querySelector('.plan-redeem')!.textContent).toContain('modelled');

    // Route forensics: one block per quote, with the fee derivation spelled out.
    expect(view.textContent).toContain('Where the fee and the price impact come from');
    expect(view.querySelectorAll('.route').length).toBe(3);
    expect(view.querySelectorAll('.route-table').length).toBe(3);
    expect(view.textContent).toContain('Price impact — total');
    expect(view.textContent).toContain('internal — Pendle AMM curve');
    expect(view.textContent).toContain('external — aggregator');
    expect(view.textContent).toContain('feeRate');
    expect(view.textContent).toContain('daysToMaturity / 365');
    expect(view.textContent).toContain('reported by the SDK');
    // The roll-over block names both legs of the composed call.
    expect(view.textContent).toContain('swapExactPtForToken');
    expect(view.textContent).toContain('swapExactTokenForPt');
  });

  it('explains how the score is computed', () => {
    app.openMethod();
    expect(view.textContent).toContain('How the risk-adjusted score works');
    for (const dimension of [
      'Spread vs benchmark',
      'Exit liquidity',
      'Protocol depth',
      'Maturity fit',
      'Collateral quality',
      'Yield stability',
    ]) {
      expect(view.textContent).toContain(dimension);
    }
    // The explainer must state how each factor is computed and what it misses.
    expect(view.querySelectorAll('.factor-doc').length).toBe(6);
    expect(view.textContent).toContain('How it scores');
    expect(view.textContent).toContain('What it cannot see');
    expect(view.textContent).toContain('How a verdict is assigned');
    expect(view.textContent).toContain('What this score is not');
  });

  it('renders Favorites with the added-vs-now spread and drift', () => {
    app.state.tab = 'favorites';
    app.render();
    expect(view.textContent).toContain('reUSD market');
    expect(view.textContent).toContain('Change since added');
    // Spread is compared against the benchmark captured when it was starred.
    expect(view.textContent).toContain('was +6.50% at 3.50%');
  });

  it('renders Settings with the active benchmark and data sources', () => {
    app.state.tab = 'settings';
    app.render();
    expect(view.textContent).toContain('Chains to scan');
    expect(view.textContent).toContain('Active benchmark');
    expect(view.textContent).toContain('Pendle hosted API');
  });

  it('labels every filter control', () => {
    app.render();
    // An unlabelled select is a guessing game: every control states what it is.
    const labels = [...view.querySelectorAll('.field-label')].map((node) => node.textContent);
    expect(labels).toEqual(['Search', 'Sort by', 'Chain', 'Collateral', 'Min spread, pp']);
    for (const label of labels) {
      expect(view.textContent).toContain(label!);
    }
  });

  it('does not repeat global boilerplate on every card', () => {
    app.render();
    // "risk-adjusted" used to appear under every score, and the benchmark under
    // every spread. Both are stated once, above the list.
    expect(view.textContent).not.toContain('risk-adjusted');
    expect(view.textContent).not.toContain('locked at entry');
    const benchmarkMentions = view.textContent!.split('Treasury Notes').length - 1;
    expect(benchmarkMentions).toBe(1);
    expect(view.querySelector('.results-line')!.textContent).toContain('markets');
  });

  it('says a link is missing, not that the protocol is unaudited', () => {
    const noLink = makeMarket({
      id: '1-0xnoaudit',
      address: '0xnoaudit',
      protocol: 'ZzZ New Protocol',
      info: { ...makeMarket().info, auditedUrl: null },
    });
    app.ingestSnapshot({
      fetchedAt: new Date().toISOString(),
      chains: [{ chainId: 1, fetchedAt: new Date().toISOString(), markets: [noLink] }],
      skippedExpired: 0,
    });
    app.state.detailMarketId = noLink.id;
    app.render();
    expect(view.textContent).toContain('No audit link on file');
    expect(view.textContent).toContain('not proof that no audit exists');
  });

  it('gives every control in every view a visible label', () => {
    // A placeholder is not a label: it vanishes as soon as you type, and a
    // `title` tooltip needs a pointer. This walks every rendered view.
    let total = 0;
    for (const tab of ['discover', 'favorites', 'settings', 'simulate'] as const) {
      app.state.tab = tab;
      app.render();
      const controls = [...view.querySelectorAll('select, input')];
      total += controls.length;
      for (const control of controls) {
        const labelled =
          control.closest('label')?.textContent?.trim() ||
          control.getAttribute('aria-label') ||
          control.closest('.field')?.querySelector('.field-label')?.textContent;
        expect(labelled, `${tab}: unlabelled ${control.outerHTML.slice(0, 90)}`).toBeTruthy();
      }
    }
    // Guards against the sweep silently passing because nothing rendered.
    expect(total).toBeGreaterThan(8);
  });

  it('renders the market detail view with a history chart and risk notes', () => {
    app.render();
    app.state.detailMarketId = marketA.id;
    app.render();
    expect(view.textContent).toContain('Yield history');
    expect(view.textContent).toContain('Why this score');
    expect(view.textContent).toContain('Risk notes');
    expect(view.querySelector('svg.sparkline')).not.toBeNull();
    expect(view.textContent).toContain('Accounting asset');
    // The protocol factor is explained as a measurement, and the app states
    // plainly that it makes no protocol-level judgement.
    expect(view.textContent).toContain('Protocol depth — measured, not judged');
    expect(view.textContent).toContain('size and breadth, never trust');
  });

  it('names the tranche the ticker spells out, and never guesses one from an unmarked pair', () => {
    const market = (symbol: string) =>
      makeMarket({
        id: `1-0x${symbol.toLowerCase()}`,
        address: `0x${symbol.toLowerCase()}`,
        name: `${symbol} market`,
        protocol: 're.xyz',
        underlyingAsset: makeAsset({
          id: `1-0x${symbol.toLowerCase()}`,
          address: `0x${symbol.toLowerCase()}`,
          symbol,
        }),
      });
    const senior = market('srUSDe');
    const junior = market('jrUSDe');
    const variant = market('reUSDe');
    app.ingestSnapshot({
      ...snapshot,
      chains: [{ ...snapshot.chains[0]!, markets: [senior, junior, variant, market('reUSD')] }],
    });

    app.state.detailMarketId = senior.id;
    app.render();
    expect(view.textContent).toContain('Senior tranche');
    // The chip quotes the ticker and names the leg that confirms the convention.
    expect(view.querySelector('.chip-muted[title*="From the ticker \u201csr\u201d"]')).not.toBeNull();
    expect(view.querySelector('.chip-muted[title*="opposite leg jrUSDe"]')).not.toBeNull();

    // reUSDe shares a base with reUSD but encodes no position: the note stays a
    // statement about the names.
    app.state.detailMarketId = variant.id;
    app.render();
    expect(view.textContent).toContain('name variant of reUSD');
    expect(view.textContent).not.toContain('Junior tranche');
  });

  it('opens the detail page on the decision, not a wall of metrics', () => {
    app.render();
    app.state.detailMarketId = marketA.id;
    app.render();

    // The answer comes first: the headline, the payout, and the two cases.
    expect(view.querySelector('.decision-headline')!.textContent).toContain('Lock 11.50%');
    expect(view.textContent).toContain('Why it could work');
    expect(view.textContent).toContain('What to watch');
    expect(view.textContent).toContain('What you would get at maturity');
    expect(view.textContent).toContain('Est. cost to enter');

    // The two cases are real, populated lists, not empty headings.
    expect(view.querySelectorAll('.case-for .case-list li').length).toBeGreaterThan(0);
    expect(view.querySelectorAll('.case-against .case-list li').length).toBeGreaterThan(0);

    // Raw market data is still here, but demoted behind a disclosure.
    const titles = [...view.querySelectorAll('details.disclosure .disclosure-title')].map((n) => n.textContent);
    expect(titles).toContain('Market data & contracts');
    expect(titles).toContain('More history statistics');
  });

  it('adds yield provenance, leverage and the order book once the extras load', () => {
    app.state.detailMarketId = marketA.id;
    app.state.extras.set(marketA.id, {
      loading: false,
      errors: [],
      longHistory: Array.from({ length: 30 }, (_, i) => ({
        timestamp: new Date(Date.now() - (30 - i) * 86_400_000).toISOString(),
        impliedApy: 0.1 + i / 1000,
        ptPrice: 0.98,
        totalTvl: 1,
        underlyingApy: 0.07,
      })),
      book: {
        long: [{ impliedApy: 0.091, limitOrderSize: '91779259', ammSize: '0' }],
        short: [{ impliedApy: 0.092, limitOrderSize: '0', ammSize: '900' }],
      },
      live: { impliedApy: 0.117, ptPerUnderlying: 1.02, underlyingPerPt: 0.98 },
      loop: [
        {
          chainId: 1,
          protocol: 'Morpho',
          moneyMarketName: 'Morpho',
          moneyMarketAddress: '0xmm',
          url: null,
          marketUrl: null,
          debtSymbol: 'USDC',
          debtDecimals: 6,
          lltv: 0.915,
          borrowApy: 0.047,
          borrowApy7dAvg: 0.0486,
          maxLeverage: 8.89,
          liquidityUsd: 98_874,
          totalSupplyUsd: 1_280_572,
          supplyCapUsd: null,
          maxApy: 0.0867,
          reference: { positionUsd: 50_000, leverage: 8.89, fixedApy: 0.084, borrowApy: 0.0837 },
          utilization: 0.913,
          risks: {
            overallLabel: 'Overall Medium Risk',
            overallLevel: 'low',
            items: [{ name: 'PT Price', label: 'No Risk', level: 'none', summary: 'Linear oracle.', rationale: null }],
            ptOracleType: 'linear',
            debtOracleType: 'marketPrice',
          },
        },
      ],
    });
    app.render();

    expect(view.textContent).toContain('Yield & rewards');
    expect(view.querySelectorAll('.provenance li').length).toBeGreaterThan(0);
    expect(view.textContent).toContain('Leverage (PT looping)');
    expect(view.textContent).toContain('Max leverage');
    expect(view.textContent).toContain('PT Price'); // Pendle's own risk item
    expect(view.textContent).toContain('Long-range history (daily)');
    expect(view.textContent).toContain('Live now');

    const titles = [...view.querySelectorAll('details.disclosure .disclosure-title')].map((n) => n.textContent);
    expect(titles).toContain('Limit orders');
  });

  it('explains protocol depth instead of judging the protocol', () => {
    const exotic = makeMarket({ id: '1-0xexotic', address: '0xexotic', name: 'Exotic market', protocol: 'ZzZ New Protocol' });
    app.ingestSnapshot({
      fetchedAt: new Date().toISOString(),
      chains: [{ chainId: 1, fetchedAt: new Date().toISOString(), markets: [exotic] }],
      skippedExpired: 0,
    });
    app.state.detailMarketId = exotic.id;
    app.render();
    expect(view.textContent).toContain('Protocol depth — measured, not judged');
    // It has to say *what follows from that*, not just show a number.
    expect(view.textContent).toContain('makes no protocol-level judgement');
    expect(view.textContent).toContain('never trust');
  });

  it('escapes provider text instead of injecting markup', () => {
    const evil = makeMarket({
      id: '1-0xevil',
      name: '<img src=x onerror=alert(1)>',
      info: { ...makeMarket().info, riskInvolved: '<script>alert(1)</script>' },
    });
    app.state.snapshot = {
      fetchedAt: new Date().toISOString(),
      chains: [{ chainId: 1, fetchedAt: new Date().toISOString(), markets: [evil] }],
    };
    app.ingestSnapshot(app.state.snapshot);
    app.render();
    expect(view.querySelector('img')).toBeNull();
    expect(view.querySelector('script')).toBeNull();
    expect(view.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});
