import { describe, expect, it } from 'vitest';
import { rangePosition, rewardBadges, rewardBullets, tagLabel, yieldProvenance } from '../src/lib/domain/rewards';
import type { ApyBreakdown } from '../src/lib/domain/types';
import { makeMarket } from './fixtures';

const breakdown = (label: string, apy: number, tags: string[], id = 'x'): ApyBreakdown => ({
  categories: [{ label, apy, items: [{ id, apy, tags, source: null }] }],
});

describe('yieldProvenance', () => {
  it('labels each group by the side it applies to', () => {
    const market = makeMarket({
      ytBreakdown: breakdown('Protocol Yield', 0.117, ['INTEREST', 'AUTO']),
      lpBreakdown: breakdown('LP Rewards', 0.21, ['INCENTIVE', 'BOOSTABLE'], 'PENDLE'),
    });
    const rows = yieldProvenance(market);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.appliesTo).toContain('YT');
    expect(rows[0]!.sources).toEqual(['interest']);
    expect(rows[1]!.sources).toEqual(['PENDLE incentives']);
  });

  it('is empty when the provider published nothing', () => {
    expect(yieldProvenance(makeMarket())).toEqual([]);
  });
});

describe('rewardBadges', () => {
  it('names points and emissions with who receives them', () => {
    const market = makeMarket({
      points: [{ key: 'Asseto', type: 'multiplier', pendleAsset: 'basic', value: 40, perDollarLp: null }],
      emissions: { totalIncentive: 405.6, tvlIncentive: 0, feeIncentive: 0, discretionaryIncentive: 0, limitOrderIncentive: 0 },
    });
    const badges = rewardBadges(market);
    expect(badges[0]!.label).toContain('Asseto');
    expect(badges[0]!.label).toContain('40×');
    expect(badges[1]!.title).toContain('not to PT holders');
  });

  it('is empty with no rewards', () => {
    expect(rewardBadges(makeMarket())).toEqual([]);
  });
});

describe('rewardBullets', () => {
  it('says emissions go to LPs, not PT', () => {
    const market = makeMarket({
      emissions: { totalIncentive: 100, tvlIncentive: 0, feeIncentive: 0, discretionaryIncentive: 0, limitOrderIncentive: 0 },
    });
    expect(rewardBullets(market)[0]).toContain('goes to LPs, not to PT holders');
  });
});

describe('rangePosition', () => {
  it('places the current rate inside the historical range', () => {
    const market = makeMarket({ impliedApy: 0.115, yieldRange: { min: 0.09, max: 0.28 } });
    expect(rangePosition(market)).toBeCloseTo((0.115 - 0.09) / (0.28 - 0.09), 6);
  });

  it('is null without a usable range', () => {
    expect(rangePosition(makeMarket())).toBeNull();
    expect(rangePosition(makeMarket({ yieldRange: { min: 0.1, max: 0.1 } }))).toBeNull();
  });
});

describe('tagLabel', () => {
  it('humanises provider tags and passes through unknown ones', () => {
    expect(tagLabel('FIXED_YIELD')).toBe('PT convergence');
    expect(tagLabel('SOMETHING_NEW')).toBe('something new');
  });
});
