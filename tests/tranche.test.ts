import { describe, expect, it } from 'vitest';
import { nameVariantHint, trancheHint } from '../src/lib/domain/tranche';

describe('trancheHint', () => {
  it('reads the sr/jr convention, with the opposite leg as the counterpart', () => {
    expect(trancheHint('srUSDe', ['jrUSDe'])).toEqual({ position: 'senior', marker: 'sr', counterpart: 'jrUSDe' });
    expect(trancheHint('jrUSDe', ['srUSDe'])).toEqual({ position: 'junior', marker: 'jr', counterpart: 'srUSDe' });
  });

  it('confirms a pair whose remainder starts lowercase (Strata mHYPER)', () => {
    expect(trancheHint('srmHYPER', ['jrmHYPER'])).toEqual({ position: 'senior', marker: 'sr', counterpart: 'jrmHYPER' });
    expect(trancheHint('jrmHYPER', ['srmHYPER'])).toEqual({ position: 'junior', marker: 'jr', counterpart: 'srmHYPER' });
  });

  it('accepts a lone sr/jr when it clearly starts a symbol', () => {
    expect(trancheHint('srNUSD', [])?.position).toBe('senior');
    expect(trancheHint('jrNUSD', [])?.position).toBe('junior');
  });

  it('does not mistake Resupply sreUSD for a senior tranche', () => {
    expect(trancheHint('sreUSD', [])).toBeNull();
    expect(trancheHint('sreUSD', ['sreUSD'])).toBeNull();
  });

  it('reads the words', () => {
    expect(trancheHint('Senior USDe')?.position).toBe('senior');
    expect(trancheHint('Junior USDe')?.position).toBe('junior');
    expect(trancheHint('Mezzanine USDe')?.position).toBe('junior');
  });

  it('reports the marker as the ticker spells it, so the UI can quote it verbatim', () => {
    expect(trancheHint('Senior USDe')?.marker).toBe('Senior');
    expect(trancheHint('SRUSDE')?.marker).toBe('SR');
    expect(trancheHint('srUSDe')?.marker).toBe('sr');
  });

  it('reads the bond-style ++ suffix', () => {
    expect(trancheHint('USD0++', ['USD0'])).toEqual({ position: 'junior', marker: '++', counterpart: 'USD0' });
    expect(trancheHint('USD0++', [])?.position).toBe('junior');
  });

  it('stays silent when the ticker does not encode a position', () => {
    expect(trancheHint('reUSD', ['reUSDe'])).toBeNull();
    expect(trancheHint('reUSDe', ['reUSD'])).toBeNull();
    expect(trancheHint('sUSDe', ['USDe'])).toBeNull();
  });
});

describe('nameVariantHint', () => {
  it('links an affixed wrapper to its base, in both directions', () => {
    expect(nameVariantHint('reUSDe', ['reUSD'])).toEqual({ peer: 'reUSD', relation: 'extends' });
    expect(nameVariantHint('reUSD', ['reUSDe'])).toEqual({ peer: 'reUSDe', relation: 'extended-by' });
    expect(nameVariantHint('sUSD3', ['USD3'])).toEqual({ peer: 'USD3', relation: 'extends' });
    expect(nameVariantHint('USD0', ['USD0++'])).toEqual({ peer: 'USD0++', relation: 'extended-by' });
  });

  it('does not link two distinct tranches that merely share a suffix', () => {
    expect(nameVariantHint('srUSDe', ['jrUSDe'])).toBeNull();
  });

  it('ignores identical names and too-long affixes', () => {
    expect(nameVariantHint('reUSD', ['reUSD'])).toBeNull();
    expect(nameVariantHint('tokenAExtended', ['tokenA'])).toBeNull();
    expect(nameVariantHint('ab', ['abc'])).toBeNull();
  });
});
