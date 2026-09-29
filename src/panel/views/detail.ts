import type { App } from '../app';
import { append, el, openExternal, sparkline } from '../dom';
import { chip, factorList, scoreBlock, stat, statGrid, verdictChip } from '../components';
import {
  daysUntil,
  formatAmount,
  formatCompactUsd,
  formatDate,
  formatPct,
  formatRelative,
  formatSignedPct,
  formatUsd,
} from '../../lib/domain/format';
import { analyzeHistory } from '../../lib/domain/history';
import { chainName } from '../../lib/domain/chains';
import { lookupProtocol, TIER_DOCS, auditLink, type ProtocolEntry } from '../../lib/domain/registry';
import type { Tier } from '../../lib/domain/types';

export function renderDetail(app: App, marketId: string): HTMLElement {
  const market = app.marketById(marketId);
  if (!market) return el('div', { class: 'empty', text: 'Market not found.' });

  const score = app.scoreFor(market);
  const spread = app.spreadFor(market);
  const days = daysUntil(market.expiry);
  const history = app.state.history.get(marketId) ?? null;
  const stats = history ? analyzeHistory(history, app.state.benchmark.pct) : null;
  const favorited = app.isFavorite(marketId);

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
            chip(market.protocol, score.protocolTier === 'unknown' ? 'bad' : 'muted'),
            chip(chainName(market.chainId), 'muted'),
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
    statGrid(
      stat('Fixed APY (implied)', formatPct(market.impliedApy), 'the rate you lock in', true),
      stat('Spread vs benchmark', formatSignedPct(spread), `benchmark ${formatPct(app.state.benchmark.pct)}`),
      stat('Matures', formatDate(market.expiry), `${Math.round(days)} days`),
      stat('PT price', formatUsd(market.pt.priceUsd ?? null, 4), `discount ${formatPct(market.ptDiscount)}`),
      stat('Pool liquidity', formatCompactUsd(market.liquidityUsd), 'what you exit against'),
      stat('TVL', formatCompactUsd(market.tvlUsd), `24h vol ${formatCompactUsd(market.tradingVolumeUsd)}`),
      stat('Underlying APY', formatPct(market.underlyingApy), `${market.underlyingAsset.symbol} variable rate`),
      stat('YT floating APY', formatPct(market.ytFloatingApy), 'earned by the other side of your trade'),
      stat('AMM fee rate', formatPct(market.feeRate, 3), 'charged on each swap'),
      stat('Floating PT', formatAmount(market.floatingPt), 'PT held outside the AMM'),
    ),
  );

  /* -------------------------------- history ------------------------------- */
  const historySection = el('section', { class: 'panel' }, el('h3', { text: 'Yield history' }));
  if (!history) {
    append(historySection, el('div', { class: 'spinner' }, el('span', { class: 'dot' }), 'Loading 2 months of hourly implied APY…'));
  } else if (!stats || stats.points < 2) {
    append(historySection, el('div', { class: 'muted', text: 'No usable history for this market.' }));
  } else {
    const values = history.map((p) => p.impliedApy ?? 0);
    const chart = sparkline(values, 360, 56);
    append(
      historySection,
      chart ?? el('div', { class: 'muted', text: 'Not enough points to chart.' }),
      statGrid(
        stat('Now', formatPct(history[history.length - 1]?.impliedApy ?? null), 'latest sample'),
        stat('Mean', formatPct(stats.mean), 'over the window'),
        stat('Min', formatPct(stats.min), 'lowest implied APY'),
        stat('Max', formatPct(stats.max), 'highest implied APY'),
        stat('Volatility (σ)', formatPct(stats.stddev), 'stddev of samples'),
        stat('Above benchmark', stats.coverage === null ? '—' : formatPct(stats.coverage, 0), 'share of samples'),
        stat('Trend per day', stats.trendPerDay === null ? '—' : formatSignedPct(stats.trendPerDay, 4), 'linear drift'),
        stat('Samples', String(stats.points), 'hourly points'),
      ),
      el('div', {
        class: 'hint',
        text: 'History covers roughly the last 2 months at hourly resolution — the Pendle API caps this window.',
      }),
    );
  }
  append(view, historySection);

  /* --------------------------------- score -------------------------------- */
  const registryEntry = lookupProtocol(market.protocol);
  append(
    view,
    el(
      'section',
      { class: 'panel' },
      el('h3', { text: 'Why this score' }),
      el('div', {
        class: 'hint',
        text: 'Each factor shows its 0–100 sub-score, how much of the total it carries, the measurement behind it, and the question it answers.',
      }),
      factorList(score, () => app.openMethod()),
      registryNote(registryEntry, score.protocolTier),
    ),
  );

  /* ---------------------------------- risk -------------------------------- */
  const info = market.info;
  const riskSection = el('section', { class: 'panel' }, el('h3', { text: 'Risk notes' }));
  if (!app.state.settings.showRiskNotes) {
    append(riskSection, el('div', { class: 'muted', text: 'Risk notes hidden in Settings.' }));
  } else {
    const hasAny = info.assetDescription || info.riskInvolved || info.importantQuirks || info.withdrawalNote;
    if (!hasAny) {
      append(riskSection, el('div', { class: 'muted', text: 'Pendle has not published risk notes for this market. Treat that as unknown, not safe.' }));
    }
    if (info.assetDescription) append(riskSection, note('What it is', info.assetDescription));
    if (info.riskInvolved) append(riskSection, note('Risk involved', info.riskInvolved, 'warn'));
    if (info.importantQuirks) append(riskSection, note('Quirks', info.importantQuirks));
    if (info.withdrawalNote) append(riskSection, note('Exiting', info.withdrawalNote));
    if (info.conversionRate) append(riskSection, note('Conversion', info.conversionRate));
  }
  const link = auditLink(market.protocol, info.auditedUrl);
  if (link) {
    append(
      riskSection,
      el(
        'div',
        { class: 'audit-line' },
        el('button', {
          class: 'btn btn-ghost btn-small',
          text: link.source === 'pendle' ? 'Audit / review link ↗' : `${market.protocol} audits ↗`,
          on: { click: () => openExternal(link.url) },
        }),
        link.source === 'registry'
          ? el('span', {
              class: 'muted',
              text: 'The protocol\u2019s own audit page. Pendle publishes no audit link for this market, and a protocol audit is not an audit of this market.',
            })
          : null,
      ),
    );
  } else {
    append(
      riskSection,
      chip('No audit link on file', 'warn'),
      el('div', {
        class: 'muted',
        text: 'Neither Pendle nor the registry links an audit for this protocol — that is a gap in our links, not proof that no audit exists.',
      }),
    );
  }
  if (info.utilizedProtocols.length > 0) {
    append(
      riskSection,
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
  append(view, riskSection);

  /* -------------------------------- addresses ----------------------------- */
  append(
    view,
    el(
      'section',
      { class: 'panel' },
      el('h3', { text: 'Contract & data' }),
      kv('Market', market.address),
      kv('PT', market.pt.address),
      kv('Accounting asset', `${market.accountingAsset.symbol} · ${market.accountingAsset.address}`),
      kv('Underlying', `${market.underlyingAsset.symbol} · ${market.underlyingAsset.address}`),
      kv('Provider updated', formatRelative(market.updatedAt)),
    ),
  );

  append(view, el('div', { class: 'disclaimer', text: 'Read-only. Verify every number on app.pendle.finance before signing anything.' }));

  return view;
}

function note(label: string, body: string, kind = ''): HTMLElement {
  return el('div', { class: `note ${kind}`.trim() }, el('div', { class: 'stat-label', text: label }), el('p', { text: body }));
}

/**
 * The registry's opinion on this protocol, shown in the app rather than only in
 * the source. `hideUnknownProtocols` can hide a market on the strength of this
 * tier, so the reasoning that produced it has to be readable.
 */
function registryNote(entry: ProtocolEntry | null, tier: Tier): HTMLElement {
  const body = [TIER_DOCS[tier], entry?.note].filter((part): part is string => Boolean(part)).join(' ');
  return el(
    'div',
    { class: `note ${tier === 'A' ? '' : 'warn'}`.trim() },
    el('div', { class: 'stat-label', text: `Registry — tier ${tier}${entry ? ` · ${entry.name}` : ''}` }),
    el('p', { text: body }),
    entry?.website
      ? el('button', {
          class: 'btn btn-ghost btn-small',
          text: `${entry.name} website ↗`,
          on: { click: () => openExternal(entry.website!) },
        })
      : null,
  );
}

function kv(label: string, value: string): HTMLElement {
  return el('div', { class: 'kv' }, el('span', { class: 'kv-label', text: label }), el('span', { class: 'kv-value', text: value }));
}
