import { describe, expect, it } from 'vitest';
import { leveragedApy, netApyAtMaxLeverage, readLooping } from '../src/lib/domain/looping';
import type { LoopOption } from '../src/lib/domain/types';

const option = (over: Partial<LoopOption> = {}): LoopOption => ({
  chainId: 1,
  protocol: 'Morpho',
  moneyMarketName: 'Morpho',
  moneyMarketAddress: '0xmm',
  url: null,
  marketUrl: null,
  debtSymbol: 'USDC',
  debtDecimals: 6,
  lltv: 0.915,
  borrowApy: 0.047,
  borrowApy7dAvg: 0.0486,
  maxLeverage: 8.89,
  liquidityUsd: 98_874,
  totalSupplyUsd: 1_280_572,
  supplyCapUsd: null,
  maxApy: 0.0867,
  reference: { positionUsd: 50_000, leverage: 8.89, fixedApy: 0.084, borrowApy: 0.0837 },
  utilization: 0.913,
  risks: null,
  ...over,
});

describe('leveragedApy', () => {
  it('matches the identity Pendle documents', () => {
    expect(leveragedApy(0.084, 0.0837, 8.89)).toBeCloseTo(0.084 * 8.89 - 0.0837 * 7.89, 10);
  });

  it('returns the fixed rate at 1x', () => {
    expect(leveragedApy(0.084, 0.05, 1)).toBeCloseTo(0.084, 10);
  });
});

describe('readLooping', () => {
  it('picks the venue with the highest modelled APY', () => {
    const read = readLooping([option({ maxApy: 0.05 }), option({ moneyMarketName: 'Euler', maxApy: 0.37 })]);
    expect(read.loopable).toBe(true);
    expect(read.venues).toBe(2);
    expect(read.best!.moneyMarketName).toBe('Euler');
  });

  it('is not loopable with no venues', () => {
    expect(readLooping([])).toEqual({ loopable: false, venues: 0, best: null });
    expect(readLooping(null).loopable).toBe(false);
  });
});

describe('netApyAtMaxLeverage', () => {
  it('uses the 7-day average borrow rate', () => {
    expect(netApyAtMaxLeverage(option(), 0.115)).toBeCloseTo(leveragedApy(0.115, 0.0486, 8.89), 10);
  });

  it('is null without leverage or a borrow rate', () => {
    expect(netApyAtMaxLeverage(option({ maxLeverage: null }), 0.115)).toBeNull();
    expect(netApyAtMaxLeverage(option({ borrowApy: null, borrowApy7dAvg: null }), 0.115)).toBeNull();
    expect(netApyAtMaxLeverage(option({ maxLeverage: 1 }), 0.115)).toBeNull();
  });
});
