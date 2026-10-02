import { describe, expect, it } from 'vitest';
import { readBook } from '../src/lib/domain/book';

describe('readBook', () => {
  it('finds resting orders and the AMM rate without touching sizes', () => {
    const read = readBook({
      long: [
        { impliedApy: 0.091, limitOrderSize: '91779259', ammSize: '0' },
        { impliedApy: 0.09, limitOrderSize: '0', ammSize: '1000' },
      ],
      short: [{ impliedApy: 0.092, limitOrderSize: '0', ammSize: '900' }],
    });
    expect(read!.hasLimitOrders).toBe(true);
    expect(read!.restingOrders).toBe(1);
    expect(read!.bestLimitApy).toBeCloseTo(0.091, 6);
    // The AMM rate is the highest rate on either side's AMM levels.
    expect(read!.bestAmmApy).toBeCloseTo(0.092, 6);
  });

  it('reports an AMM-only book', () => {
    const read = readBook({ long: [{ impliedApy: 0.09, limitOrderSize: '0', ammSize: '10' }], short: [] });
    expect(read!.hasLimitOrders).toBe(false);
    expect(read!.restingOrders).toBe(0);
    expect(read!.bestLimitApy).toBeNull();
  });

  it('is null when there is no book at all', () => {
    expect(readBook(null)).toBeNull();
    expect(readBook({ long: [], short: [] })).toBeNull();
  });
});
