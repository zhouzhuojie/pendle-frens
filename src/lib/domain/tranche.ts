/**
 * Tranche hints, derived only from token names.
 *
 * The app keeps no tranche registry and no curated token list: every label here
 * is a pure function of a symbol plus, for the neutral fallback, the sibling
 * symbols a snapshot already contains. That buys objectivity at the cost of
 * coverage — a protocol can tranche its assets without saying so in the ticker
 * (`reUSD` / `reUSDe`), and then the honest output is "these two names are
 * related", never a guessed seniority.
 *
 * Two hints are produced:
 *
 *   - `trancheHint` asserts a position only when the name literally encodes it:
 *     the `sr*` / `jr*` convention (Strata, Royco), the words
 *     senior/junior/mezzanine, or the bond-style `++` suffix. These are
 *     conventions, not laws, so a missing hint means "not detected", not "no
 *     tranche".
 *   - `nameVariantHint` is the fallback for unmarked pairs such as
 *     reUSD/reUSDe and USD3/sUSD3: it reports that this symbol is a name
 *     variant of a sibling in the same protocol and deliberately does **not**
 *     say which leg is senior.
 *
 * Both take plain strings, so they run under Node with no network and no
 * permission, like the rest of `domain/`.
 */

export type TranchePosition = 'senior' | 'junior';

export interface TrancheHint {
  position: TranchePosition;
  /** The literal marker found in the symbol, as the ticker spells it, e.g. 'sr', 'jr', 'Senior', '++'. */
  marker: string;
  /** The sibling symbol naming the opposite leg, when the snapshot contains it. */
  counterpart: string | null;
}

export type NameVariantRelation = 'extends' | 'extended-by';

export interface NameVariantHint {
  /** The sibling symbol this one shares a base with. */
  peer: string;
  /** `extends` when this symbol is the longer name, `extended-by` when shorter. */
  relation: NameVariantRelation;
}

/** Words that spell the position out. Substring matching keeps camelCase working. */
const WORD_MARKERS: readonly { keyword: string; position: TranchePosition }[] = [
  { keyword: 'senior', position: 'senior' },
  { keyword: 'junior', position: 'junior' },
  { keyword: 'mezzanine', position: 'junior' },
  { keyword: 'subordinated', position: 'junior' },
];

/** `sr*` / `jr*` prefixes, paired with the opposite leg. */
const PREFIX_MARKERS: readonly { marker: string; opposite: string; position: TranchePosition }[] = [
  { marker: 'sr', opposite: 'jr', position: 'senior' },
  { marker: 'jr', opposite: 'sr', position: 'junior' },
];

/** Longest shared prefix length. */
function commonPrefix(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a[i] === b[i]) i += 1;
  return i;
}

/** Longest shared suffix length. */
function commonSuffix(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a[a.length - 1 - i] === b[b.length - 1 - i]) i += 1;
  return i;
}

/**
 * A lone `sr`/`jr` is accepted only when it clearly starts a token symbol
 * (`srUSDe`), never when the next character is lowercase — `sreUSD`,
 * Resupply's staked reUSD, is not a senior tranche. A pair (`srmHYPER` /
 * `jrmHYPER`) is accepted regardless of case because the opposite leg confirms
 * the convention.
 */
function prefixHint(symbol: string, siblings: readonly string[]): TrancheHint | null {
  const lower = symbol.toLowerCase();
  for (const marker of PREFIX_MARKERS) {
    if (!lower.startsWith(marker.marker)) continue;
    const rest = symbol.slice(marker.marker.length);
    if (rest.length < 2) continue;
    const counterpart =
      siblings.find((sibling) => {
        const lowerSibling = sibling.toLowerCase();
        return lowerSibling.startsWith(marker.opposite) && sibling.slice(marker.opposite.length) === rest;
      }) ?? null;
    const standalone = /^[A-Z0-9]/.test(rest);
    if (!counterpart && !standalone) continue;
    // The ticker's own casing, so the UI can quote the marker verbatim.
    return { position: marker.position, marker: symbol.slice(0, marker.marker.length), counterpart };
  }
  return null;
}

/** `USD0++`-style bond suffix. The `+`s are the marker; the base is what is left. */
function plusHint(symbol: string, siblings: readonly string[]): TrancheHint | null {
  const match = /(\+{1,3})$/.exec(symbol);
  const plus = match?.[1];
  if (!plus) return null;
  const base = symbol.slice(0, -plus.length);
  if (base.length < 2) return null;
  const counterpart = siblings.find((sibling) => sibling.toLowerCase() === base.toLowerCase()) ?? null;
  return { position: 'junior', marker: plus, counterpart };
}

/**
 * The position a ticker spells out, or null. `siblings` are the other underlying
 * symbols in the same protocol; they are used only to confirm a pair, never to
 * invent one.
 */
export function trancheHint(symbol: string, siblings: readonly string[] = []): TrancheHint | null {
  const trimmed = symbol.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  for (const word of WORD_MARKERS) {
    const at = lower.indexOf(word.keyword);
    if (at !== -1) return { position: word.position, marker: trimmed.slice(at, at + word.keyword.length), counterpart: null };
  }
  return prefixHint(trimmed, siblings) ?? plusHint(trimmed, siblings);
}

/**
 * A neutral fallback for pairs whose names do not encode seniority. It only
 * reports that two symbols under one protocol share a base and differ by a
 * short affix — enough to point the reader at the sibling, not enough to call a
 * tranche.
 */
export function nameVariantHint(symbol: string, siblings: readonly string[] = []): NameVariantHint | null {
  const trimmed = symbol.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  let best: { peer: string; relation: NameVariantRelation; shared: number } | null = null;

  for (const raw of siblings) {
    const peer = raw.trim();
    if (!peer) continue;
    const lowerPeer = peer.toLowerCase();
    if (lowerPeer === lower) continue;

    const shared = Math.max(commonPrefix(lower, lowerPeer), commonSuffix(lower, lowerPeer));
    const minLength = Math.min(lower.length, lowerPeer.length);
    // The shorter name must be a proper base of the longer one, and the extra
    // affix must be short enough to be a wrapper rather than a different asset.
    if (shared !== minLength || shared < 3) continue;
    const extra = Math.abs(lower.length - lowerPeer.length);
    if (extra < 1 || extra > 3) continue;

    const relation: NameVariantRelation = lower.length > lowerPeer.length ? 'extends' : 'extended-by';
    if (!best || shared > best.shared) best = { peer, relation, shared };
  }

  return best ? { peer: best.peer, relation: best.relation } : null;
}
