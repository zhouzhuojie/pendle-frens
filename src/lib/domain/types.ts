/**
 * Shared domain types.
 *
 * These types describe the *normalized* shape we use inside the extension.
 * Provider payloads (Pendle API) are mapped into these in `api/normalize.ts`
 * so that the rest of the codebase never depends on raw API field names.
 */

export interface AssetRef {
  /** `${chainId}-${address}` */
  id: string;
  chainId: number;
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  /** USD price if the provider knows it, otherwise null. */
  priceUsd: number | null;
  tags: string[];
  expiry: string | null;
}

export interface ProtocolRef {
  id: string;
  name: string;
  url: string;
}

/** Human-written risk notes curated by Pendle for each market. */
export interface MarketInfo {
  assetDescription: string | null;
  riskInvolved: string | null;
  importantQuirks: string | null;
  auditedUrl: string | null;
  initiatedBy: string | null;
  conversionRate: string | null;
  utilizedProtocols: ProtocolRef[];
  withdrawalNote: string | null;
}

export interface Market {
  id: string;
  chainId: number;
  address: string;
  name: string;
  protocol: string;
  expiry: string;
  pt: AssetRef;
  yt: AssetRef;
  sy: AssetRef;
  accountingAsset: AssetRef;
  underlyingAsset: AssetRef;
  basePricingAsset: AssetRef | null;
  categoryIds: string[];
  isPrime: boolean;
  /** Pool liquidity (what you can exit against), USD. */
  liquidityUsd: number;
  /** Total value locked including floating PT, USD. */
  tvlUsd: number;
  tradingVolumeUsd: number;
  /** Fixed yield you lock in, decimal (0.115 = 11.5%). */
  impliedApy: number;
  underlyingApy: number;
  /** 1 - PT price in accounting-asset terms. */
  ptDiscount: number;
  swapFeeApy: number;
  pendleApy: number;
  ytFloatingApy: number;
  /** Fee rate charged by the AMM on swaps (decimal). */
  feeRate: number;
  floatingPt: number | null;
  info: MarketInfo;
  updatedAt: string;
}

export type ChainMarkets = {
  chainId: number;
  fetchedAt: string;
  markets: Market[];
};

export interface MarketSnapshot {
  fetchedAt: string;
  chains: ChainMarkets[];
  /**
   * Markets the provider returned that had already expired. They are dropped
   * before caching (they were ~90% of the payload and are never actionable),
   * but the count is kept so the UI can say so instead of hiding it.
   */
  skippedExpired?: number;
}

export interface HistoryPoint {
  timestamp: string;
  impliedApy: number | null;
  ptPrice: number | null;
  totalTvl: number | null;
  underlyingApy: number | null;
}

export type BenchmarkSource = 'treasury' | 'override' | 'fallback';

export interface Benchmark {
  label: string;
  /** decimal, e.g. 0.03345 */
  pct: number;
  asOf: string;
  source: BenchmarkSource;
  url: string;
}

export type Verdict = 'safe' | 'balanced' | 'degen' | 'avoid';
export type Tier = 'A' | 'B' | 'C' | 'unknown';
export type AssetClass = 'stable' | 'rwa' | 'eth-staking' | 'eth' | 'btc' | 'other' | 'unknown';

export type FactorKey =
  | 'spread'
  | 'liquidity'
  | 'protocol'
  | 'maturity'
  | 'assetClass'
  | 'stability';

export interface ScoreFactor {
  key: FactorKey;
  label: string;
  /** Normalized 0..1 */
  value: number;
  /** Weight used in the composite (already re-normalized). */
  weight: number;
  detail: string;
}

export interface MarketScore {
  score: number;
  verdict: Verdict;
  factors: ScoreFactor[];
  flags: string[];
  assetClass: AssetClass;
  protocolTier: Tier;
}

export interface HistoryStats {
  points: number;
  mean: number | null;
  min: number | null;
  max: number | null;
  stddev: number | null;
  /** Share of samples where impliedApy >= benchmark. */
  coverage: number | null;
  /** Linear slope per day, decimal. */
  trendPerDay: number | null;
}

/* ---------------------------------- API ---------------------------------- */

export interface TokenAmount {
  token: string;
  amount: string;
}

export interface ConvertParams {
  chainId: number;
  tokenIn: string;
  /** Amount in token base units (string integer). */
  amountIn: string;
  tokenOut: string;
  receiver: string;
  /** decimal, 0.01 = 1% */
  slippage: number;
  enableAggregator?: boolean;
}

/**
 * The route the SDK actually built, captured from `contractParamInfo`.
 * Everything here is read straight out of the quote's transaction calldata, so
 * the UI can show *how* a number was produced instead of asking for trust.
 */
export interface ConvertRoute {
  /** Pendle router method, e.g. `swapExactTokenForPt`. */
  method: string | null;
  /** Router the transaction calls (`tx.to`). */
  router: string | null;
  /** Pendle's swap helper that carries the external swap, when one is used. */
  pendleSwap: string | null;
  /** SY underlying: `tokenMintSy` on entry-style routes, `tokenRedeemSy` on exits. */
  wrapToken: string | null;
  /** Exact input amount the router works from, in base units. */
  netAmountIn: string | null;
  /** SY amount between the two legs. Only returned for entry-style routes. */
  syAmount: string | null;
  /** External aggregator router address. */
  externalRouter: string | null;
  /** Pendle swap type; `1` means an external aggregator is in the path. */
  swapType: string | null;
  /** Pendle limit-order fills bundled into the route (these skip the AMM fee). */
  limitOrderFills: number;
  /** Nested 4-byte selectors for composed actions such as `roll-over-pt`. */
  composedSelectors: string[];
  /** Tokens the router will need an approval for. */
  requiredApprovals: TokenAmount[];
}

export interface ConvertQuote {
  action: string;
  outputs: TokenAmount[];
  priceImpact: number | null;
  internalPriceImpact: number | null;
  externalPriceImpact: number | null;
  feeUsd: number | null;
  gasUsed: string | null;
  impliedApyBefore: number | null;
  impliedApyAfter: number | null;
  effectiveApy: number | null;
  aggregatorType: string | null;
  route: ConvertRoute;
}

/* ------------------------------ Simulation ------------------------------- */

export type SimKind = 'entry' | 'exit' | 'roll';

export interface CostBreakdown {
  notionalUsd: number;
  protocolFeeUsd: number | null;
  priceImpactUsd: number | null;
  gasUsd: number | null;
  totalUsd: number;
  totalBps: number;
}

export interface EntrySimulation {
  kind: 'entry';
  marketId: string;
  /** The raw quote, kept so the route and fee derivation can be shown. */
  quote: ConvertQuote;
  sizeUsd: number;
  tokenIn: AssetRef;
  ptOut: number;
  ptPriceUsd: number;
  valueAtMaturityUsd: number;
  profitAtMaturityUsd: number;
  simpleApy: number;
  effectiveApy: number | null;
  impliedApyMarket: number;
  impliedApyAfterTrade: number | null;
  impactBps: number | null;
  daysToMaturity: number;
  breakEvenDays: number | null;
  cost: CostBreakdown;
}

export interface ExitSimulation {
  kind: 'exit';
  marketId: string;
  quote: ConvertQuote;
  ptIn: number;
  notionalUsd: number;
  tokenOut: AssetRef;
  amountOut: number;
  proceedsUsd: number;
  effectiveApy: number | null;
  impliedApyAfterTrade: number | null;
  cost: CostBreakdown;
}

export interface SensitivityRow {
  sizeUsd: number;
  totalCostUsd: number;
  totalBps: number;
  /** Destination effective APY at this size (what you would actually lock in). */
  effectiveApy: number | null;
}

export interface RollSimulation {
  kind: 'roll';
  sourceMarketId: string;
  destMarketId: string;
  destLabel: string;
  quote: ConvertQuote;
  ptIn: number;
  notionalUsd: number;
  destPtOut: number;
  /** Effective price you paid per destination PT (notional / PT received). */
  destPtPriceUsd: number;
  /** The destination market's own quoted PT price, for mark-to-market. */
  destPtMarketPriceUsd: number | null;
  /** What the new position is worth if held to the destination's maturity. */
  destParValueUsd: number;
  destDaysToMaturity: number;
  /** Headline implied APY the destination market is quoting. */
  destHeadlineApy: number;
  /** What you actually lock in after fees, routing and your own price impact. */
  destEffectiveApy: number | null;
  /**
   * `destEffectiveApy - destHeadlineApy`, in bps. Negative means the roll-over
   * costs you rate — this is the "roll-over drag" that shows up on roll day.
   * The Convert API does not return impliedApy before/after for roll-over-pt
   * quotes, so we derive it from the two numbers it *does* return.
   */
  dragBps: number | null;
  cost: CostBreakdown;
  sensitivity: SensitivityRow[];
}

export type Simulation = EntrySimulation | ExitSimulation | RollSimulation;

/* --------------------------- Settings / favorites ------------------------ */

export interface Settings {
  chains: number[];
  /** decimal or null to use the live treasury benchmark. */
  benchmarkOverridePct: number | null;
  slippagePct: number;
  defaultSizeUsd: number;
  minMaturityDays: number;
  minLiquidityUsd: number;
  hideUnknownProtocols: boolean;
  gasPriceGwei: number;
  /** Remaining API budget hint, purely informational. */
  showRiskNotes: boolean;
}

export interface FavoriteItem {
  marketId: string;
  chainId: number;
  address: string;
  name: string;
  protocol: string;
  expiry: string;
  addedAt: string;
  /** Fixed APY at the moment it was starred, so drift can be shown. */
  addedImpliedApy: number;
  /** Benchmark at that moment, so the spread change is meaningful. */
  addedBenchmarkPct: number | null;
}
