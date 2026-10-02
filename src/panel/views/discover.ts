import type { App, AssetClassFilter, Candidate, SortKey } from '../app';
import { screenMarkets, summarizeHidden } from '../../lib/domain/screen';
import { append, clear, el } from '../dom';
import { avatar, chip, field, linkInline, scoreBlock, stat, statGrid } from '../components';
import { formatCompactUsd, formatPct, formatSignedPct } from '../../lib/domain/format';
import { chainName } from '../../lib/domain/chains';

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'score', label: 'Best score' },
  { key: 'apy', label: 'Highest fixed APY' },
  { key: 'spread', label: 'Biggest spread' },
  { key: 'liquidity', label: 'Deepest liquidity' },
  { key: 'maturity', label: 'Soonest maturity' },
];

const ASSET_CLASSES: { key: AssetClassFilter; label: string }[] = [
  { key: 'all', label: 'All collateral' },
  { key: 'stable', label: 'Stablecoins' },
  { key: 'rwa', label: 'RWA' },
  { key: 'eth-staking', label: 'ETH staking' },
  { key: 'eth', label: 'ETH' },
  { key: 'btc', label: 'BTC' },
  { key: 'other', label: 'Other' },
];

export function renderDiscover(app: App): HTMLElement {
  const view = el('div', { class: 'view view-discover' });
  const list = el('div', { class: 'market-list' });
  const summary = el('div', { class: 'callout-slot' });
  const count = el('div', { class: 'results-line' });

  const paint = () => {
    const result = screenMarkets(app.candidates(), app.state.discover, app.state.settings);
    const filters = app.state.discover;
    const total = result.included.length + result.totalHidden;

    count.textContent =
      result.included.length === total
        ? `${total} market${total === 1 ? '' : 's'}`
        : `Showing ${result.included.length} of ${total} markets`;

    clear(summary);
    if (filters.showHidden) {
      append(
        summary,
        el(
          'div',
          { class: 'callout' },
          el('span', {}, el('strong', { text: 'Showing everything. ' }), 'Markets that fail your bars are still labelled with their verdict and flags.'),
          el('button', { class: 'btn btn-small', text: 'Apply my filters', on: { click: () => toggleHidden(app) } }),
        ),
      );
    } else if (result.totalHidden > 0) {
      append(
        summary,
        el(
          'div',
          { class: 'callout' },
          el('span', {}, el('strong', { text: 'Hidden: ' }), summarizeHidden(result.hidden)),
          el('button', { class: 'btn btn-small', text: 'Show all', on: { click: () => toggleHidden(app) } }),
        ),
      );
    }

    clear(list);
    if (result.included.length === 0) {
      append(
        list,
        el('div', {
          class: 'empty',
          text:
            result.totalHidden > 0
              ? `All ${result.totalHidden} markets are hidden by your filters. Press "Show all" above, or loosen the bars in Settings.`
              : 'No markets match these filters.',
        }),
      );
      return;
    }
    for (const candidate of result.included) append(list, marketCard(app, candidate));
  };

  const search = el('input', {
    class: 'input',
    attrs: { type: 'search', placeholder: 'reUSD, Aave, USDC…' },
    value: app.state.discover.query,
    on: {
      input: (event) => {
        app.state.discover.query = (event.target as HTMLInputElement).value;
        paint();
      },
    },
  });

  const sortSelect = el(
    'select',
    {
      class: 'input',
      on: {
        change: (event) => {
          app.state.discover.sort = (event.target as HTMLSelectElement).value as SortKey;
          paint();
        },
      },
    },
    ...SORTS.map((option) => el('option', { value: option.key, text: option.label, checked: option.key === app.state.discover.sort })),
  );

  const chainsPresent = Array.from(new Set(app.markets().map((market) => market.chainId))).sort((a, b) => a - b);
  const chainSelect = el(
    'select',
    {
      class: 'input',
      on: {
        change: (event) => {
          const raw = (event.target as HTMLSelectElement).value;
          app.state.discover.chain = raw === 'all' ? 'all' : Number(raw);
          paint();
        },
      },
    },
    el('option', { value: 'all', text: 'All chains', checked: app.state.discover.chain === 'all' }),
    ...chainsPresent.map((id) => el('option', { value: String(id), text: chainName(id), checked: app.state.discover.chain === id })),
  );

  const classSelect = el(
    'select',
    {
      class: 'input',
      on: {
        change: (event) => {
          app.state.discover.assetClass = (event.target as HTMLSelectElement).value as AssetClassFilter;
          paint();
        },
      },
    },
    ...ASSET_CLASSES.map((option) =>
      el('option', { value: option.key, text: option.label, checked: option.key === app.state.discover.assetClass }),
    ),
  );

  const minSpread = el('input', {
    class: 'input',
    attrs: { type: 'number', min: '0', step: '0.5' },
    value: String(app.state.discover.minSpreadPct),
    on: {
      input: (event) => {
        const value = Number((event.target as HTMLInputElement).value);
        app.state.discover.minSpreadPct = Number.isFinite(value) ? value : 0;
        paint();
      },
    },
  });

  append(
    view,
    el(
      'div',
      { class: 'filters' },
      field('Search', search, true),
      el(
        'div',
        { class: 'filter-row' },
        field('Sort by', sortSelect),
        field('Chain', chainSelect),
        field('Collateral', classSelect),
        field('Min spread, pp', minSpread),
      ),
      el(
        'div',
        { class: 'filter-note' },
        el('span', {
          text: `Spread is the fixed APY minus the risk-free benchmark of ${formatPct(app.state.benchmark.pct)} (Treasury Notes — change it in Settings). The score weighs rate, exit liquidity, protocol, maturity, collateral and yield stability.`,
        }),
        linkInline('How the score works →', () => app.openMethod()),
      ),
    ),
    count,
    summary,
    list,
  );

  paint();
  return view;
}

function toggleHidden(app: App): void {
  app.state.discover.showHidden = !app.state.discover.showHidden;
  app.render();
}

function marketCard(app: App, candidate: Candidate): HTMLElement {
  const { market, score, spread, daysToMaturity } = candidate;
  const favorited = app.isFavorite(market.id);

  return el(
    'article',
    { class: `card ${score.verdict === 'avoid' ? 'avoid' : ''}`.trim() },
    el(
      'header',
      { class: 'card-head' },
      scoreBlock(score),
      el(
        'div',
        { class: 'card-title-row' },
        avatar(market.underlyingAsset.symbol, market.id, market.icon, { remote: app.state.settings.remoteLogos }),
        el(
          'div',
          { class: 'card-title' },
          el('button', {
            class: 'link-title',
            text: `${market.name} · ${market.underlyingAsset.symbol}`,
            on: { click: () => app.openDetail(market.id) },
          }),
          el(
            'div',
            { class: 'card-sub' },
            chip(market.protocol, 'muted'),
            chip(chainName(market.chainId), 'muted'),
            market.isPrime ? chip('Prime', 'good') : null,
            market.externalProtocols.length > 0 ? chip('Loopable', 'neutral') : null,
            market.isVolatile ? chip('Variable', 'warn') : null,
          ),
        ),
      ),
      el('button', {
        class: `icon-btn ${favorited ? 'active' : ''}`,
        text: favorited ? '★' : '☆',
        title: favorited ? 'Remove from favorites' : 'Add to favorites',
        on: { click: () => void app.toggleFavorite(market) },
      }),
    ),
    // Four equal columns, values only. Sub-labels repeated the same facts on
    // every card ("locked at entry", the benchmark, TVL); what is global is
    // stated once above the list, what is secondary lives on the detail view.
    statGrid(
      stat('Fixed APY', formatPct(market.impliedApy), undefined, true),
      stat('Spread', formatSignedPct(spread)),
      stat('Maturity', `${Math.round(daysToMaturity)}d`),
      stat('Liquidity', formatCompactUsd(market.liquidityUsd)),
    ),
    score.flags.length > 0
      ? el('div', { class: 'card-flags' }, ...score.flags.slice(0, 4).map((flag) => chip(flag.replace(/-/g, ' '), 'muted')))
      : null,
    el(
      'footer',
      { class: 'card-actions' },
      el('button', { class: 'btn btn-primary btn-small', text: 'Simulate', on: { click: () => app.openSimulator(market.id) } }),
      el('button', { class: 'btn btn-small', text: 'Details', on: { click: () => app.openDetail(market.id) } }),
      el('button', {
        class: 'btn btn-small',
        text: 'Pendle ↗',
        on: { click: () => void chrome.tabs.create({ url: app.marketLink(market) }) },
      }),
    ),
  );
}
