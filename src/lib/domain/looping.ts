/**
 * PT looping (leveraged fixed yield).
 *
 * Pendle returns, per money market, a maximum leverage, a borrow rate, and its
 * own modelled maximum APY at a stated reference position. That modelled figure
 * is an estimate, not a quote, so this module does two things and nothing else:
 * picks the venue Pendle rates highest, and re-states Pendle's own leverage
 * identity at the venue's maximum so a reader can see where the number comes
 * from. Every surface that shows it must show the liquidation risk beside it.
 */

import type { LoopOption } from './types';

export interface LoopRead {
  loopable: boolean;
  /** Venues Pendle lists for this PT. */
  venues: number;
  /** The venue with the highest modelled APY (or the first, if none is rated). */
  best: LoopOption | null;
}

export function readLooping(options: LoopOption[] | null | undefined): LoopRead {
  const list = options ?? [];
  const rated = list.filter((option) => option.maxApy !== null);
  const best = [...rated].sort((a, b) => (b.maxApy ?? 0) - (a.maxApy ?? 0))[0] ?? list[0] ?? null;
  return { loopable: list.length > 0, venues: list.length, best };
}

/**
 * Net APY of a leveraged PT position:
 *
 *     netApy = fixedApy × leverage − borrowApy × (leverage − 1)
 *
 * This is the identity Pendle documents. It ignores fees, price impact and the
 * fact that the borrow rate floats — so it is a check on the headline, not a
 * forecast.
 */
export function leveragedApy(fixedApy: number, borrowApy: number, leverage: number): number {
  return fixedApy * leverage - borrowApy * (leverage - 1);
}

/**
 * The same identity run at the venue's maximum leverage, using the 7-day
 * average borrow rate when one is available (a spot borrow rate at max
 * leverage is the most misleading number in this whole panel).
 */
export function netApyAtMaxLeverage(option: LoopOption, fixedApy: number): number | null {
  const leverage = option.maxLeverage;
  const borrowApy = option.borrowApy7dAvg ?? option.borrowApy;
  if (leverage === null || borrowApy === null || leverage <= 1) return null;
  return leveragedApy(fixedApy, borrowApy, leverage);
}
