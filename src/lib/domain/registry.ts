/**
 * Curated protocol registry.
 *
 * The tier is a *maintainer opinion*, not a fact, and it exists so that the
 * extension can explain itself instead of producing an opaque "safety score".
 * Every entry is PR-editable — that is the whole point of shipping this as OSS.
 *
 *   A = blue chip. Multi-year live contracts, multiple independent audits,
 *       large TVL, no unresolved critical incidents.
 *   B = established but younger/smaller, or carrying a known design tradeoff.
 *   C = new / experimental / thin track record.
 *
 * Unknown protocols are never silently trusted: they score low and are flagged.
 */

import type { AssetClass, Tier } from './types';

export interface ProtocolEntry {
  name: string;
  tier: Tier;
  website?: string;
  /**
   * The protocol's own security / audit page.
   *
   * Pendle's `marketInfo.auditedUrl` is empty for every market we have inspected
   * (~590 across Ethereum and Arbitrum), so the extension cannot rely on Pendle
   * for this. A link here is a *protocol* audit, not an audit of this Pendle
   * market — the UI says so. Only add URLs that have been verified by hand; a
   * wrong link is worse than none.
   */
  auditUrl?: string;
  note?: string;
}

/**
 * The tier meanings, exported so the UI can state *why* a market scored what it
 * did instead of only showing a letter. Kept in sync with the header above by
 * `tests/score.test.ts`.
 */
export const TIER_DOCS: Record<Tier, string> = {
  A: 'Blue chip: multi-year live contracts, multiple independent audits, large TVL, no unresolved critical incidents.',
  B: 'Established but younger or smaller, or carrying a known design tradeoff.',
  C: 'New, experimental, or a thin track record.',
  unknown:
    'Not in the curated registry. Scores the bottom of the protocol factor and is hidden by default — add it by pulling a request against the registry.',
};

export const PROTOCOL_REGISTRY: ProtocolEntry[] = [
  // ---------------------------------------------------------------- Tier A
  { name: 'Aave', tier: 'A', website: 'https://aave.com', auditUrl: 'https://aave.com/security' },
  { name: 'Lido', tier: 'A', website: 'https://lido.fi' },
  { name: 'Ethena', tier: 'A', website: 'https://ethena.fi', note: 'sUSDe / USDe. Funding-rate and custody risk; see risk notes.' },
  { name: 'Sky', tier: 'A', website: 'https://sky.money', note: 'Formerly MakerDAO. USDS / sUSDS.' },
  { name: 'Spark', tier: 'A', website: 'https://spark.fi' },
  { name: 'Morpho', tier: 'A', website: 'https://morpho.org', auditUrl: 'https://docs.morpho.org/get-started/resources/audits/' },
  { name: 'Curve', tier: 'A', website: 'https://curve.fi', auditUrl: 'https://docs.curve.finance/user/security/audits' },
  { name: 'Convex', tier: 'A', website: 'https://convexfinance.com' },
  { name: 'Rocket Pool', tier: 'A', website: 'https://rocketpool.net' },
  { name: 'Lombard', tier: 'A', website: 'https://lombard.finance' },
  { name: 'Coinbase Wrapped', tier: 'A', website: 'https://www.coinbase.com', note: 'cbETH / cbBTC.' },

  // ---------------------------------------------------------------- Tier B
  { name: 'Frax', tier: 'B', website: 'https://frax.finance' },
  { name: 'Ether.fi', tier: 'B', website: 'https://ether.fi' },
  { name: 'Kelp DAO', tier: 'B', website: 'https://kelpdao.xyz' },
  { name: 'Renzo', tier: 'B', website: 'https://renzoprotocol.com' },
  { name: 'EigenLayer', tier: 'B', website: 'https://eigenlayer.xyz' },
  { name: 'Maple', tier: 'B', website: 'https://maple.finance', note: 'Institutional credit. Counterparty risk.' },
  { name: 'Fluid', tier: 'B', website: 'https://fluid.instadapp.io' },
  { name: 'Usual', tier: 'B', website: 'https://usual.money' },
  { name: 'Resolv', tier: 'B', website: 'https://resolv.xyz' },
  { name: 'Swell', tier: 'B', website: 'https://swellnetwork.io' },
  { name: 'Puffer', tier: 'B', website: 'https://puffer.fi' },
  { name: 'Stader', tier: 'B', website: 'https://staderlabs.com' },
  { name: 'Ankr', tier: 'B', website: 'https://ankr.com' },
  { name: 're.xyz', tier: 'B', website: 'https://re.xyz', auditUrl: 'https://docs.re.xyz/transparency-and-data-show-me-the-receipts/audits-attestations-custody-structure', note: 'RWA + delta-neutral basis. Reinsurance sleeve can produce negative yield. Audited by Sherlock, Certora and Hacken; the audits page also documents custody.' },
  { name: 'Level', tier: 'B', website: 'https://level.money' },
  { name: 'Agora', tier: 'B', website: 'https://agora.finance' },

  // ---------------------------------------------------------------- Tier C
  { name: 'Apyx', tier: 'C', website: 'https://apyx.fi', auditUrl: 'https://docs.apyx.fi/resources/audits', note: 'apxUSD / apyUSD — synthetic dollar backed by offchain DAT preferred equity (STRC/SATA), not cash. Below par continuously since June 2026 (low ~$0.75; $0.881 on 1 Aug, −11.9%), and redemption is priced off protocol "redemption value", so $1 is not a floor; minting is permissioned and the apyUSD exit can take up to 20 days. ~92% asset-reserve coverage, only ~16–19% verifiable onchain, cash custodian unnamed. Audited (Zellic, Certora, Quantstamp).' },
  { name: 'InfiniFi', tier: 'C', website: 'https://infinifi.xyz' },
  // ------------------------------------------------------------------- Tier B
  // USD.AI (Permian Labs): synthetic dollar backed by T-Bills, plus yield from
  // GPU-secured AI infrastructure loans. Two recognised tier-1 audits (Cantina
  // May 2025, Quantstamp Feb 2026), institutional backers (Framework, Dragonfly,
  // Coinbase Ventures, DCG). B rather than A because the compute-backed credit
  // sleeve is a genuinely novel collateral type: LlamaRisk declined to onboard
  // USDai/sUSDai to Aave on Arbitrum citing GPU collateral liquidity, peg and
  // legal-design concerns.
  {
    name: 'USD.AI',
    tier: 'B',
    website: 'https://usd.ai',
    note: 'Synthetic dollar + GPU-backed lending. T-Bill reserve, compute-loan yield. LlamaRisk declined Aave onboarding over collateral liquidity and legal design.',
  },
  { name: 'Noon Capital', tier: 'C' },
  { name: 'Axis', tier: 'C' },
  { name: 'Sierra', tier: 'C' },
  { name: 'Elixir', tier: 'C', website: 'https://elixir.xyz' },
  { name: 'Solv', tier: 'C', website: 'https://solv.finance' },
  { name: 'Bedrock', tier: 'C', website: 'https://bedrock.technology' },
  { name: 'PumpBTC', tier: 'C' },
];

const ALIASES: Record<string, string> = {
  'maker': 'Sky',
  'makerdao': 'Sky',
  'skymoney': 'Sky',
  'ethena labs': 'Ethena',
  'rexyz': 're.xyz',
  're': 're.xyz',
  'etherfi': 'Ether.fi',
  'kelp': 'Kelp DAO',
  'rocketpool': 'Rocket Pool',
  'instadapp': 'Fluid',
  'convex finance': 'Convex',
  'usdai': 'USD.AI',
  'usd.ai': 'USD.AI',
  'permian labs': 'USD.AI',
  'permian': 'USD.AI',
};

const normalize = (value: string): string => value.toLowerCase().replace(/[^a-z0-9.]/g, '');

const REGISTRY = new Map<string, ProtocolEntry>();
for (const entry of PROTOCOL_REGISTRY) {
  REGISTRY.set(normalize(entry.name), entry);
}
for (const [alias, canonical] of Object.entries(ALIASES)) {
  const entry = REGISTRY.get(normalize(canonical));
  if (entry) REGISTRY.set(normalize(alias), entry);
}

export function lookupProtocol(protocol: string | null | undefined): ProtocolEntry | null {
  if (!protocol) return null;
  const direct = REGISTRY.get(normalize(protocol));
  if (direct) return direct;
  // Fall back to substring matching so "re.xyz (Re)" or "Ethena Labs" resolve.
  const needle = normalize(protocol);
  for (const [key, entry] of REGISTRY) {
    if (needle.includes(key) || key.includes(needle)) return entry;
  }
  return null;
}

export function protocolTier(protocol: string | null | undefined): Tier {
  return lookupProtocol(protocol)?.tier ?? 'unknown';
}

export interface AuditLink {
  url: string;
  /** `pendle` = published against this market; `registry` = the protocol's own page. */
  source: 'pendle' | 'registry';
}

/**
 * The best audit link we can honestly show: Pendle's, if it ever publishes one
 * (it currently does not, for any market), otherwise the curated per-protocol
 * page. Returns null when we have neither, which is the only case in which the
 * UI is allowed to say we have no link.
 */
export function auditLink(protocol: string | null | undefined, pendleUrl: string | null | undefined): AuditLink | null {
  if (pendleUrl && pendleUrl.trim() !== '') return { url: pendleUrl.trim(), source: 'pendle' };
  const entry = lookupProtocol(protocol);
  return entry?.auditUrl ? { url: entry.auditUrl, source: 'registry' } : null;
}

export const TIER_SCORE: Record<Tier, number> = {
  A: 1,
  B: 0.7,
  C: 0.35,
  unknown: 0.15,
};

export const ASSET_CLASS_SCORE: Record<AssetClass, number> = {
  stable: 1,
  rwa: 0.85,
  'eth-staking': 0.75,
  eth: 0.65,
  btc: 0.6,
  other: 0.4,
  unknown: 0.3,
};

const STABLE_SYMBOL = /(usdc|usdt|^dai$|usds|usde|susde|sfrxusd|frax|crvusd|gho|pyusd|usdd|usd0|susd|deusd|usdx|reusd|siusd|susn|^usr$|usdf|rusd|rlusd|usdtb|susds|usdn|iusd)/i;
const ETH_SYMBOL = /(w?eth|steth|reth|ezeth|weeth|ethx|sfrxeth|cbeth|oseth|sweth)/i;
const BTC_SYMBOL = /(btc)/i;

/**
 * Classify the market's underlying exposure.
 *
 * Pendle's own `categoryIds` are the primary signal; symbols are a fallback
 * so that newly listed markets are not left unclassified.
 */
export function classifyAsset(categoryIds: string[], symbols: string[]): AssetClass {
  const cats = new Set(categoryIds.map((c) => c.toLowerCase()));
  if (cats.has('stables')) return 'stable';
  if (cats.has('rwa')) return 'rwa';
  if (cats.has('btc')) return 'btc';
  if (cats.has('lst') || cats.has('lrt')) return 'eth-staking';
  if (cats.has('eth')) return 'eth';

  const joined = symbols.join(' ');
  if (STABLE_SYMBOL.test(joined)) return 'stable';
  if (ETH_SYMBOL.test(joined)) return 'eth-staking';
  if (BTC_SYMBOL.test(joined)) return 'btc';
  return symbols.some((s) => s.length > 0) ? 'other' : 'unknown';
}
