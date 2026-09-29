/**
 * Small dependency-free charts.
 *
 * Deliberately minimal: an SVG line chart for value trajectories and a CSS bar
 * chart for cost comparison. Both are pure functions returning detached nodes,
 * so the render tests can assert on them without a browser.
 */

import { el } from './dom';

const NS = 'http://www.w3.org/2000/svg';

function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

export interface LinePoint {
  x: number;
  y: number;
}

export interface LineSeries {
  id: string;
  label: string;
  points: LinePoint[];
}

/** Horizontal reference line: a cost basis, an exit value, a peg, etc. */
export interface ReferenceLine {
  y: number;
  label: string;
  kind: 'basis' | 'exit';
}

export interface LineChartOptions {
  width?: number;
  height?: number;
  xMax: number;
  xFormat: (x: number) => string;
  yFormat: (y: number) => string;
}

const MARGIN = { left: 8, right: 62, top: 12, bottom: 20 };

export function lineChart(series: LineSeries[], refs: ReferenceLine[], options: LineChartOptions): HTMLElement {
  const width = options.width ?? 380;
  const height = options.height ?? 172;
  const plotW = width - MARGIN.left - MARGIN.right;
  const plotH = height - MARGIN.top - MARGIN.bottom;

  const ys = [
    ...series.flatMap((s) => s.points.map((p) => p.y)),
    ...refs.map((r) => r.y),
  ].filter((v) => Number.isFinite(v));

  if (ys.length < 2) return el('div', { class: 'hint', text: 'Not enough data to chart yet.' });

  const rawMin = Math.min(...ys);
  const rawMax = Math.max(...ys);
  const pad = (rawMax - rawMin || rawMax * 0.02 || 1) * 0.12;
  const yMin = rawMin - pad;
  const yMax = rawMax + pad;
  const xMax = options.xMax > 0 ? options.xMax : 1;

  const sx = (x: number) => MARGIN.left + (Math.max(0, x) / xMax) * plotW;
  const sy = (y: number) => MARGIN.top + (1 - (y - yMin) / (yMax - yMin)) * plotH;

  const root = svg('svg', {
    viewBox: `0 0 ${width} ${height}`,
    class: 'chart-svg',
    role: 'img',
    'aria-label': series.map((s) => s.label).join(', '),
  });

  // Horizontal gridlines with value labels on the right.
  const ticks = [yMax, (yMax + yMin) / 2, yMin];
  for (const tick of ticks) {
    const y = sy(tick);
    root.appendChild(
      svg('line', { x1: MARGIN.left, y1: y, x2: MARGIN.left + plotW, y2: y, class: 'chart-grid' }),
    );
    const label = svg('text', { x: MARGIN.left + plotW + 6, y: y + 3, class: 'chart-tick' });
    label.textContent = options.yFormat(tick);
    root.appendChild(label);
  }

  // X axis labels: start, middle, end.
  for (const fraction of [0, 0.5, 1]) {
    const x = MARGIN.left + fraction * plotW;
    const label = svg('text', {
      x,
      y: height - 6,
      class: 'chart-tick',
      'text-anchor': fraction === 0 ? 'start' : fraction === 1 ? 'end' : 'middle',
    });
    label.textContent = options.xFormat(fraction * xMax);
    root.appendChild(label);
  }

  // Reference lines first so the series draw on top.
  for (const ref of refs) {
    const y = sy(ref.y);
    root.appendChild(
      svg('line', {
        x1: MARGIN.left,
        y1: y,
        x2: MARGIN.left + plotW,
        y2: y,
        class: `chart-ref chart-ref-${ref.kind}`,
      }),
    );
    const label = svg('text', { x: MARGIN.left + 3, y: y - 4, class: 'chart-ref-label' });
    label.textContent = ref.label;
    root.appendChild(label);
  }

  for (const s of series) {
    if (s.points.length < 2) continue;
    const polyline = svg('polyline', {
      class: `chart-line chart-line-${s.id}`,
      points: s.points.map((p) => `${sx(p.x).toFixed(2)},${sy(p.y).toFixed(2)}`).join(' '),
    });
    root.appendChild(polyline);
  }

  const legend = el(
    'div',
    { class: 'chart-legend' },
    ...series.map((s) => legendItem(s.label, `chart-swatch-${s.id}`)),
    ...refs.map((ref) => legendItem(ref.label, `chart-swatch-${ref.kind}`)),
  );

  return el('div', { class: 'chart-wrap' }, root, legend);
}

function legendItem(label: string, swatchClass: string): HTMLElement {
  return el('span', { class: 'chart-legend-item' }, el('span', { class: `chart-swatch ${swatchClass}` }), label);
}

export interface BarItem {
  label: string;
  value: number;
  caption: string;
  kind?: string;
}

/** Horizontal bars for comparing costs; width is relative to the largest. */
export function barChart(items: BarItem[], format: (value: number) => string, title?: string): HTMLElement {
  const max = Math.max(...items.map((item) => Math.abs(item.value)), 0.000001);
  return el(
    'div',
    { class: 'bars' },
    title ? el('div', { class: 'stat-label', text: title }) : null,
    ...items.map((item) => {
      const fill = el('span', { class: `bar-fill ${item.kind ? `bar-fill-${item.kind}` : ''}`.trim() });
      fill.style.width = `${Math.max(1, (Math.abs(item.value) / max) * 100).toFixed(1)}%`;
      return el(
        'div',
        { class: 'bar-row' },
        el('span', { class: 'bar-label', text: item.label }),
        el('span', { class: 'bar-track' }, fill),
        el('span', { class: 'bar-value' }, el('strong', { text: format(item.value) }), el('span', { text: item.caption })),
      );
    }),
  );
}
