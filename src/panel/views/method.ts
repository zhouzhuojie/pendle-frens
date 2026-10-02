import type { App } from '../app';
import { append, el } from '../dom';
import {
  FACTOR_DOCS,
  FACTOR_LABELS,
  FACTOR_ORDER,
  FLAG_DOCS,
  SCORE_EXPLAINER,
  VERDICT_LABEL,
  VERDICT_ORDER,
  VERDICT_RULE,
  SCORE_WEIGHTS,
} from '../../lib/domain/score';
import { STABILITY } from '../../lib/domain/history';
import { PROTOCOL_DEPTH } from '../../lib/domain/protocol';
import { barChart } from '../chart';
import { chip, verdictChip } from '../components';
import type { Verdict } from '../../lib/domain/types';

/**
 * The scoring explainer.
 *
 * Every number on this page comes from the exported constants that the scorer
 * itself uses, so the documentation cannot drift away from the behaviour.
 */
export function renderMethod(app: App): HTMLElement {
  const view = el('div', { class: 'view view-method' });

  append(
    view,
    el('button', { class: 'back', text: '← Back', on: { click: () => app.closeMethod() } }),
    el(
      'header',
      { class: 'detail-head' },
      el(
        'div',
        {},
        el('h2', { class: 'detail-title', text: 'How the risk-adjusted score works' }),
        el('div', {
          class: 'hint',
          text: 'Six factors, each scored 0–100 and weighted. Every one of them is shown on every market, including the measurement behind it.',
        }),
      ),
    ),
    el(
      'section',
      { class: 'panel' },
      el('h3', { text: 'The formula' }),
      el('div', { class: 'formula', text: SCORE_EXPLAINER.formula }),
      el('div', {
        class: 'hint',
        text: 'If a factor cannot be computed (for example a market with no price history), it is dropped and the remaining weights are re-normalized to sum to 1 — so the score is always on the same 0–100 scale.',
      }),
      barChart(
        FACTOR_ORDER.map((key) => ({
          label: FACTOR_LABELS[key],
          value: SCORE_WEIGHTS[key] * 100,
          caption: '% of score',
        })),
        (value) => `${value.toFixed(0)}%`,
        'Default weights',
      ),
    ),
  );

  for (const key of FACTOR_ORDER) {
    const doc = FACTOR_DOCS[key];
    const weight = SCORE_WEIGHTS[key] * 100;
    append(
      view,
      el(
        'section',
        { class: 'panel factor-doc' },
        el(
          'div',
          { class: 'factor-doc-head' },
          el('h3', { text: FACTOR_LABELS[key] }),
          chip(`${weight.toFixed(0)}% of score`, 'muted'),        ),
        el('p', { class: 'factor-question', text: doc.question }),
        block('How it scores', doc.method),
        block('Why this weight', doc.why),
        block('What it cannot see', doc.caveat, 'warn'),
      ),
    );
  }

  append(
    view,
    el(
      'section',
      { class: 'panel' },
      el('h3', { text: 'How a verdict is assigned' }),
      el('div', {
        class: 'hint',
        text: 'The verdict is a separate, stricter gate from the score. A market can score well and still be "degens only" if it fails a conservative rule.',
      }),
      ...(['safe', 'balanced', 'degen', 'avoid'] as Verdict[])
        .sort((a, b) => VERDICT_ORDER[a] - VERDICT_ORDER[b])
        .map((verdict) =>
          el(
            'div',
            { class: 'verdict-row' },
            el('div', { class: 'verdict-row-head' }, verdictChip(verdict), el('span', { class: 'muted', text: VERDICT_LABEL[verdict] })),
            el('p', { text: VERDICT_RULE[verdict] }),
          ),
        ),
    ),
    el(
      'section',
      { class: 'panel' },
      el('h3', { text: 'Protocol depth — measured, not judged' }),
      el('div', {
        class: 'hint',
        text: `There is no curated list and no "unknown" state. Every protocol is scored the same way, from facts in the snapshot: total TVL (${(PROTOCOL_DEPTH.weights.tvl * 100).toFixed(0)}%), number of active markets (${(PROTOCOL_DEPTH.weights.markets * 100).toFixed(0)}%), number of chains (${(PROTOCOL_DEPTH.weights.chains * 100).toFixed(0)}%) and Pendle's Prime flag (${(PROTOCOL_DEPTH.weights.prime * 100).toFixed(0)}%), squeezed into ${Math.round(PROTOCOL_DEPTH.floor * 100)}–${Math.round(PROTOCOL_DEPTH.ceiling * 100)}.`,
      }),
      el('div', {
        class: 'hint',
        text: 'This measures size and breadth, never trust. A protocol can be enormous and still fail tomorrow — the app makes no protocol-level judgement, and nothing here is a substitute for reading a protocol\u2019s own audits and risk notes.',
      }),
    ),
    el(
      'section',
      { class: 'panel' },
      el('h3', { text: 'Flags you will see' }),
      el('div', {
        class: 'hint',
        text: 'Flags never change the score. They are statements of fact you should read before trusting the number.',
      }),
      ...Object.entries(FLAG_DOCS).map(([flag, text]) =>
        el('div', { class: 'flag-row' }, el('code', { text: flag }), el('span', { text })),
      ),
    ),
    el(
      'section',
      { class: 'panel' },
      el('h3', { text: 'Sanity check: stability factor, in numbers' }),
      el('div', {
        class: 'hint',
        text: `Calmness counts for ${(STABILITY.calmWeight * 100).toFixed(0)}% of this factor (100 points at σ 0%, 0 points at σ ${(STABILITY.volatilityCap * 100).toFixed(0)}%) and consistency counts for ${(STABILITY.coverageWeight * 100).toFixed(0)}% (the share of hourly samples at or above the benchmark). Below ${STABILITY.minSamples} samples it is excluded entirely.`,
      }),
    ),
    el(
      'section',
      { class: 'panel' },
      el('h3', { text: 'What this score is not' }),
      el('ul', { class: 'plain-list' }, ...SCORE_EXPLAINER.redFlags.map((flag) => el('li', { text: flag }))),
    ),
    el('div', {
      class: 'disclaimer',
      text: 'Want to change it? Every threshold lives in src/lib/domain/score.ts, and protocol depth in src/lib/domain/protocol.ts — the same constants this page is built from.',
    }),
  );

  return view;
}

function block(label: string, body: string, kind = ''): HTMLElement {
  return el(
    'div',
    { class: `factor-block ${kind}`.trim() },
    el('div', { class: 'stat-label', text: label }),
    el('p', { text: body }),
  );
}
