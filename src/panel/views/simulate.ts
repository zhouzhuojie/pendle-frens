import type { App } from '../app';
import type { ScenarioSummary, TrajectorySeries } from '../../lib/domain/simulate';
import { buildTrajectories, compareScenarios } from '../../lib/domain/simulate';
import type { Market, Simulation } from '../../lib/domain/types';
import { maturityPlanPanel, routeDetail } from './simulate-detail';
import { append, clear, el } from '../dom';
import { barChart, lineChart } from '../chart';
import { chip, disclosure, errorBox, field, stat, statGrid } from '../components';
import {
  daysUntil,
  formatAmount,
  formatBps,
  formatCompactUsd,
  formatDate,
  formatPct,
  formatUsd,
} from '../../lib/domain/format';
import { chainName } from '../../lib/domain/chains';

/**
 * One screen, three scenarios.
 *
 * Entry, exit and roll-over are quoted together (sequentially, ~15–20 computing
 * units) instead of behind tabs, because the useful question is not "what does
 * entry cost" but "which of these three is the better move from here".
 */
export function renderSimulate(app: App): HTMLElement {
  const view = el('div', { class: 'view view-simulate' });
  const sim = app.state.sim;
  const market = app.currentMarket();

  append(view, el('div', { class: 'sim-picker' }, marketPicker(app)));

  if (!market) {
    append(view, el('div', { class: 'empty', text: 'No market selected.' }));
    return view;
  }

  append(view, controls(app, market), assumptions(app, market));

  append(
    view,
    el('button', {
      class: 'btn btn-primary btn-wide',
      text: sim.busy ? (sim.progress ?? 'Quoting…') : sim.results.entry ? 'Re-run all three quotes' : 'Simulate enter / exit / roll over',
      disabled: sim.busy,
      on: { click: () => void app.simulateAll() },
    }),
  );

  if (sim.error) append(view, errorBox(sim.error));

  const { entry, exit, roll } = sim.results;
  if (!entry) {
    append(
      view,
      el('div', {
        class: 'hint',
        text: 'Three live quotes are requested in sequence: stablecoin → PT, the same PT back out, and the same PT rolled into the destination market. About 15–20 computing units, only when you ask.',
      }),
    );
    return view;
  }

  /* ------------------------- scenario comparison -------------------------- */
  const scenarios = compareScenarios({ entry, exit, roll });
  append(view, scenarioGrid(scenarios, entry.sizeUsd));

  /* --------------------------- maturity plan ------------------------------ */
  append(view, maturityPlanPanel(app, entry));

  /* ---------------------------- value over time --------------------------- */
  const trajectories = buildTrajectories({ entry, exit, roll });
  const series = trajectories.series.map((s: TrajectorySeries) => ({
    id: s.id,
    label: s.label,
    points: s.points.map((p) => ({ x: p.day, y: p.usd })),
  }));
  const refs = [
    { y: trajectories.costBasisUsd, label: `Cost basis ${formatUsd(trajectories.costBasisUsd, 0)}`, kind: 'basis' as const },
    ...(trajectories.exitTodayUsd !== null
      ? [{ y: trajectories.exitTodayUsd, label: `Exit today ${formatUsd(trajectories.exitTodayUsd, 0)}`, kind: 'exit' as const }]
      : []),
  ];

  append(
    view,
    el(
      'section',
      { class: 'panel' },
      el('h3', { text: 'Value of the position over time' }),
      lineChart(series, refs, {
        xMax: trajectories.xMaxDays,
        xFormat: (x) => `${Math.round(x)}d`,
        yFormat: (y) => formatCompactUsd(y),
      }),
      el('div', {
        class: 'hint',
        text: 'Fair value at each market’s own implied rate: par is discounted back from maturity, so the curves converge on what PT redeems for. If the implied rate moves, these paths move with it — this is not a forecast.',
      }),
    ),
  );

  /* ------------------------------ the detail -------------------------------
   * Everything below the chart is derivation rather than answer. It is all here,
   * one click away, because the alternative — stacking it under the headline —
   * is what made this page unreadable. */

  append(
    view,
    disclosure({
      title: 'Full cost breakdown',
      summary: `${formatUsd(scenarios[0]?.cost.totalUsd ?? 0)} – ${formatUsd(maxCost(scenarios))} all in`,
      children: [
        barChart(
          scenarios.map((scenario) => ({
            label: scenario.label,
            value: scenario.cost.totalUsd,
            caption: `${scenario.cost.totalBps.toFixed(1)} bps`,
            kind: scenario.id,
          })),
          (value) => formatUsd(value),
        ),
        el('div', {
          class: 'hint',
          text: 'Fee + price impact + estimated gas. These amounts are already reflected in the PT quantities above — they are not added on top.',
        }),
        scenarioDetail('Entry', 'Stablecoin → PT, held to maturity', entry, [
          ['PT received', `${formatAmount(entry.ptOut)} PT`, 'after fees and impact'],
          ['Effective fixed APY', formatPct(entry.effectiveApy), `market shows ${formatPct(entry.impliedApyMarket)}`],
          ['Entry price', formatUsd(entry.ptPriceUsd, 4), 'per PT'],
          ['Value at maturity', formatUsd(entry.valueAtMaturityUsd), 'PT redeems 1:1 for the accounting asset'],
          ['Profit at maturity', formatUsd(entry.profitAtMaturityUsd), `${formatPct(entry.simpleApy)} simple APY cross-check`],
          ['Days held', String(Math.round(entry.daysToMaturity)), `maturing ${formatDate(market.expiry)}`],
          ['Break-even', entry.breakEvenDays === null ? '—' : `${Math.ceil(entry.breakEvenDays)} days`, 'entry cost only; excludes the exit leg'],
          ['Your own impact', formatBps(entry.impactBps), 'how much your order moved the implied APY'],
        ]),
        exit
          ? scenarioDetail('Exit', 'PT → stablecoin today, realised immediately', exit, [
              ['PT sold', `${formatAmount(exit.ptIn)} PT`, `notional ${formatUsd(exit.notionalUsd)}`],
              ['Received', `${formatUsd(exit.proceedsUsd)} ${exit.tokenOut.symbol}`, `${formatAmount(exit.amountOut)} ${exit.tokenOut.symbol}`],
              ['vs cost basis', formatUsd(exit.proceedsUsd - entry.sizeUsd), 'the round-trip cost, realised'],
              ['Effective APY after exit', formatPct(exit.effectiveApy), 'what the pool implies post-trade'],
            ])
          : null,
        roll
          ? scenarioDetail('Roll over', `PT → ${roll.destLabel}`, roll, [
              ['New PT received', `${formatAmount(roll.destPtOut)} PT`, `notional ${formatUsd(roll.notionalUsd)}`],
              ['Destination effective APY', formatPct(roll.destEffectiveApy), `headline ${formatPct(roll.destHeadlineApy)}`],
              ['Roll-over drag', formatBps(roll.dragBps), 'headline minus what you actually lock in'],
              ['Value at destination maturity', formatUsd(roll.destParValueUsd), `${Math.round(roll.destDaysToMaturity)} days, ${formatDate(app.marketById(roll.destMarketId)?.expiry ?? '')}`],
              ['Profit at destination maturity', formatUsd(roll.destParValueUsd - entry.sizeUsd), 'vs today’s cost basis, over a longer period'],
              ['Notional rolled', formatUsd(roll.notionalUsd), `${formatAmount(roll.ptIn)} PT out of ${market.name}`],
            ])
          : null,
      ],
    }),
  );

  append(
    view,
    disclosure({
      title: 'Where the fee and the price impact come from',
      summary: `${entry.cost.totalBps.toFixed(1)} bps to enter`,
      children: [routeDetail(app, entry, exit, roll)],
    }),
  );

  if (roll) {
    append(view, disclosure({ title: 'Roll-over size sensitivity', summary: '0.25×–5×', children: [sensitivityPanel(app, roll)] }));
  } else if (sim.destMarketId) {
    append(
      view,
      el('div', {
        class: 'hint',
        text: 'No roll-over quote for this pair — usually no swap route between the two PTs. Pick a different destination above.',
      }),
    );
  }

  append(
    view,
    el('div', {
      class: 'disclaimer',
      text: 'Read-only. Quotes are API estimates that move with liquidity; gas is an estimate; slippage tolerance is a cap, not a promise.',
    }),
  );

  return view;
}

/** Widest total cost in the run, for the collapsed cost summary. */
function maxCost(scenarios: ScenarioSummary[]): number {
  return scenarios.reduce((worst, scenario) => Math.max(worst, scenario.cost.totalUsd), 0);
}

/* ------------------------------- pickers ---------------------------------- */

function marketPicker(app: App): HTMLElement {
  const sim = app.state.sim;
  const options = app
    .markets()
    .slice()
    .sort((a, b) => app.scoreFor(b).score - app.scoreFor(a).score);

  const select = el(
    'select',
    {
      class: 'input',
      on: {
        change: (event) => {
          const id = (event.target as HTMLSelectElement).value;
          app.openSimulator(id);
        },
      },
    },
    ...options.map((market) =>
      el('option', {
        value: market.id,
        text: optionLabel(app, market),
        checked: market.id === sim.marketId,
      }),
    ),
  );

  const search = el('input', {
    class: 'input',
    attrs: { type: 'search', placeholder: 'Search markets…' },
    on: {
      input: (event) => {
        const query = (event.target as HTMLInputElement).value.toLowerCase();
        const filtered = options.filter((market) =>
          `${market.name} ${market.protocol} ${market.underlyingAsset.symbol}`.toLowerCase().includes(query),
        );
        clear(select);
        for (const market of filtered.slice(0, 120)) {
          append(select, el('option', { value: market.id, text: optionLabel(app, market) }));
        }
        select.value = sim.marketId ?? '';
      },
    },
  });

  return el('div', { class: 'picker' }, field('Find a market', search), field('Market to simulate', select));
}

function optionLabel(app: App, market: Market): string {
  return `${market.name} · ${market.underlyingAsset.symbol} · ${formatPct(market.impliedApy)} · ${formatDate(
    market.expiry,
  )} · ${chainName(market.chainId)} [score ${app.scoreFor(market).score}]`;
}

/* ------------------------------- controls --------------------------------- */

function controls(app: App, market: Market): HTMLElement {
  const sim = app.state.sim;
  const tokens = app.stableTokensFor(market.chainId);

  const sizeField = field(
    'Size (USD)',
    el('input', {
      class: 'input',
      attrs: { type: 'number', min: '100', step: '1000' },
      value: String(sim.sizeUsd),
      on: {
        input: (event) => {
          sim.sizeUsd = Number((event.target as HTMLInputElement).value) || 0;
        },
      },
    }),
  );

  const tokenField = field(
    'Stablecoin',
    el(
      'select',
      {
        class: 'input',
        on: {
          change: (event) => {
            sim.tokenAddress = (event.target as HTMLSelectElement).value;
            app.render();
          },
        },
      },
      ...tokens.map((token) => el('option', { value: token.address, text: token.symbol, checked: token.address === sim.tokenAddress })),
    ),
  );

  const destinations = app
    .markets()
    .filter((m) => m.id !== market.id && m.chainId === market.chainId)
    .sort((a, b) => app.scoreFor(b).score - app.scoreFor(a).score);

  const destField = field(
    'Roll over into',
    el(
      'select',
      {
        class: 'input',
        on: {
          change: (event) => {
            sim.destMarketId = (event.target as HTMLSelectElement).value;
            app.render();
          },
        },
      },
      ...destinations.map((destination) =>
        el('option', {
          value: destination.id,
          text: `${destination.name} · ${destination.underlyingAsset.symbol} · ${formatPct(destination.impliedApy)} · ${formatDate(
            destination.expiry,
          )} · ${Math.round(daysUntil(destination.expiry))}d`,
          checked: destination.id === sim.destMarketId,
        }),
      ),
    ),
  );

  return el(
    'div',
    { class: 'sim-controls' },
    sizeField,
    tokenField,
    destField,
    el(
      'div',
      { class: 'sim-meta' },
      chip(`${formatPct(market.impliedApy)} fixed`, 'muted'),
      chip(`PT ${formatUsd(market.pt.priceUsd ?? 0, 4)}`, 'muted'),
      chip(`${Math.round(daysUntil(market.expiry))}d left`, 'muted'),
      chip(`liq ${formatCompactUsd(market.liquidityUsd)}`, 'muted'),
    ),
  );
}

function assumptions(app: App, market: Market): HTMLElement {
  const settings = app.state.settings;
  const destination = app.marketById(app.state.sim.destMarketId);
  const token = app.currentToken();
  return disclosure({
    title: 'Assumptions behind these quotes',
    quiet: true,
    children: [
      el(
        'ul',
        { class: 'plain-list' },
        el('li', { text: `Size ${formatUsd(app.state.sim.sizeUsd)} paid in ${token?.symbol ?? 'a stablecoin'}, which is priced at $1.00.` }),
        el('li', { text: `Slippage tolerance ${settings.slippagePct}% (a cap on the transaction, not an expected cost).` }),
        el('li', { text: `Gas priced at ${settings.gasPriceGwei} gwei and the live native-token price; gas units come from the quote.` }),
        el('li', { text: `Exit swaps the exact PT amount the entry quote returns, so both legs describe the same position.` }),
        el('li', {
          text: `Roll-over destination defaults to the highest-scoring market on ${chainName(market.chainId)} with the same accounting asset${
            destination ? ` — currently ${destination.name} (${destination.underlyingAsset.symbol})` : ''
          }.`,
        }),
        el('li', { text: 'Hold-to-maturity value assumes one PT redeems for one accounting unit, priced at its live USD value.' }),
        el('li', { text: 'Quotes are built for a burn address and never signed — this extension has no wallet access.' }),
      ),
    ],
  });
}

/* ------------------------------- rendering -------------------------------- */

function scenarioGrid(scenarios: ScenarioSummary[], sizeUsd: number): HTMLElement {
  // One sentence of plain answer before the numbers. It names the highest
  // annualised net rate, which is arithmetic on the three quotes below — not a
  // recommendation, and it never states a figure the cards do not also show.
  const rated = scenarios.filter((s): s is ScenarioSummary & { apy: number } => s.apy !== null);
  const top = rated.reduce<ScenarioSummary | null>((best, s) => (best === null || s.apy > (best.apy ?? 0) ? s : best), null);

  return el(
    'section',
    { class: 'panel' },
    el('h3', { text: `Three ways to play ${formatUsd(sizeUsd)}` }),
    top
      ? el(
          'p',
          { class: 'lede' },
          `${top.label} has the highest annualised net rate at `,
          el('strong', { text: formatPct(top.apy) }),
          `, for ${formatUsd(top.cost.totalUsd)} in total costs.`,
        )
      : null,
    el(
      'div',
      { class: 'scenarios' },
      ...scenarios.map((scenario) =>
        el(
          'div',
          { class: `scenario scenario-${scenario.id}` },
          el('div', { class: 'scenario-label', text: scenario.label }),
          el('div', {
            class: 'scenario-apy',
            text: scenario.apy === null ? 'realised' : formatPct(scenario.apy),
          }),
          el(
            'div',
            { class: 'scenario-rows' },
            row('Ends with', formatUsd(scenario.endValueUsd)),
            row(scenario.days > 0 ? `Profit in ${Math.round(scenario.days)}d` : 'Result now', formatSignedUsd(scenario.profitUsd)),
            row('Cost', `${formatUsd(scenario.cost.totalUsd)} · ${scenario.cost.totalBps.toFixed(0)} bps`),
          ),
          el('div', { class: 'hint', text: scenario.note }),
        ),
      ),
    ),
  );
}

function row(label: string, value: string): HTMLElement {
  return el('div', { class: 'scenario-row' }, el('span', { text: label }), el('span', { text: value }));
}

function formatSignedUsd(value: number): string {
  const formatted = formatUsd(Math.abs(value));
  return value >= 0 ? `+${formatted}` : `−${formatted}`;
}

function scenarioDetail(
  title: string,
  subtitle: string,
  result: Simulation,
  rows: [string, string, string][],
): HTMLElement {
  return el(
    'section',
    { class: 'panel' },
    el('h3', { text: `${title} — ${subtitle}` }),
    statGrid(...rows.map(([label, value, sub]) => stat(label, value, sub))),
    costTable(result),
  );
}

function costTable(result: Simulation): HTMLElement {
  const cost = result.cost;
  return el(
    'div',
    { class: 'costs' },
    el('div', { class: 'stat-label', text: 'Cost breakdown (already reflected above)' }),
    costRow('Protocol swap fee', formatUsd(cost.protocolFeeUsd)),
    costRow('Price impact', formatUsd(cost.priceImpactUsd)),
    costRow('Gas (estimated)', formatUsd(cost.gasUsd)),
    costRow('Total', `${formatUsd(cost.totalUsd)} · ${cost.totalBps.toFixed(1)} bps`, true),
  );
}

function costRow(label: string, value: string, emphasis = false): HTMLElement {
  return el('div', { class: `cost-row ${emphasis ? 'cost-total' : ''}`.trim() }, el('span', { text: label }), el('span', { text: value }));
}

function sensitivityPanel(app: App, roll: Extract<Simulation, { kind: 'roll' }>): HTMLElement {
  const wrap = el('div', { class: 'sens-body' });
  append(
    wrap,
    el(
      'div',
      { class: 'sens-head' },
      el('div', {
        class: 'hint',
        text: 'How your own size drags the destination rate. Each row is a separate live quote.',
      }),
      el('button', {
        class: 'btn btn-small',
        text: app.state.sim.busy ? 'Sweeping…' : 'Sweep sizes (0.25×–5×)',
        disabled: app.state.sim.busy,
        on: { click: () => void app.runSensitivity() },
      }),
    ),
  );

  if (roll.sensitivity.length === 0) {
    append(wrap, el('div', { class: 'hint', text: 'Sweep sizes (0.25×–5×, 5 API units per row).' }));
    return wrap;
  }

  const table = el('table', { class: 'sens-table' });
  append(
    table,
    el('thead', {}, el('tr', {}, ...['Size', 'Total cost', 'Bps', 'Dest effective APY'].map((h) => el('th', { text: h })))),
  );
  const body = el('tbody');
  for (const bar of roll.sensitivity) {
    append(
      body,
      el(
        'tr',
        {},
        el('td', { text: formatUsd(bar.sizeUsd, 0) }),
        el('td', { text: formatUsd(bar.totalCostUsd) }),
        el('td', { text: bar.totalBps.toFixed(1) }),
        el('td', { text: formatPct(bar.effectiveApy) }),
      ),
    );
  }
  append(table, body);
  append(
    wrap,
    table,
    el('div', {
      class: 'hint',
      text: 'A scenario built from current liquidity, not a forecast. Roll-day liquidity is unknowable in advance.',
    }),
  );
  return wrap;
}

