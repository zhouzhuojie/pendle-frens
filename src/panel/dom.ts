/** Tiny typed DOM helpers. No framework, no innerHTML for dynamic data. */

export type Child = Node | string | number | null | undefined | false;

export interface ElProps {
  class?: string;
  text?: string | number;
  title?: string;
  value?: string | number;
  checked?: boolean;
  disabled?: boolean;
  dataset?: Record<string, string>;
  attrs?: Record<string, string | number | boolean | null | undefined>;
  on?: Record<string, EventListener>;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElProps = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  applyProps(node, props);
  append(node, ...children);
  return node;
}

function applyProps(node: HTMLElement, props: ElProps): void {
  if (props.class) node.className = props.class;
  if (props.text !== undefined) node.textContent = String(props.text);
  if (props.title) node.title = props.title;
  for (const [key, value] of Object.entries(props.attrs ?? {})) {
    if (value !== null && value !== undefined && value !== false) node.setAttribute(key, String(value));
  }
  for (const [key, value] of Object.entries(props.dataset ?? {})) node.dataset[key] = value;
  if (props.value !== undefined) (node as unknown as { value: string }).value = String(props.value);
  if (props.checked !== undefined) {
    // <option> uses `selected`, everything else uses `checked`.
    if (node.tagName === 'OPTION') (node as unknown as { selected: boolean }).selected = props.checked;
    else (node as unknown as { checked: boolean }).checked = props.checked;
  }
  if (props.disabled !== undefined) (node as unknown as { disabled: boolean }).disabled = props.disabled;
  for (const [event, handler] of Object.entries(props.on ?? {})) node.addEventListener(event, handler);
}

export function append(parent: Node, ...children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(typeof child === 'object' ? child : document.createTextNode(String(child)));
  }
}

export function frag(...children: Child[]): DocumentFragment {
  const f = document.createDocumentFragment();
  append(f, ...children);
  return f;
}

export function clear(node: Node): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function mount(node: Node, ...children: Child[]): void {
  clear(node);
  append(node, ...children);
}

export function qs<T extends HTMLElement = HTMLElement>(root: ParentNode, selector: string): T {
  const found = root.querySelector<T>(selector);
  if (!found) throw new Error(`Element not found: ${selector}`);
  return found;
}

/** Minimal SVG polyline sparkline; returns null when there is not enough data. */
export function sparkline(values: number[], width = 300, height = 48): SVGSVGElement | null {
  const clean = values.filter((v) => Number.isFinite(v));
  if (clean.length < 2) return null;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('class', 'sparkline');
  svg.setAttribute('preserveAspectRatio', 'none');

  const min = Math.min(...clean);
  const max = Math.max(...clean);
  const span = max - min || 1;
  const step = width / (clean.length - 1);
  const points = clean
    .map((v, i) => `${(i * step).toFixed(2)},${(height - ((v - min) / span) * (height - 6) - 3).toFixed(2)}`)
    .join(' ');

  const line = document.createElementNS(ns, 'polyline');
  line.setAttribute('points', points);
  line.setAttribute('fill', 'none');
  line.setAttribute('stroke', 'currentColor');
  line.setAttribute('stroke-width', '1.5');
  line.setAttribute('vector-effect', 'non-scaling-stroke');
  svg.appendChild(line);
  return svg;
}

export function openExternal(url: string): void {
  void chrome.tabs.create({ url });
}
