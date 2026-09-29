import { describe, expect, it } from 'vitest';
import { clamp, clamp01, fromUnits, multiplyUnits, normalize, toUnits, unitsToNumber } from '../src/lib/util/decimal';

describe('toUnits', () => {
  it('converts whole dollars to 6-decimal units', () => {
    expect(toUnits('50000', 6)).toBe('50000000000');
    expect(toUnits('50000.00', 6)).toBe('50000000000');
    expect(toUnits('1', 6)).toBe('1000000');
  });

  it('handles 18-decimal precision without floating point loss', () => {
    expect(toUnits('1', 18)).toBe('1000000000000000000');
    expect(toUnits('51057.857123456789012345', 18)).toBe('51057857123456789012345');
  });

  it('pads and truncates fractional digits', () => {
    expect(toUnits('0.000001', 6)).toBe('1');
    expect(toUnits('0.0000001', 6)).toBe('0');
    expect(toUnits('1.5', 0)).toBe('1');
    expect(toUnits('.5', 2)).toBe('50');
  });

  it('keeps negatives', () => {
    expect(toUnits('-1.25', 2)).toBe('-125');
    expect(toUnits('-0', 2)).toBe('0');
  });

  it('rejects garbage', () => {
    expect(() => toUnits('abc', 6)).toThrow();
    expect(() => toUnits('', 6)).toThrow();
  });
});

describe('fromUnits', () => {
  it('renders base units back to decimals', () => {
    expect(fromUnits('50000000000', 6)).toBe('50000');
    expect(fromUnits('1230000', 6)).toBe('1.23');
    expect(fromUnits('1', 6)).toBe('0.000001');
    expect(fromUnits('0', 6)).toBe('0');
  });

  it('round-trips 18-decimal values exactly', () => {
    const raw = '51057.857123456789012345';
    expect(fromUnits(toUnits(raw, 18), 18)).toBe(raw);
  });

  it('trims trailing zeros but keeps significant digits', () => {
    expect(fromUnits('1500000', 6)).toBe('1.5');
  });
});

describe('unitsToNumber / multiplyUnits', () => {
  it('converts for display', () => {
    expect(unitsToNumber('50000000000', 6)).toBe(50000);
  });

  it('scales base units by a ratio', () => {
    // 50000 USDC * 2 = 100000 USDC
    expect(multiplyUnits('50000000000', 2)).toBe('100000000000');
    // 25% of 50000 USDC
    expect(multiplyUnits('50000000000', 0.25)).toBe('12500000000');
  });
});

describe('numeric helpers', () => {
  it('clamps', () => {
    expect(clamp(-1, 0, 1)).toBe(0);
    expect(clamp(0.5, 0, 1)).toBe(0.5);
    expect(clamp(2, 0, 1)).toBe(1);
    expect(clamp01(Number.NaN)).toBe(0);
  });

  it('normalizes linearly', () => {
    expect(normalize(0.04, 0, 0.08)).toBeCloseTo(0.5);
    expect(normalize(-1, 0, 0.08)).toBe(0);
    expect(normalize(1, 0, 0.08)).toBe(1);
    expect(normalize(5, 3, 3)).toBe(1);
  });
});
