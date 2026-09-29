import type { App } from '../app';
import { append, el, openExternal } from '../dom';
import { chip, scoreBlock, stat, statGrid, verdictChip } from '../components';
import { daysUntil, formatCompactUsd, formatDate, formatPct, formatSignedPct } from '../../lib/domain/format';
import { chainName } from '../../lib/domain/chains';

export function renderFavorites(app: App): HTMLElement {
  const view = el('div', { class: 'view view-favorites' });
  const items = app.state.favorites;

  if (items.length === 0) {
    append(
      view,
      el('div', {
        class: 'empty',
        text: 'No favorites yet. Hit ☆ on any market in Discover and it will show up here with a live spread.',
      }),
    );
    return view;
  }

  for (const item of items) {
    const market = app.marketById(item.marketId);
    const score = market ? app.scoreFor(market) : null;
    const currentApy = market?.impliedApy ?? null;
    const delta = currentApy === null ? null : currentApy - item.addedImpliedApy;
    const addedBenchmark = item.addedBenchmarkPct ?? app.state.benchmark.pct;
    const addedSpread = item.addedImpliedApy - addedBenchmark;

    append(
      view,
      el(
        'article',
        { class: `card ${score?.verdict === 'avoid' ? 'avoid' : ''}`.trim() },
        el(
          'header',
          { class: 'card-head' },
          score ? scoreBlock(score) : null,
          el(
            'div',
            { class: 'card-title' },
            el('div', { class: 'favorite-name', text: market ? `${market.name} · ${market.underlyingAsset.symbol}` : item.name }),
            el(
              'div',
              { class: 'card-sub' },
              chip(item.protocol, 'muted'),
              chip(chainName(item.chainId), 'muted'),
              el('span', { class: 'muted', text: `added ${formatDate(item.addedAt)}` }),
              score ? verdictChip(score.verdict) : null,
            ),
          ),
          el('button', {
            class: 'icon-btn',
            text: '✕',
            title: 'Remove from favorites',
            on: { click: () => void removeItem(app, item.marketId) },
          }),
        ),
        market
          ? statGrid(
              stat('Fixed APY now', formatPct(currentApy), `when added ${formatPct(item.addedImpliedApy)}`, true),
              stat(
                'Spread vs benchmark',
                formatSignedPct(app.spreadFor(market)),
                `was ${formatSignedPct(addedSpread)} at ${formatPct(addedBenchmark)}`,
              ),
              stat('Change since added', delta === null ? '—' : formatSignedPct(delta), 'rate drift, not P&L'),
              stat('Maturity', `${Math.round(daysUntil(market.expiry))}d`, formatDate(market.expiry)),
            )
          : el('div', { class: 'muted', text: 'This market is no longer in the active snapshot (expired or delisted).' }),
        market
          ? el(
              'footer',
              { class: 'card-actions' },
              el('button', { class: 'btn btn-primary btn-small', text: 'Simulate', on: { click: () => app.openSimulator(market.id) } }),
              el('button', { class: 'btn btn-small', text: 'Details', on: { click: () => app.openDetail(market.id) } }),
              el('button', {
                class: 'btn btn-small',
                text: `Liquidity ${formatCompactUsd(market.liquidityUsd)} · Pendle ↗`,
                on: { click: () => openExternal(app.marketLink(market)) },
              }),
            )
          : null,
      ),
    );
  }

  return view;
}

async function removeItem(app: App, marketId: string): Promise<void> {
  const { removeFavorite } = await import('../../lib/storage/store');
  app.state.favorites = await removeFavorite(marketId);
  app.render();
}
