/** Reusable presentation components shared by all views. */

import { el, openExternal, type Child } from './dom';
import type { MarketScore, Verdict } from '../lib/domain/types';
import { FACTOR_DOCS, VERDICT_LABEL, VERDICT_RULE } from '../lib/domain/score';

export function chip(text: string, kind: 'neutral' | 'good' | 'warn' | 'bad' | 'muted' = 'neutral'): HTMLElement {
  return el('span', { class: `chip chip-${kind}`, text });
}

export function verdictChip(verdict: Verdict): HTMLElement {
  const kind = verdict === 'safe' ? 'good' : verdict === 'balanced' ? 'neutral' : verdict === 'degen' ? 'warn' : 'bad';
  return el('span', { class: `chip chip-${kind}`, text: VERDICT_LABEL[verdict], title: VERDICT_RULE[verdict] });
}

/**
 * The headline score: a large number, the verdict, and the colour that goes
 * with it. Used at card size and at detail size.
 *
 * There is deliberately no caption under the verdict. "risk-adjusted" appeared
 * under every score in the app and told the reader nothing the Method page had
 * not already said better.
 */
export function scoreBlock(score: MarketScore, large = false): HTMLElement {
  return el(
    'div',
    {
      class: `scoreblock verdict-${score.verdict}${large ? ' scoreblock-large' : ''}`,
      title: `${score.score}/100 risk-adjusted score · ${VERDICT_LABEL[score.verdict]}. ${VERDICT_RULE[score.verdict]}`,
    },
    el(
      'div',
      { class: 'scoreblock-top' },
      el('span', { class: 'scoreblock-number', text: String(score.score) }),
      el('span', { class: 'scoreblock-denom', text: '/100' }),
    ),
    el('div', { class: 'scoreblock-verdict', text: VERDICT_LABEL[score.verdict] }),
  );
}

/** One label / value / sub-label stack. The only metric primitive in the UI. */
export function stat(label: string, value: Child, sub?: Child, accent = false): HTMLElement {
  return el(
    'div',
    { class: 'stat' },
    el('div', { class: 'stat-label', text: label }),
    el('div', { class: `stat-value${accent ? ' accent' : ''}`.trim() }, value),
    sub === undefined ? null : el('div', { class: 'stat-sub' }, sub),
  );
}

export function statGrid(...items: Child[]): HTMLElement {
  return el('div', { class: 'stats' }, ...items);
}

/**
 * A labelled control. Every input and select in the panel goes through this, so
 * that nothing has to rely on a placeholder or a `title` tooltip to explain
 * itself — neither is visible on touch, or to anyone not hovering.
 */
export function field(label: string, control: Child, wide = false): HTMLElement {
  return el(
    'label',
    { class: `field${wide ? ' field-wide' : ''}` },
    el('span', { class: 'field-label', text: label }),
    control,
  );
}

/**
 * A collapsible block, with a value on the summary row that stays readable while
 * collapsed.
 *
 * The simulator produces a lot of forensics, and every one of them is worth
 * being able to read — but not all at once, and not before the answer. This is
 * how the page stays dense without being a wall: the headline stays open, the
 * derivations are one click away, and the summary line means you can tell what a
 * collapsed block contains without opening it.
 */
export function disclosure(opts: {
  title: string;
  /** Right-aligned on the summary row, visible while collapsed. */
  summary?: string;
  /** Footnote styling: smaller and muted. For assumptions, not for findings. */
  quiet?: boolean;
  open?: boolean;
  children: Child[];
}): HTMLElement {
  return el(
    'details',
    {
      class: `disclosure${opts.quiet ? ' disclosure-quiet' : ''}`,
      attrs: { open: opts.open ? '' : null },
    },
    el(
      'summary',
      { class: 'disclosure-head' },
      el('span', { class: 'disclosure-title', text: opts.title }),
      opts.summary ? el('span', { class: 'disclosure-summary', text: opts.summary }) : null,
    ),
    el('div', { class: 'disclosure-body' }, ...opts.children),
  );
}

/**
 * The score, factor by factor: what it scored, how much it counted, the actual
 * measurement, and the plain-English question the factor is answering.
 */
export function factorList(score: MarketScore, onExplain?: () => void): HTMLElement {
  return el(
    'ul',
    { class: 'factors' },
    ...score.factors.map((factor) => {
      const bar = el('span', {});
      bar.style.width = `${Math.round(factor.value * 100)}%`;
      const doc = FACTOR_DOCS[factor.key];
      return el(
        'li',
        {},
        el(
          'div',
          { class: 'factor-top' },
          el('span', { class: 'factor-label', text: factor.label }),
          el('span', {
            class: 'factor-value',
            text: `${Math.round(factor.value * 100)}/100 · weight ${Math.round(factor.weight * 100)}%`,
          }),
        ),
        el('div', { class: 'meter' }, bar),
        el('div', { class: 'factor-measured', text: factor.detail }),
        el('div', { class: 'factor-question', text: doc.question }),
      );
    }),
    onExplain
      ? el(
          'li',
          { class: 'factor-more' },
          el('button', { class: 'link-inline', text: 'How each dimension is computed →', on: { click: onExplain } }),
        )
      : null,
  );
}

export function errorBox(message: string): HTMLElement {
  return el('div', { class: 'error-box' }, el('strong', { text: 'Something went wrong' }), el('div', { text: message }));
}

export function spinner(label = 'Loading…'): HTMLElement {
  return el('div', { class: 'spinner' }, el('span', { class: 'dot' }), label);
}

export function externalButton(label: string, url: string, className = 'btn btn-ghost btn-small'): HTMLElement {
  return el('button', { class: className, text: label, on: { click: () => openExternal(url) } });
}

export function linkInline(label: string, onClick: () => void): HTMLElement {
  return el('button', { class: 'link-inline', text: label, on: { click: onClick } });
}

/**
 * A market's mark: initials on a hue derived from its id.
 *
 * Pendle offers a logo URL, but loading it would make a request to a third
 * host (currently `storage.googleapis.com`) and reveal which markets a reader is
 * looking at. The default is therefore a local monogram; the `remoteLogos`
 * setting opts into the real image, `no-referrer`, for people who want it.
 */
export function avatar(
  symbol: string,
  seed: string,
  iconUrl: string | null,
  opts: { large?: boolean; remote?: boolean } = {},
): HTMLElement {
  if (opts.remote && iconUrl) {
    return el('img', {
      class: `avatar avatar-img${opts.large ? ' avatar-large' : ''}`,
      attrs: { src: iconUrl, alt: symbol, loading: 'lazy', referrerpolicy: 'no-referrer' },
    });
  }
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) % 360;
  const node = el('span', {
    class: `avatar${opts.large ? ' avatar-large' : ''}`,
    text: initials(symbol),
    title: symbol,
    attrs: { 'aria-hidden': 'true' },
  });
  node.style.setProperty('--avatar-hue', String(hash));
  return node;
}

function initials(text: string): string {
  const cleaned = text.replace(/[^a-zA-Z0-9]/g, '');
  if (cleaned === '') return '?';
  return cleaned.slice(0, 2).toUpperCase();
}
