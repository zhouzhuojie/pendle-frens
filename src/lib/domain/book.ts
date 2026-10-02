/**
 * A rate-only read of the combined limit-order book.
 *
 * Deliberately narrow. The provider's book mixes limit-order and AMM sizes on
 * scales it does not document, and its own docs describe fields the live API no
 * longer returns, so this module compares **rates** and never turns a size into
 * dollars. The user question it answers is "could resting orders give me a
 * better fixed rate than the AMM, and is posting one worth it?".
 */

import type { BookLevel, LimitOrderBook } from './types';

export interface BookRead {
  /** Levels the provider returned, both sides combined. */
  levels: number;
  /** Levels that carry a resting (non-zero) limit order. */
  restingOrders: number;
  /** Highest implied APY among resting orders, either side. */
  bestLimitApy: number | null;
  /** Lowest implied APY among resting orders, either side. */
  worstLimitApy: number | null;
  /** Tightest AMM rate the book shows, either side. */
  bestAmmApy: number | null;
  hasLimitOrders: boolean;
}

const hasRestingOrder = (level: BookLevel): boolean => Number(level.limitOrderSize) > 0;

export function readBook(book: LimitOrderBook | null | undefined): BookRead | null {
  if (!book) return null;
  const all = [...book.long, ...book.short];
  if (all.length === 0) return null;

  const resting = all.filter(hasRestingOrder);
  const rates = resting.map((level) => level.impliedApy).filter((rate) => Number.isFinite(rate));
  const ammRates = all
    .filter((level) => Number(level.ammSize) > 0)
    .map((level) => level.impliedApy)
    .filter((rate) => Number.isFinite(rate));

  return {
    levels: all.length,
    restingOrders: resting.length,
    bestLimitApy: rates.length > 0 ? Math.max(...rates) : null,
    worstLimitApy: rates.length > 0 ? Math.min(...rates) : null,
    bestAmmApy: ammRates.length > 0 ? Math.max(...ammRates) : null,
    hasLimitOrders: resting.length > 0,
  };
}
