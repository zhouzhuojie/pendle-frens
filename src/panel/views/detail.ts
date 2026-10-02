import type { App } from '../app';
import { append, el, openExternal, sparkline } from '../dom';
import { chip, disclosure, factorList, scoreBlock, stat, statGrid, verdictChip } from '../components';
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
import { analyzeHistory } from '../../lib/domain/history';
import { chainName } from '../../lib/domain/chains';
import { buildDecisionBrief, type DecisionBrief } from '../../lib/domain/decision';
import { VERDICT_RULE } from '../../lib/domain/score';
import type { HistoryPoint, HistoryStats, Market, MarketScore } from '../../lib/domain/types';

/**
 * The market detail page, ordered by the decision rather than by the data.
 *
 * A PT buyer asks four things, in order: what do I earn, what do I get back,
 * what does it cost, and what could go wrong. The top of this page answers
 * those and nothing else; the raw statistics, provider notes and contract
 * addresses are still here, but lower and behind a heading. Every number that
 * used to sit in an undifferentiated wall is either given a job or demoted.
 */
export function renderDetail(app: App, marketId: string): HTMLElement {
  const market = app.marketById(marketId);
  if (!market) return el('div', { class: 'empty', text: 'Market not found.' });

  const score = app.scoreFor(market);
  const days = daysUntil(market.expiry);
  const history = app.state.history.get(marketId) ?? null;
  const stats = history ? analyzeHistory(history, app.state.benchmark.pct) : null;
  const favorited = app.isFavorite(marketId);
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
          {},
          el('h2', { class: 'detail-title', text: `${market.name} · ${market.underlyingAsset.symbol}` }),
          el(
            'div',
            { class: 'card-sub' },
            chip(market.protocol, 'muted'),
            chip(chainName(market.chainId), 'muted'),
            market.isPrime ? chip('Prime', 'good') : null,
            verdictChip(score.verdict),
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
    decisionPanel(brief, score, days, market),
    payoutPanel(brief, market),
    historyPanel(history, stats),
    riskPanel(app, market),
    scorePanel(app, score),
    marketDataPanel(market),
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
function decisionPanel(brief: DecisionBrief, score: MarketScore, days: number, market: Market): HTMLElement {
  return el(
    'section',
    { class: 'panel panel-decision' },
    el('p', {
      class: 'decision-intro',
      text: 'A PT is a fixed-rate loan to this protocol. You pay below par today and receive one accounting-asset unit at maturity, so the trade is fixed only if you hold it. Decide on four things: what you earn over the risk-free rate, what you get back, what it costs to get in, and what could go wrong.',
    }),
    el('p', { class: 'decision-headline', text: brief.headline }),
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

/* ------------------------------ yield history ----------------------------- */

function historyPanel(history: HistoryPoint[] | null, stats: HistoryStats | null): HTMLElement {
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
    el('div', {
      class: 'hint',
      text: 'History covers roughly the last 2 months at hourly resolution — the Pendle API caps this window, so it cannot see a full credit cycle.',
    }),
  );
  return section;
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

/**
 * Everything that used to sit in the headline grid but does not inform the
 * decision: TVL (which includes PT you could not exit against), the variable
 * rates of the other side of the trade, the annualised fee rate (the real cost
 * is above), and contract addresses.
 */
function marketDataPanel(market: Market): HTMLElement {
  return disclosure({
    title: 'Market data & contracts',
    summary: `${formatCompactUsd(market.tvlUsd)} TVL · ${formatCompactUsd(market.tradingVolumeUsd)} 24h`,
    children: [
      statGrid(
        stat('TVL', formatCompactUsd(market.tvlUsd), 'incl. floating PT, not all exit-able'),
        stat('24h volume', formatCompactUsd(market.tradingVolumeUsd), 'recent trading'),
        stat('Underlying APY', formatPct(market.underlyingApy), `${market.underlyingAsset.symbol} variable rate`),
        stat('YT floating APY', formatPct(market.ytFloatingApy), 'earned by the YT side, not by you'),
        stat('AMM fee rate', formatPct(market.feeRate, 3), 'annualised; see cost to enter'),
        stat('Floating PT', formatAmount(market.floatingPt), 'PT held outside the AMM'),
      ),
      kv('Market', market.address),
      kv('PT', market.pt.address),
      kv('Accounting asset', `${market.accountingAsset.symbol} · ${market.accountingAsset.address}`),
      kv('Underlying', `${market.underlyingAsset.symbol} · ${market.underlyingAsset.address}`),
      kv('Provider updated', formatRelative(market.updatedAt)),
    ],
  });
}

/* -------------------------------- helpers -------------------------------- */

function note(label: string, body: string, kind = ''): HTMLElement {
  return el('div', { class: `note ${kind}`.trim() }, el('div', { class: 'stat-label', text: label }), el('p', { text: body }));
}

function kv(label: string, value: string): HTMLElement {
  return el('div', { class: 'kv' }, el('span', { class: 'kv-label', text: label }), el('span', { class: 'kv-value', text: value }));
}
