import type { App } from '../app';
import type { Settings } from '../../lib/domain/types';
import { append, el, openExternal } from '../dom';
import { field } from '../components';
import { CHAINS } from '../../lib/domain/chains';
import { DEFAULT_SETTINGS } from '../../lib/storage/store';
import { DATA_SOURCES } from '../constants';
import { formatPct } from '../../lib/domain/format';

export function renderSettings(app: App): HTMLElement {
  const settings = app.state.settings;
  const view = el('div', { class: 'view view-settings' });
  const save = (patch: Partial<Settings>) => void app.updateSettings(patch);

  /* --------------------------------- chains -------------------------------- */
  append(
    view,
    section(
      'Chains to scan',
      hint('Fewer chains = faster refresh and less API budget. Ethereum and Arbitrum hold the deepest PT liquidity.'),
      el(
        'div',
        { class: 'check-grid' },
        ...CHAINS.map((chain) =>
          toggle(chain.name, settings.chains.includes(chain.id), (checked) => {
            const chains = checked
              ? Array.from(new Set([...settings.chains, chain.id])).sort((a, b) => a - b)
              : settings.chains.filter((id) => id !== chain.id);
            if (chains.length > 0) save({ chains });
          }),
        ),
      ),
    ),
    section(
      'Screening thresholds',
      numberField('Minimum maturity (days)', settings.minMaturityDays, { min: 1 }, (value) => save({ minMaturityDays: value })),
      numberField('Minimum pool liquidity (USD)', settings.minLiquidityUsd, { min: 0, step: 100_000 }, (value) =>
        save({ minLiquidityUsd: value }),
      ),
      toggle('Hide protocols not in the registry', settings.hideUnknownProtocols, (checked) => save({ hideUnknownProtocols: checked })),
      toggle('Show curated risk notes on market details', settings.showRiskNotes, (checked) => save({ showRiskNotes: checked })),
    ),
    section(
      'Simulation defaults',
      numberField('Default size (USD)', settings.defaultSizeUsd, { min: 100, step: 1_000 }, (value) => save({ defaultSizeUsd: value })),
      numberField('Slippage tolerance (%)', settings.slippagePct, { min: 0.1, step: 0.1 }, (value) => save({ slippagePct: value })),
      numberField('Gas price (gwei)', settings.gasPriceGwei, { min: 0.1, step: 0.1 }, (value) => save({ gasPriceGwei: value })),
    ),
    section(
      'Benchmark',
      hint(
        'Default is the U.S. Treasury average rate on outstanding Treasury Notes. It lags the live curve — override it if you track the 10-year yield yourself.',
      ),
      field(
        'Override benchmark (%) — empty means auto',
        el('input', {
          class: 'input',
          attrs: { type: 'number', step: '0.01', placeholder: 'auto' },
          value: settings.benchmarkOverridePct === null ? '' : (settings.benchmarkOverridePct * 100).toFixed(2),
          on: {
            change: (event) => {
              const raw = (event.target as HTMLInputElement).value.trim();
              if (raw === '') {
                save({ benchmarkOverridePct: null });
                return;
              }
              const pct = Number(raw);
              if (Number.isFinite(pct)) save({ benchmarkOverridePct: pct / 100 });
            },
          },
        }),
      ),
      el(
        'div',
        { class: 'kv' },
        el('span', { class: 'kv-label', text: 'Active benchmark' }),
        el('span', { class: 'kv-value', text: `${formatPct(app.state.benchmark.pct)} · ${app.state.benchmark.label}` }),
      ),
    ),
    section(
      'Data & privacy',
      hint(
        'The extension talks only to the two public APIs below. No analytics, no remote code, no wallet access. Everything you save stays in chrome.storage.local.',
      ),
      el(
        'div',
        { class: 'row wrap' },
        ...DATA_SOURCES.map((source) =>
          el('button', { class: 'btn btn-ghost btn-small', text: source.label, on: { click: () => openExternal(source.url) } }),
        ),
      ),
      el(
        'div',
        { class: 'row' },
        el('button', {
          class: 'btn btn-ghost btn-small',
          text: 'Clear cached data',
          on: {
            click: async () => {
              const { clearRemoteCaches } = await import('../../lib/api/client');
              await clearRemoteCaches();
              app.setStatus('Caches cleared', 'info');
              app.render();
            },
          },
        }),
        el('button', {
          class: 'btn btn-ghost btn-small',
          text: 'Reset all settings',
          on: { click: () => save({ ...DEFAULT_SETTINGS }) },
        }),
      ),
    ),
    el('div', { class: 'disclaimer', text: 'Pendle Frens is an independent research tool and is not affiliated with Pendle. DYOR.' }),
  );

  return view;
}

function section(title: string, ...children: (Node | null)[]): HTMLElement {
  return el('section', { class: 'panel' }, el('h3', { text: title }), ...children.filter((c): c is Node => c !== null));
}

function hint(text: string): HTMLElement {
  return el('div', { class: 'hint', text });
}

function toggle(label: string, checked: boolean, onChange: (checked: boolean) => void): HTMLElement {
  return el(
    'label',
    { class: 'check' },
    el('input', {
      attrs: { type: 'checkbox' },
      checked,
      on: { change: (event) => onChange((event.target as HTMLInputElement).checked) },
    }),
    el('span', { text: label }),
  );
}

function numberField(
  label: string,
  value: number,
  options: { min: number; step?: number },
  onChange: (value: number) => void,
): HTMLElement {
  return field(
    label,
    el('input', {
      class: 'input',
      attrs: { type: 'number', min: String(options.min), step: String(options.step ?? 1) },
      value: String(value),
      on: {
        change: (event) => {
          const next = Number((event.target as HTMLInputElement).value);
          if (Number.isFinite(next) && next >= options.min) onChange(next);
        },
      },
    }),
  );
}
