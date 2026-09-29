/**
 * Exact decimal <-> base-unit conversions using BigInt string math.
 *
 * API amounts are integer strings in token base units. Token decimals vary
 * wildly (USDC = 6, PT-reUSD = 6, WETH = 18), and 18-decimal amounts exceed
 * Number.MAX_SAFE_INTEGER, so we never round-trip large values through Number.
 */

/** Parse a human decimal string ("1.23") into base units ("1230000"). */
export function toUnits(value: string, decimals: number): string {
  const trimmed = value.trim();
  if (!/^-?\d*(\.\d*)?$/.test(trimmed) || trimmed === '' || trimmed === '.' || trimmed === '-.') {
    throw new Error(`Invalid decimal value: "${value}"`);
  }
  const negative = trimmed.startsWith('-');
  const body = negative ? trimmed.slice(1) : trimmed;
  const [wholeRaw = '', fracRaw = ''] = body.split('.');
  const whole = wholeRaw === '' ? '0' : wholeRaw;
  const frac = fracRaw.padEnd(decimals, '0').slice(0, decimals);
  const units = `${whole}${frac}`.replace(/^0+(?=\d)/, '');
  return negative && units !== '0' ? `-${units}` : units;
}

/** Render base units ("1230000", 6) back to a plain decimal string ("1.23"). */
export function fromUnits(units: string, decimals: number): string {
  const negative = units.startsWith('-');
  const digits = (negative ? units.slice(1) : units).replace(/^0+(?=\d)/, '') || '0';
  if (decimals === 0) return negative ? `-${digits}` : digits;
  const padded = digits.padStart(decimals + 1, '0');
  const whole = padded.slice(0, padded.length - decimals);
  const frac = padded.slice(padded.length - decimals).replace(/0+$/, '');
  const out = frac.length > 0 ? `${whole}.${frac}` : whole;
  return negative && out !== '0' ? `-${out}` : out;
}

/** Lossy but convenient conversion for display and ratio math. */
export function unitsToNumber(units: string, decimals: number): number {
  return Number(fromUnits(units, decimals));
}

/** Exact multiply of a base-unit amount by a decimal ratio (e.g. for sizing). */
export function multiplyUnits(units: string, ratio: number, precision = 1e6): string {
  const scaled = BigInt(Math.round(ratio * precision));
  return ((BigInt(units) * scaled) / BigInt(precision)).toString();
}

export function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** Linear interpolation of a value in [inMin,inMax] -> [0,1], clamped. */
export function normalize(value: number, inMin: number, inMax: number): number {
  if (inMax === inMin) return value >= inMax ? 1 : 0;
  return clamp01((value - inMin) / (inMax - inMin));
}
