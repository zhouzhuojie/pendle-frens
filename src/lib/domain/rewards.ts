/**
 * Yield provenance and rewards, read from the provider's own decomposition.
 *
 * The honesty rule here is the whole point: Pendle's APY breakdowns are per
 * *asset*, and the LP and YT groups contain rewards a PT holder never receives.
 * Every row therefore states what it applies to, and nothing in this module is
 * allowed to call a sum "your yield".
 */

import type { ApyBreakdown, ApyCategory, Market } from './types';
import { formatAmount } from './format';

export interface ProvenanceRow {
  label: string;
  apy: number;
  /** What the row applies to, in plain words. */
  appliesTo: string;
  /** Human names of the underlying sources, e.g. ["interest", "PENDLE incentives"]. */
  sources: string[];
}

const TAG_LABELS: Record<string, string> = {
  INTEREST: 'interest',
  REWARD: 'rewards',
  FIXED_YIELD: 'PT convergence',
  SWAP_FEE: 'swap fees',
  INCENTIVE: 'PENDLE incentives',
  'CO-INCENTIVE': 'co-incentives',
  BOOSTABLE: 'boostable',
  AUTO: 'auto',
};

export function tagLabel(tag: string): string {
  return TAG_LABELS[tag] ?? tag.toLowerCase().replace(/_/g, ' ');
}

/** The first meaningful tag on an item, ignoring Pendle's `AUTO` marker. */
function itemSource(item: ApyCategory['items'][number]): string {
  const tag = item.tags.find((t) => t !== 'AUTO');
  if (tag) return tagLabel(tag);
  if (item.id === 'PENDLE') return 'PENDLE incentives';
  return item.source ? item.source.toLowerCase().replace(/_/g, ' ') : 'other';
}

function rowsFor(breakdown: ApyBreakdown | null, appliesTo: string): ProvenanceRow[] {
  if (!breakdown) return [];
  return breakdown.categories.map((category) => ({
    label: category.label,
    apy: category.apy,
    appliesTo,
    sources: [...new Set(category.items.map(itemSource))],
  }));
}

/**
 * Where the yield on this market comes from. The PT's own return is the fixed
 * rate, which is not in here; this explains the *other* side and the incentives.
 */
export function yieldProvenance(market: Market): ProvenanceRow[] {
  return [
    ...rowsFor(market.ytBreakdown, 'the floating (YT) side'),
    ...rowsFor(market.underlyingRewardBreakdown, 'the underlying'),
    ...rowsFor(market.lpBreakdown, 'LP positions'),
  ];
}

export interface RewardBadge {
  kind: 'points' | 'emission';
  label: string;
  /** What it is and who receives it — shown as the chip title. */
  title: string;
}

/** Points and emissions, labelled with who actually earns them. */
export function rewardBadges(market: Market): RewardBadge[] {
  const badges: RewardBadge[] = [];
  for (const point of market.points) {
    const applies = point.pendleAsset === 'lp' ? 'LP positions' : 'the market';
    const value = point.type === 'multiplier' ? `${point.value}×` : `${formatAmount(point.value)}/unit`;
    badges.push({ kind: 'points', label: `${point.key} ${value}`, title: `Points multiplier on ${applies}` });
  }
  if (market.emissions && market.emissions.totalIncentive > 0) {
    badges.push({
      kind: 'emission',
      label: `${formatAmount(market.emissions.totalIncentive)} PENDLE/wk`,
      title: 'Weekly PENDLE emissions to the pool — these go to LPs, not to PT holders',
    });
  }
  return badges;
}

/** Reward facts, written for the decision list. */
export function rewardBullets(market: Market): string[] {
  const out: string[] = [];
  for (const point of market.points) {
    const applies = point.pendleAsset === 'lp' ? 'LP positions' : 'the market’s assets';
    const value = point.type === 'multiplier' ? `${point.value}× points multiplier` : `${formatAmount(point.value)} points per unit`;
    out.push(`Attracts ${point.key} rewards (${value}) on ${applies}.`);
  }
  if (market.emissions && market.emissions.totalIncentive > 0) {
    out.push(
      `The pool receives ${formatAmount(market.emissions.totalIncentive)} PENDLE a week in emissions — that goes to LPs, not to PT holders.`,
    );
  }
  return out;
}

/**
 * Where the current fixed rate sits in the range Pendle has seen, 0..1.
 * Null when there is no range or the range is degenerate.
 */
export function rangePosition(market: Market): number | null {
  const range = market.yieldRange;
  if (!range || range.max <= range.min) return null;
  const position = (market.impliedApy - range.min) / (range.max - range.min);
  return Math.max(0, Math.min(1, position));
}
