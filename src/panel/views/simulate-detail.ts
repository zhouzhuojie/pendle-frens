/**
 * The two "show me why" panels of the simulator:
 *
 *  1. the maturity plan — what you would do when this PT matures, priced at
 *     entry time, which is when the decision is actually being made;
 *  2. route forensics — which venues each quote touched, how the price impact
 *     splits between them, and how the fee figure was arrived at.
 *
 * Kept in their own module because they are pure presentation over already
 * computed numbers, and `simulate.ts` was getting long.
 */

import type { App } from '../app';
import type { EntrySimulation, ExitSimulation, RollSimulation } from '../../lib/domain/types';
import type { MaturityOption } from '../../lib/domain/simulate';
import { buildMaturityPlan } from '../../lib/domain/simulate';
import type { RouteBreakdown } from '../../lib/domain/route';
import { describeRoute } from '../../lib/domain/route';
import { describeSuccessor } from '../../lib/domain/successor';
import type { AssetRef, ConvertQuote, Market } from '../../lib/domain/types';
import { append, el } from '../dom';
import { chip, disclosure } from '../components';
import { formatBps, formatPct, formatUsd, shortAddress } from '../../lib/domain/format';

/* ------------------------------ maturity plan ----------------------------- */

/**
 * "What do I do when this matures?"
 *
 * The important correction this encodes: holding to maturity has *no* exit
 * cost. PT redeems at par through the SY redeemer, so rolling at maturity is a
 * fresh entry into the successor rather than a round trip.
 */
export function maturityPlanPanel(app: App, entry: EntrySimulation): HTMLElement {
  const sim = app.state.sim;
  const market = app.currentMarket();
  const match = app.successorMatch();
  const destination = app.marketById(sim.destMarketId);
  const options = buildMaturityPlan({
    entry,
    successor: destination ?? null,
    successorEntry: sim.results.destinationEntry,
    rollNow: sim.results.roll,
    redeemGasUsd: app.redeemGasUsd(),
  });

  const table = el('table', { class: 'plan-table' });
  append(
    table,
    el(
      'thead',
      {},
      el(
        'tr',
        {},
        ...['Option', 'Cost at maturity', 'Ends with', 'Held', 'Total friction', 'Net profit', 'Net APY'].map((header) =>
          el('th', { text: header }),
        ),
      ),
    ),
    el('tbody', {}, ...options.map(planRow)),
  );

  // One line of orientation, the table, then the rest of the reasoning folded
  // away. Six paragraphs of caveat around one table is a wall, not an
  // explanation — and the definitions are only needed once you are reading the
  // numbers closely.
  return el(
    'section',
    { class: 'panel' },
    el('h3', { text: 'What happens when it matures' }),
    el('div', {
      class: 'hint',
      text: match && market
        ? `Successor found: ${describeSuccessor(market, match)}.`
        : 'No later expiry of this same asset exists yet, so a "same PT, later expiry" roll cannot be quoted. The destination selection above drives the roll option below.',
    }),
    table,
    disclosure({
      title: 'How these options are calculated',
      quiet: true,
      children: [
        el('div', {
          class: 'hint',
          text: 'Holding to maturity avoids the exit swap entirely: PT redeems 1:1 for the accounting asset through the SY redeemer, so there is no swap fee and no price impact — only gas.',
        }),
        el('div', {
          class: 'hint',
          text: '"Total friction" is entry + action cost and is explanatory only; the end values already have every cost deducted. "Net profit" is end value minus what you paid in, so it is net of everything.',
        }),
        ...options.map((option) => el('div', { class: 'hint', text: `${option.label} — ${option.note}` })),
        destination
          ? el('div', {
              class: 'hint',
              text: `The maturity roll buys ${destination.name} (${destination.underlyingAsset.symbol}), sized at your expected redemption proceeds. Change the destination above to re-price it.`,
            })
          : null,
      ],
    }),
  );
}

function planRow(option: MaturityOption): HTMLElement {
  return el(
    'tr',
    { class: `plan-row plan-${option.id}` },
    el(
      'td',
      {},
      el('div', { class: 'plan-label', text: option.label }),
      chip(option.basis, option.basis === 'quoted' ? 'good' : 'muted'),
    ),
    el('td', { text: formatUsd(option.actionCostUsd) }),
    el('td', { text: formatUsd(option.endValueUsd) }),
    el('td', { text: `${Math.round(option.totalDays)}d` }),
    el('td', { text: `${formatUsd(option.totalFrictionUsd)} · ${option.totalFrictionBps.toFixed(1)} bps` }),
    el('td', { class: option.netProfitUsd >= 0 ? 'good' : 'bad', text: signedUsd(option.netProfitUsd) }),
    el('td', { text: formatPct(option.netApy) }),
  );
}

/* --------------------------- route and fee detail ------------------------- */

/**
 * The route forensics for every quote in the run.
 *
 * Returns content, not a panel: it is rendered inside a disclosure, so that the
 * derivation sits below the answer rather than on top of it.
 */
export function routeDetail(
  app: App,
  entry: EntrySimulation,
  exit: ExitSimulation | null,
  roll: RollSimulation | null,
): HTMLElement {
  const market = app.currentMarket();
  const successorEntry = app.state.sim.results.destinationEntry;
  const destinationMarket = app.marketById(app.state.sim.destMarketId);
  const gasPriceGwei = app.state.settings.gasPriceGwei;
  const nativePriceUsd = app.state.sim.nativePriceUsd;
  const dest = app.marketById(roll?.destMarketId);

  const blocks: (HTMLElement | null)[] = [];
  if (market) {
    blocks.push(
      routePanel('Entry', entry.quote, {
        market,
        counterAsset: entry.tokenIn,
        notionalUsd: entry.sizeUsd,
        gasPriceGwei,
        nativePriceUsd,
      }),
    );
  }
  if (exit && market) {
    blocks.push(
      routePanel('Exit', exit.quote, {
        market,
        counterAsset: exit.tokenOut,
        notionalUsd: exit.notionalUsd,
        gasPriceGwei,
        nativePriceUsd,
      }),
    );
  }
  if (roll && market) {
    blocks.push(
      routePanel('Roll over', roll.quote, {
        market,
        destMarket: dest ?? null,
        counterAsset: market.accountingAsset,
        notionalUsd: roll.notionalUsd,
        destNotionalUsd: roll.destPtOut * (roll.destPtMarketPriceUsd ?? roll.destPtPriceUsd),
        gasPriceGwei,
        nativePriceUsd,
      }),
    );
  }
  if (successorEntry && destinationMarket) {
    blocks.push(
      routePanel('Roll at maturity (destination purchase)', successorEntry.quote, {
        market: destinationMarket,
        counterAsset: successorEntry.tokenIn,
        notionalUsd: successorEntry.sizeUsd,
        gasPriceGwei,
        nativePriceUsd,
      }),
    );
  }

  return el(
    'div',
    { class: 'route-detail' },
    el('div', {
      class: 'hint',
      text: 'Read from the quote’s own transaction calldata. Where a figure is derived rather than reported, the derivation is shown next to the SDK’s number so you can check it.',
    }),
    ...blocks,
  );
}

interface RoutePanelInput {
  market: Market;
  destMarket?: Market | null;
  counterAsset: AssetRef;
  notionalUsd: number;
  destNotionalUsd?: number;
  gasPriceGwei: number;
  nativePriceUsd: number | null;
}

function routePanel(label: string, quote: ConvertQuote, input: RoutePanelInput): HTMLElement {
  const breakdown = describeRoute({
    quote,
    market: input.market,
    destMarket: input.destMarket ?? null,
    counterAsset: input.counterAsset,
    notionalUsd: input.notionalUsd,
    destNotionalUsd: input.destNotionalUsd ?? null,
    gasPriceGwei: input.gasPriceGwei,
    nativePriceUsd: input.nativePriceUsd,
  });

  return el(
    'div',
    { class: 'route' },
    el(
      'div',
      { class: 'route-head' },
      el('strong', { text: label }),
      chip(`${breakdown.method ?? breakdown.action}${breakdown.router ? ` → ${shortAddress(breakdown.router)}` : ''}`, 'muted'),
      breakdown.usesExternalSwap ? chip('aggregator in path', 'warn') : chip('direct mint', 'muted'),
      breakdown.limitOrderFills > 0 ? chip(`${breakdown.limitOrderFills} limit fill`, 'warn') : null,
    ),
    legsTable(breakdown),
    impactRows(breakdown),
    feeRows(breakdown),
    el(
      'div',
      { class: 'route-row' },
      el('span', { text: 'Gas — estimated' }),
      el('span', { text: `${formatUsd(breakdown.gas.usd)} · ${breakdown.gas.units ?? '?'} units × ${breakdown.gas.gwei} gwei` }),
    ),
    ...breakdown.notes.map((note) => el('div', { class: 'hint', text: note })),
  );
}

function legsTable(breakdown: RouteBreakdown): HTMLElement {
  return el(
    'table',
    { class: 'route-table' },
    el('thead', {}, el('tr', {}, ...['#', 'Venue', 'Leg', 'In', 'Out', 'Impact'].map((header) => el('th', { text: header })))),
    el(
      'tbody',
      {},
      ...breakdown.legs.map((leg) =>
        el(
          'tr',
          {},
          el('td', { text: String(leg.index) }),
          el('td', { text: leg.venue }),
          el('td', { text: leg.description }),
          el('td', { text: leg.amountIn ?? '—' }),
          el('td', { text: leg.amountOut ?? '—' }),
          el('td', { text: leg.impactBps === null ? '—' : formatBps(leg.impactBps) }),
        ),
      ),
    ),
  );
}

function impactRows(breakdown: RouteBreakdown): HTMLElement {
  const { impact } = breakdown;
  return el(
    'div',
    { class: 'route-rows' },
    el(
      'div',
      { class: 'route-row' },
      el('span', { text: 'Price impact — total' }),
      el('span', { text: `${formatBps(impact.totalBps)} = ${formatUsd(impact.totalUsd)}` }),
    ),
    el(
      'div',
      { class: 'route-row route-sub' },
      el('span', { text: 'internal — Pendle AMM curve' }),
      el('span', { text: `${formatBps(impact.internalBps)} = ${formatUsd(impact.internalUsd)}` }),
    ),
    el(
      'div',
      { class: 'route-row route-sub' },
      el('span', { text: 'external — aggregator / DEX leg' }),
      el('span', { text: `${formatBps(impact.externalBps)} = ${formatUsd(impact.externalUsd)}` }),
    ),
  );
}

function feeRows(breakdown: RouteBreakdown): HTMLElement {
  const { fee } = breakdown;
  const delta = fee.deltaUsd;
  const agrees =
    delta !== null && fee.reportedUsd !== null && Math.abs(delta) <= Math.max(0.05, fee.reportedUsd * 0.05);

  return el(
    'div',
    { class: 'route-rows' },
    el(
      'div',
      { class: 'route-row' },
      el('span', { text: 'Swap fee — reported by the SDK' }),
      el('span', {
        text: `${formatUsd(fee.reportedUsd)}${
          fee.bpsOfNotional === null ? '' : ` (${fee.bpsOfNotional.toFixed(2)} bps of notional)`
        }`,
      }),
    ),
    el(
      'div',
      { class: 'route-row' },
      el('span', { text: `Swap fee — derived from ${fee.formula}` }),
      el('span', { text: formatUsd(fee.derivedUsd) }),
    ),
    ...fee.legs.map((leg) =>
      el(
        'div',
        { class: 'route-row route-sub' },
        el('span', {
          text: `${leg.label} · ${leg.feeRateBps.toFixed(2)} bps × ${formatUsd(leg.notionalUsd)} × ${leg.daysToMaturity.toFixed(1)}/365`,
        }),
        el('span', { text: formatUsd(leg.feeUsd) }),
      ),
    ),
    el(
      'div',
      { class: 'route-row route-sub' },
      el('span', {
        text: agrees
          ? 'Difference — the reconstruction explains the fee'
          : 'Difference — a limit fill or a second venue is likely involved',
      }),
      el('span', { text: delta === null ? '—' : signedUsd(delta) }),
    ),
  );
}

function signedUsd(value: number): string {
  const formatted = formatUsd(Math.abs(value));
  return value >= 0 ? `+${formatted}` : `−${formatted}`;
}
