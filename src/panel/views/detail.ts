import type { App, MarketExtras } from '../app';
import { append, el, openExternal, sparkline } from '../dom';
import { avatar, chip, disclosure, factorList, scoreBlock, spinner, stat, statGrid, verdictChip } from '../components';
import {
  daysUntil,
  formatAmount,
  formatBps,
  formatCompactUsd,
  formatDate,
  formatPct,
  formatRelative,
  formatSignedPct,
  formatUsd,
} from '../../lib/domain/format';
import { analyzeHistory, historySpanDays } from '../../lib/domain/history';
import { chainName } from '../../lib/domain/chains';
import { buildDecisionBrief, type DecisionBrief } from '../../lib/domain/decision';
import { VERDICT_RULE } from '../../lib/domain/score';
import { rangePosition, rewardBadges, yieldProvenance, type ProvenanceRow } from '../../lib/domain/rewards';
import { readBook } from '../../lib/domain/book';
import { netApyAtMaxLeverage, readLooping } from '../../lib/domain/looping';
import type { ExternalProtocol, HistoryPoint, HistoryStats, LoopOption, Market, MarketScore } from '../../lib/domain/types';

/**
 * The market detail page, ordered by the decision rather than by the data.
 *
 * A PT buyer asks four things, in order: what do I earn, what do I get back,
 * what does it cost, and what could go wrong. The top of this page answers those
 * and nothing else. Everything the Pendle AI endpoints add — yield provenance,
 * rewards, limit-order depth, leverage venues — is a labelled panel under that
 * answer, and the raw statistics and addresses stay at the bottom. The score is
 * deliberately *not* fed by any of it: see the Method page.
 */
export function renderDetail(app: App, marketId: string): HTMLElement {
  const market = app.marketById(marketId);
  if (!market) return el('div', { class: 'empty', text: 'Market not found.' });

  const score = app.scoreFor(market);
  const days = daysUntil(market.expiry);
  const history = app.state.history.get(marketId) ?? null;
  const stats = history ? analyzeHistory(history, app.state.benchmark.pct) : null;
  const favorited = app.isFavorite(marketId);
  const extras = app.extrasFor(marketId);
  const remoteLogos = app.state.settings.remoteLogos;
  const brief = buildDecisionBrief(market, score, {
    benchmarkPct: app.state.benchmark.pct,
    historyStats: stats,
    sizeUsd: app.state.settings.defaultSizeUsd,
  });

  const view = el('div', { class: 'view view-detail' });

  append(
    view,
    el('button', { class: 'back', text: '← Back', on: { click: () => app.closeDetail() } }),
    el(
      'header',
      { class: 'detail-head' },
      el(
        'div',
        { class: 'detail-headline' },
        scoreBlock(score, true),
        el(
          'div',
          { class: 'detail-title-row' },
          avatar(market.underlyingAsset.symbol, market.id, market.icon, { large: true, remote: remoteLogos }),
          el(
            'div',
            {},
            el('h2', { class: 'detail-title', text: `${market.name} · ${market.underlyingAsset.symbol}` }),
            el(
              'div',
              { class: 'card-sub' },
              chip(market.protocol, 'muted'),
              chip(chainName(market.chainId), 'muted'),
              market.isPrime ? chip('Prime', 'good') : null,
              market.isVolatile ? chip('Variable underlying', 'warn') : null,
              verdictChip(score.verdict),
            ),
          ),
        ),
      ),
      el(
        'div',
        { class: 'detail-actions' },
        el('button', {
          class: `btn ${favorited ? 'btn-ghost' : 'btn-primary'}`,
          text: favorited ? '★ Favorited' : '☆ Favorite',
          on: { click: () => void app.toggleFavorite(market) },
        }),
        el('button', { class: 'btn btn-primary', text: 'Simulate', on: { click: () => app.openSimulator(market.id) } }),
        el('button', {
          class: 'btn btn-ghost',
          text: 'Pendle ↗',
          on: { click: () => openExternal(app.marketLink(market)) },
        }),
      ),
    ),
    decisionPanel(brief, score, days, market, extras),
    limitOrdersDisclosure(market, extras),
    payoutPanel(brief, market),
    yieldPanel(market, extras),
    leveragePanel(market, extras),
    historyPanel(history, stats, extras),
    riskPanel(app, market),
    scorePanel(app, score),
    marketDataPanel(market, extras, remoteLogos),
    el('div', { class: 'disclaimer', text: 'Read-only. Verify every number on app.pendle.finance before signing anything.' }),
  );

  return view;
}

/* -------------------------------- decision -------------------------------- */

/**
 * The answer: the rate, the term, the premium, and the two cases. This is the
 * only part of the page that tells you what to do with the numbers; everything
 * below it is evidence.
 */
function decisionPanel(
  brief: DecisionBrief,
  score: MarketScore,
  days: number,
  market: Market,
  extras: MarketExtras,
): HTMLElement {
  const rewards = rewardBadges(market);
  const live = extras.live?.impliedApy ?? null;
  const liveDiffers =
    live !== null && Number.isFinite(live) && Math.abs(live - market.impliedApy) >= 0.0005;

  return el(
    'section',
    { class: 'panel panel-decision' },
    el('p', {
      class: 'decision-intro',
      text: 'A PT is a fixed-rate loan to this protocol. You pay below par today and receive one accounting-asset unit at maturity, so the trade is fixed only if you hold it. Decide on four things: what you earn over the risk-free rate, what you get back, what it costs to get in, and what could go wrong.',
    }),
    el('p', { class: 'decision-headline', text: brief.headline }),
    liveDiffers
      ? el('div', {
          class: 'live-line',
          text: `Live now: ${formatPct(live)} · ${extras.loadedAt ? formatRelative(extras.loadedAt) : 'just now'}`,
        })
      : null,
    statGrid(
      stat('Fixed APY', formatPct(market.impliedApy), `spread ${formatSignedPct(brief.spread)} over benchmark`, true),
      stat('Matures', `${Math.round(days)} days`, formatDate(market.expiry)),
      stat(
        'Exit liquidity',
        formatCompactUsd(brief.exit.liquidityUsd),
        brief.exit.level === 'deep' ? 'deep — early exit is easy' : brief.exit.level === 'workable' ? 'moderate — mind large exits' : 'thin — an early exit costs',
      ),
      stat(
        'Est. cost to enter',
        formatBps(brief.entryCost.bps, 1),
        `≈ ${formatUsd(brief.entryCost.feeUsd, 0)} at ${formatCompactUsd(brief.entryCost.notionalUsd)}`,
      ),
    ),
    rewards.length > 0
      ? el('div', { class: 'reward-chips' }, ...rewards.map((badge) => el('span', { class: `chip chip-${badge.kind === 'points' ? 'good' : 'neutral'}`, text: badge.label, title: badge.title })))
      : null,
    el('div', { class: 'verdict-line' }, verdictChip(score.verdict), el('span', { class: 'muted', text: VERDICT_RULE[score.verdict] })),
    el(
      'div',
      { class: 'decision-grid' },
      caseList('Why it could work', brief.caseFor, 'for'),
      caseList('What to watch', brief.caseAgainst, 'against'),
    ),
  );
}

function caseList(title: string, items: string[], kind: 'for' | 'against'): HTMLElement {
  return el(
    'div',
    { class: `case case-${kind}` },
    el('h4', { class: 'case-title', text: title }),
    el('ul', { class: 'case-list' }, ...items.map((text) => el('li', { text }))),
  );
}

/* ------------------------------ limit orders ------------------------------ */

/**
 * A rate-only read of the order book. The provider mixes limit and AMM sizes on
 * scales it does not document, so this says where resting orders are in *rate*
 * terms and never invents a dollar size.
 */
function limitOrdersDisclosure(market: Market, extras: MarketExtras): HTMLElement {
  const book = readBook(extras.book);
  const maker = market.limitOrderIncentive;

  let summary = 'loading…';
  if (book) {
    summary = book.hasLimitOrders
      ? `${book.restingOrders} resting · best ${formatPct(book.bestLimitApy)}`
      : 'none resting — AMM only';
  }

  const children: (HTMLElement | null)[] = [];
  if (!book) {
    children.push(extras.loading ? spinner('Reading the order book…') : el('div', { class: 'muted', text: 'The limit-order book is unavailable.' }));
  } else {
    children.push(
      statGrid(
        stat('Resting orders', String(book.restingOrders), `${book.levels} levels returned`),
        stat(
          'Best resting rate',
          book.hasLimitOrders ? formatPct(book.bestLimitApy) : '—',
          book.hasLimitOrders ? `lowest ${formatPct(book.worstLimitApy)}` : 'none on the book',
        ),
        stat('Best AMM rate', formatPct(book.bestAmmApy), 'the rate if you take liquidity'),
        stat('Maker APY', maker ? formatPct(maker.impliedApy) : '—', 'for posting a resting order'),
      ),
      el('div', {
        class: 'hint',
        text: 'Rates only: the provider returns limit and AMM sizes in units it does not document, so this deliberately shows no dollar depth. A resting order at a better rate than the AMM is only useful if it is large enough for your size — check the fill on Pendle before relying on it.',
      }),
    );
  }

  return disclosure({ title: 'Limit orders', summary, children });
}

/* -------------------------------- the payout ------------------------------ */

function payoutPanel(brief: DecisionBrief, market: Market): HTMLElement {
  const p = brief.payout;
  const section = el('section', { class: 'panel' }, el('h3', { text: 'What you would get at maturity' }));

  if (p.ptReceived === null) {
    append(
      section,
      el('div', { class: 'muted', text: 'The provider gave no PT price for this market — open Simulate for a live quote.' }),
    );
    return section;
  }

  append(
    section,
    statGrid(
      stat('PT price', formatUsd(p.ptPriceUsd, 4), `discount ${formatPct(p.discount)}`),
      stat('You pay', formatUsd(p.sizeUsd, 0), 'worked example'),
      stat(
        'You receive',
        p.valueAtMaturityUsd !== null ? formatUsd(p.valueAtMaturityUsd, 0) : `${formatAmount(p.ptReceived)} PT`,
        p.markedToToday ? `at today's ${market.accountingAsset.symbol} price` : `in ${market.accountingAsset.symbol}, at par`,
      ),
      stat(
        'Profit if held',
        p.profitUsd !== null ? formatUsd(p.profitUsd, 0) : '—',
        `≈ ${formatPct(market.impliedApy)} over ${Math.round(brief.days)} days`,
      ),
    ),
    el('div', {
      class: 'hint',
      text: `Before fees and at today's prices. PT redeems for one unit of ${market.accountingAsset.symbol}, which is the only part that is fixed — it is a dollar only if that asset is worth a dollar at maturity.`,
    }),
  );
  return section;
}

/* ---------------------------- yield & rewards ----------------------------- */

/**
 * Where the yield comes from, and what else the market pays out.
 *
 * Both halves are labelled by *who receives them*: the PT's return is the fixed
 * rate, and the LP/YT groups and PENDLE emissions are not the PT holder's.
 */
function yieldPanel(market: Market, extras: MarketExtras): HTMLElement | null {
  const provenance = yieldProvenance(market);
  const rewards = rewardBadges(market);
  const range = market.yieldRange;
  const position = rangePosition(market);

  if (provenance.length === 0 && rewards.length === 0 && !range) return null;

  const section = el('section', { class: 'panel' }, el('h3', { text: 'Yield & rewards' }));

  if (provenance.length > 0) {
    append(
      section,
      el('div', { class: 'stat-label', text: 'Where the yield comes from' }),
      el('ul', { class: 'provenance' }, ...provenance.map(provenanceRow)),
    );
  }

  if (range) {
    append(
      section,
      el('div', { class: 'stat-label', text: 'Where the current fixed rate sits' }),
      rangeBar(range.min, range.max, market.impliedApy, position, extras),
    );
  }

  if (rewards.length > 0) {
    append(
      section,
      el('div', { class: 'stat-label', text: 'Rewards & incentives' }),
      el(
        'div',
        { class: 'reward-chips' },
        ...rewards.map((badge) =>
          el('span', { class: `chip chip-${badge.kind === 'points' ? 'good' : 'neutral'}`, text: badge.label, title: badge.title }),
        ),
      ),
    );
  }

  append(
    section,
    el('div', {
      class: 'hint',
      text: 'Pendle publishes these splits per asset. The PT holder earns the fixed rate; the LP and YT rewards, and PENDLE emissions, go to those positions, not to PT. Points programmes are the provider’s, with their own terms.',
    }),
  );
  return section;
}

function provenanceRow(row: ProvenanceRow): HTMLElement {
  return el(
    'li',
    {},
    el(
      'span',
      { class: 'prov-main' },
      el('span', { class: 'prov-label', text: row.label }),
      el('span', { class: 'prov-applies', text: `on ${row.appliesTo}` }),
    ),
    el('span', { class: 'prov-apy', text: formatPct(row.apy) }),
    el('span', { class: 'prov-sources', text: row.sources.join(' · ') }),
  );
}

function rangeBar(min: number, max: number, now: number, position: number | null, extras: MarketExtras): HTMLElement {
  const marker = el('span', { class: 'range-marker' });
  marker.style.left = `${Math.round((position ?? 0) * 100)}%`;
  const long = extras.longHistory ?? null;
  return el(
    'div',
    { class: 'range' },
    el(
      'div',
      { class: 'range-track' },
      marker,
    ),
    el(
      'div',
      { class: 'range-labels' },
      el('span', { text: formatPct(min) }),
      el('span', { class: 'range-now', text: `now ${formatPct(now)}` }),
      el('span', { text: formatPct(max) }),
    ),
    long && long.length > 1
      ? el('div', { class: 'hint', text: `Range Pendle reports; ${historySpanDays(long)} days of daily history are charted below.` })
      : el('div', { class: 'hint', text: 'Range Pendle reports for this market’s implied APY.' }),
  );
}

/* --------------------------------- leverage ------------------------------- */

function leveragePanel(market: Market, extras: MarketExtras): HTMLElement {
  const section = el('section', { class: 'panel' }, el('h3', { text: 'Leverage (PT looping)' }));
  const options = extras.loop;

  if (options === undefined) {
    if (extras.loading) {
      append(section, spinner('Checking money markets…'));
      return section;
    }
    if (market.externalProtocols.length === 0) {
      append(section, el('div', { class: 'muted', text: 'Pendle lists no money market where this PT can be used as looping collateral.' }));
      return section;
    }
    append(
      section,
      el('div', {
        class: 'hint',
        text: 'From the market payload — the detailed venue and risk panel could not be loaded.',
      }),
      externalProtocolList(market.externalProtocols),
    );
    return section;
  }

  if (options.length === 0) {
    append(section, el('div', { class: 'muted', text: 'Pendle lists no money market where this PT can be used as looping collateral.' }));
    return section;
  }

  const read = readLooping(options);
  const best = read.best;
  append(section, el('div', { class: 'hint', text: `Pendle lists ${read.venues} venue${read.venues === 1 ? '' : 's'} for this PT. Looping borrows against the PT to buy more: it multiplies the fixed rate and the liquidation risk.` }));

  if (best) {
    const net = netApyAtMaxLeverage(best, market.impliedApy);
    append(
      section,
      statGrid(
        stat('Max leverage', best.maxLeverage !== null ? `${best.maxLeverage.toFixed(1)}×` : '—', `${best.moneyMarketName} · ${best.debtSymbol}`),
        stat('Borrow APY', formatPct(best.borrowApy7dAvg ?? best.borrowApy), best.borrowApy7dAvg !== null ? '7-day average' : 'spot'),
        best.maxApy !== null
          ? stat(
              'Max looping APY',
              formatPct(best.maxApy),
              best.reference ? `Pendle, at ${best.reference.leverage.toFixed(1)}× · ${formatCompactUsd(best.reference.positionUsd)}` : 'Pendle’s model',
              true,
            )
          : null,
        stat('Net at max leverage', net !== null ? formatPct(net) : '—', 'our arithmetic: fixed × L − borrow × (L−1)'),
      ),
      el('ul', { class: 'venues' }, ...options.map((option) => venueRow(option, market.impliedApy))),
    );

    if (best.risks && best.risks.items.length > 0) {
      append(
        section,
        el(
          'div',
          { class: 'note warn' },
          el('div', { class: 'stat-label', text: `Pendle’s risk read: ${best.risks.overallLabel}` }),
          el(
            'ul',
            { class: 'risk-list' },
            ...best.risks.items.map((item) =>
              el(
                'li',
                {},
                el('span', { class: 'risk-name', text: item.name }),
                chip(item.label, riskChipKind(item.level)),
                el('div', { class: 'muted', text: item.summary }),
                item.rationale ? el('div', { class: 'risk-rationale', text: item.rationale }) : null,
              ),
            ),
          ),
        ),
      );
    }
  }

  append(
    section,
    el('div', {
      class: 'hint',
      text: 'Looping can be liquidated: if the collateral falls or the borrow rate rises enough, the position is closed at a loss, and the APYs above assume the rate you see now holds. Pendle supplies the venue numbers; the app does not endorse them.',
    }),
  );
  return section;
}

function riskChipKind(level: string): 'good' | 'warn' | 'bad' | 'neutral' {
  if (level === 'none') return 'good';
  if (level === 'low') return 'neutral';
  if (level === 'medium') return 'warn';
  if (level === 'high') return 'bad';
  // An unrecognised level is "I don't know", not "dangerous".
  return 'warn';
}

function venueRow(option: LoopOption, fixedApy: number): HTMLElement {
  const net = netApyAtMaxLeverage(option, fixedApy);
  const label = `${option.moneyMarketName} · ${option.debtSymbol}`;
  const node = el(
    'li',
    {},
    el(
      'span',
      { class: 'venue-main' },
      option.marketUrl || option.url
        ? el('button', {
            class: 'link-inline',
            text: label,
            on: { click: () => openExternal(option.marketUrl ?? option.url ?? '') },
          })
        : el('span', { text: label }),
      el('span', { class: 'venue-meta', text: `${option.maxLeverage !== null ? `${option.maxLeverage.toFixed(1)}×` : '—'} · borrow ${formatPct(option.borrowApy7dAvg ?? option.borrowApy)} · ${formatCompactUsd(option.liquidityUsd)} liquidity` }),
    ),
    el('span', { class: 'venue-apy', text: net !== null ? formatPct(net) : formatPct(option.maxApy) }),
  );
  return node;
}

function externalProtocolList(protocols: ExternalProtocol[]): HTMLElement {
  return el(
    'ul',
    { class: 'venues' },
    ...protocols.map((protocol) =>
      el(
        'li',
        {},
        el(
          'span',
          { class: 'venue-main' },
          el('span', { text: `${protocol.name}${protocol.debtSymbol ? ` · ${protocol.debtSymbol}` : ''}` }),
          el('span', { class: 'venue-meta', text: `${protocol.maxLtv !== null ? `${(protocol.maxLtv * 100).toFixed(0)}% LTV` : '—'} · borrow ${formatPct(protocol.borrowApy)} · ${formatCompactUsd(protocol.liquidityUsd)} liquidity` }),
        ),
        el('span', { class: 'venue-apy', text: formatPct(protocol.maxLoopingApy) }),
      ),
    ),
  );
}

/* ------------------------------ yield history ----------------------------- */

function historyPanel(history: HistoryPoint[] | null, stats: HistoryStats | null, extras: MarketExtras): HTMLElement {
  const section = el('section', { class: 'panel' }, el('h3', { text: 'Yield history' }));
  if (!history) {
    append(section, el('div', { class: 'spinner' }, el('span', { class: 'dot' }), 'Loading 2 months of hourly implied APY…'));
    return section;
  }
  if (!stats || stats.points < 2) {
    append(section, el('div', { class: 'muted', text: 'No usable history for this market.' }));
    return section;
  }

  const values = history.map((p) => p.impliedApy ?? 0);
  append(
    section,
    sparkline(values, 360, 56) ?? el('div', { class: 'muted', text: 'Not enough points to chart.' }),
    statGrid(
      stat('Average', formatPct(stats.mean), 'over the window'),
      stat('Volatility (σ)', formatPct(stats.stddev), 'lower is steadier'),
      stat('Time above benchmark', stats.coverage === null ? '—' : formatPct(stats.coverage, 0), 'share of samples'),
      stat('Trend', stats.trendPerDay === null ? '—' : formatSignedPct(stats.trendPerDay, 3), 'per day'),
    ),
    disclosure({
      title: 'More history statistics',
      summary: `${stats.points} hourly samples`,
      quiet: true,
      children: [
        statGrid(
          stat('Now', formatPct(history[history.length - 1]?.impliedApy ?? null), 'latest sample'),
          stat('Min', formatPct(stats.min), 'lowest implied APY'),
          stat('Max', formatPct(stats.max), 'highest implied APY'),
          stat('Samples', String(stats.points), 'hourly points'),
        ),
      ],
    }),
    longHistoryDisclosure(extras),
    el('div', {
      class: 'hint',
      text: 'The window above is the last ~2 months at hourly resolution — the regime the score’s stability factor reads. It cannot see a full credit cycle.',
    }),
  );
  return section;
}

/**
 * The long view, kept separate from the stats above on purpose: the score reads
 * the recent hourly regime, and mixing years of daily points into it would
 * change the number without any explanation. This is context, clearly labelled.
 */
function longHistoryDisclosure(extras: MarketExtras): HTMLElement | null {
  const long = extras.longHistory;
  if (!long || long.length < 2) {
    if (extras.loading) return disclosure({ title: 'Long-range history', summary: 'loading…', quiet: true, children: [spinner()] });
    return null;
  }
  const stats = analyzeHistory(long, 0);
  const span = historySpanDays(long);
  const values = long.map((p) => p.impliedApy ?? 0);
  return disclosure({
    title: 'Long-range history (daily)',
    summary: `${span} days`,
    quiet: true,
    children: [
      sparkline(values, 360, 56) ?? el('div', { class: 'muted', text: 'Not enough points to chart.' }),
      statGrid(
        stat('Average', formatPct(stats.mean), `over ${span} days`),
        stat('Volatility (σ)', formatPct(stats.stddev), 'across regimes'),
        stat('Low', formatPct(stats.min), 'daily low'),
        stat('High', formatPct(stats.max), 'daily high'),
      ),
      el('div', { class: 'hint', text: 'Daily points, up to Pendle’s ~1440-point cap. Not part of the score.' }),
    ],
  });
}

/* ---------------------------------- risk --------------------------------- */

function riskPanel(app: App, market: Market): HTMLElement {
  const info = market.info;
  const section = el('section', { class: 'panel' }, el('h3', { text: 'Risk notes' }));

  if (!app.state.settings.showRiskNotes) {
    append(section, el('div', { class: 'muted', text: 'Risk notes hidden in Settings.' }));
  } else {
    const hasAny = info.assetDescription || info.riskInvolved || info.importantQuirks || info.withdrawalNote;
    if (!hasAny) {
      append(section, el('div', { class: 'muted', text: 'Pendle has not published risk notes for this market. Treat that as unknown, not safe.' }));
    }
    if (info.assetDescription) append(section, note('What it is', info.assetDescription));
    if (info.riskInvolved) append(section, note('Risk involved', info.riskInvolved, 'warn'));
    if (info.importantQuirks) append(section, note('Quirks', info.importantQuirks));
    if (info.withdrawalNote) append(section, note('Exiting', info.withdrawalNote));
    if (info.conversionRate) append(section, note('Conversion', info.conversionRate));
  }

  const link = info.auditedUrl && info.auditedUrl.trim() !== '' ? info.auditedUrl.trim() : null;
  if (link) {
    append(
      section,
      el(
        'div',
        { class: 'audit-line' },
        el('button', {
          class: 'btn btn-ghost btn-small',
          text: 'Audit / review link ↗',
          on: { click: () => openExternal(link) },
        }),
      ),
    );
  } else {
    append(
      section,
      chip('No audit link on file', 'warn'),
      el('div', {
        class: 'muted',
        text: 'Pendle publishes no audit link for this market — that is a gap in our links, not proof that no audit exists.',
      }),
    );
  }

  if (info.utilizedProtocols.length > 0) {
    append(
      section,
      el(
        'div',
        { class: 'protocol-list' },
        el('div', { class: 'stat-label', text: 'Utilized protocols' }),
        ...info.utilizedProtocols.map((protocol) =>
          el('button', {
            class: 'btn btn-ghost btn-small',
            text: protocol.name,
            on: { click: () => protocol.url && openExternal(protocol.url) },
          }),
        ),
      ),
    );
  }
  return section;
}

/* --------------------------------- score --------------------------------- */

function scorePanel(app: App, score: MarketScore): HTMLElement {
  return el(
    'section',
    { class: 'panel' },
    el('h3', { text: 'Why this score' }),
    el('div', {
      class: 'hint',
      text: 'Six factors, each 0–100 and weighted, with the measurement behind every one. Method explains the bands and what each factor cannot see.',
    }),
    factorList(score, () => app.openMethod()),
    protocolNote(score),
  );
}

/**
 * The protocol factor is an objective depth measurement, not a review. This
 * note spells out the facts behind the number so the score is auditable, and
 * states plainly that the app makes no protocol judgement.
 */
function protocolNote(score: MarketScore): HTMLElement {
  const depth = score.protocolDepth;
  if (!depth) {
    return el(
      'div',
      { class: 'note warn' },
      el('div', { class: 'stat-label', text: 'Protocol depth — unavailable' }),
      el('p', { text: 'No depth data for this protocol in the current snapshot.' }),
    );
  }
  const facts = [
    `${depth.markets} market${depth.markets === 1 ? '' : 's'}`,
    `${depth.chains} chain${depth.chains === 1 ? '' : 's'}`,
    `${formatCompactUsd(depth.tvlUsd)} TVL`,
    depth.isPrime ? 'Prime' : null,
  ].filter((part): part is string => Boolean(part));
  return el(
    'div',
    { class: 'note warn' },
    el('div', { class: 'stat-label', text: 'Protocol depth — measured, not judged' }),
    el('p', {
      text: `Depth ${Math.round(depth.score * 100)}/100 on the protocol factor, from the snapshot: ${facts.join(', ')}. The app makes no protocol-level judgement — this is size and breadth, never trust. Check the protocol docs, audits and risk notes yourself.`,
    }),
  );
}

/* ------------------------- market data & contracts ------------------------ */

function marketDataPanel(market: Market, extras: MarketExtras, remoteLogos: boolean): HTMLElement {
  const rows: (HTMLElement | null)[] = [
    market.marketType ? stat('Market type', market.marketType, market.isVolatile ? 'variable underlying' : 'stable underlying') : null,
    market.ptRoi !== null ? stat('PT ROI to maturity', formatPct(market.ptRoi), 'provider, at expiry') : null,
    market.ytRoi !== null ? stat('YT ROI to maturity', formatPct(market.ytRoi), 'provider, at expiry') : null,
    stat('TVL', formatCompactUsd(market.tvlUsd), 'incl. floating PT, not all exit-able'),
    stat('24h volume', formatCompactUsd(market.tradingVolumeUsd), 'recent trading'),
    stat('Underlying APY', formatPct(market.underlyingApy), `${market.underlyingAsset.symbol} variable rate`),
    stat('YT floating APY', formatPct(market.ytFloatingApy), 'earned by the YT side, not by you'),
    stat('AMM fee rate', formatPct(market.feeRate, 3), 'annualised; see cost to enter'),
    stat('Floating PT', formatAmount(market.floatingPt), 'PT held outside the AMM'),
    stat('Looping venues', String(market.externalProtocols.length), 'from the market payload'),
  ];

  const children: (HTMLElement | null)[] = [
    statGrid(...rows.filter((row): row is HTMLElement => row !== null)),
    kv('Market', market.address),
    kv('PT', market.pt.address),
    kv('Accounting asset', `${market.accountingAsset.symbol} · ${market.accountingAsset.address}`),
    kv('Underlying', `${market.underlyingAsset.symbol} · ${market.underlyingAsset.address}`),
    kv('Provider updated', formatRelative(market.updatedAt)),
  ];

  if (remoteLogos && market.icon) children.push(kv('Logo', market.icon));
  if (extras.errors.length > 0) {
    children.push(
      el('div', { class: 'hint', text: `Some detail endpoints failed and were skipped: ${extras.errors.join(', ')}.` }),
    );
  }

  return disclosure({
    title: 'Market data & contracts',
    summary: `${formatCompactUsd(market.tvlUsd)} TVL · ${formatCompactUsd(market.tradingVolumeUsd)} 24h`,
    children,
  });
}

/* -------------------------------- helpers -------------------------------- */

function note(label: string, body: string, kind = ''): HTMLElement {
  return el('div', { class: `note ${kind}`.trim() }, el('div', { class: 'stat-label', text: label }), el('p', { text: body }));
}

function kv(label: string, value: string): HTMLElement {
  return el('div', { class: 'kv' }, el('span', { class: 'kv-label', text: label }), el('span', { class: 'kv-value', text: value }));
}
