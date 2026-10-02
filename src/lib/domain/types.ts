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

/* ------------------------- yield sources & rewards ----------------------- */

/** One addressable source of an APY figure (a token, a campaign, PENDLE). */
export interface ApyItem {
  id: string;
  apy: number;
  /** Provider tags: INTEREST, REWARD, FIXED_YIELD, SWAP_FEE, INCENTIVE, … */
  tags: string[];
  /** Provider's own source label, when present (e.g. CONTRACT_DISCRETE). */
  source: string | null;
}

/** A labelled group of APY items, e.g. "PT Fixed Yield" or "LP Rewards". */
export interface ApyCategory {
  label: string;
  apy: number;
  items: ApyItem[];
}

/**
 * Pendle's own decomposition of a market's yield by source.
 *
 * This is **not** the PT holder's return: the LP and YT groups include rewards
 * a PT buyer never receives, so the UI must label each group with what it
 * applies to rather than presenting the total as "the yield".
 */
export interface ApyBreakdown {
  categories: ApyCategory[];
}

/** A points programme attached to a market's assets. */
export interface PointProgram {
  key: string;
  /** "multiplier" | "points-per-asset" */
  type: string;
  /** "basic" (the market's underlying/YT side) or "lp". */
  pendleAsset: string;
  value: number;
  perDollarLp: boolean | null;
}

/** Weekly PENDLE routed to a market, in PENDLE tokens. */
export interface PendleEmission {
  totalIncentive: number;
  tvlIncentive: number;
  feeIncentive: number;
  discretionaryIncentive: number;
  limitOrderIncentive: number;
}

/** Maker incentives for posting a resting limit order, in APY terms. */
export interface LimitOrderIncentive {
  /** The APY a maker can earn at the market's current state. */
  impliedApy: number;
  longMinApy: number | null;
  longMaxApy: number | null;
  shortMinApy: number | null;
  shortMaxApy: number | null;
}

/** Historical min/max implied APY Pendle reports for the market, decimal. */
export interface YieldRange {
  min: number;
  max: number;
}

/** A money market where this PT can be used as looping collateral. */
export interface ExternalProtocol {
  id: string;
  name: string;
  category: string | null;
  url: string | null;
  /** Loan token symbol, e.g. USDC. */
  debtSymbol: string | null;
  liquidityUsd: number;
  borrowApy: number | null;
  maxLtv: number | null;
  /** Pendle's modelled max looping APY through this venue. */
  maxLoopingApy: number | null;
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
  /** Market logo URL from the provider; only fetched if the user opts in. */
  icon: string | null;
  /** True when the underlying is not a stable exposure. */
  isVolatile: boolean;
  marketType: string | null;
  /** Points programmes attached to this market's assets. */
  points: PointProgram[];
  /** Provider's yield decomposition; each group is labelled by what it applies to. */
  lpBreakdown: ApyBreakdown | null;
  ytBreakdown: ApyBreakdown | null;
  underlyingRewardBreakdown: ApyBreakdown | null;
  emissions: PendleEmission | null;
  limitOrderIncentive: LimitOrderIncentive | null;
  /** Provider-reported historical range of the implied APY. */
  yieldRange: YieldRange | null;
  /** Money markets this PT can be looped through; empty when none apply. */
  externalProtocols: ExternalProtocol[];
  ptRoi: number | null;
  ytRoi: number | null;
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
  /** Only the daily (long) series carries these; absent on the hourly series. */
  ytPrice?: number | null;
  lpPrice?: number | null;
  totalTvl: number | null;
  underlyingApy: number | null;
}

/* ------------------------------ live market data ------------------------- */

/**
 * One price level of the combined limit-order book and AMM depth.
 *
 * Sizes are raw provider base-unit strings whose denomination the API does not
 * document (limit-order and AMM sizes do not even share a scale), so the UI
 * compares them *relatively* and never presents them as USD.
 */
export interface BookLevel {
  impliedApy: number;
  limitOrderSize: string;
  ammSize: string;
}

export interface LimitOrderBook {
  /** Orders to buy PT (resting bid). */
  long: BookLevel[];
  /** Orders to sell PT (resting ask). */
  short: BookLevel[];
}

/** Block-fresh spot rates, straight from the market. */
export interface LiveRate {
  impliedApy: number | null;
  /** PT received per underlying unit on entry. */
  ptPerUnderlying: number | null;
  /** Underlying received per PT on exit. */
  underlyingPerPt: number | null;
}

export type RiskLevel = 'none' | 'low' | 'medium' | 'high' | 'unknown';

export interface LoopRiskItem {
  name: string;
  label: string;
  level: RiskLevel;
  summary: string;
  rationale: string | null;
}

export interface LoopRisk {
  overallLabel: string;
  overallLevel: RiskLevel;
  items: LoopRiskItem[];
  ptOracleType: string | null;
  debtOracleType: string | null;
}

/** The position Pendle models its `maxApy` at, so the number is checkable. */
export interface LoopReference {
  positionUsd: number;
  leverage: number;
  fixedApy: number;
  borrowApy: number;
}

/** One money market you could loop this PT through. */
export interface LoopOption {
  chainId: number;
  protocol: string;
  moneyMarketName: string;
  moneyMarketAddress: string;
  url: string | null;
  marketUrl: string | null;
  debtSymbol: string;
  debtDecimals: number;
  /** Liquidation loan-to-value for the isolated market. */
  lltv: number | null;
  borrowApy: number | null;
  borrowApy7dAvg: number | null;
  /** The venue's own maximum leverage for this collateral. */
  maxLeverage: number | null;
  liquidityUsd: number;
  totalSupplyUsd: number | null;
  supplyCapUsd: number | null;
  /** Pendle's modelled max looping APY, at `reference`. */
  maxApy: number | null;
  reference: LoopReference | null;
  utilization: number | null;
  risks: LoopRisk | null;
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

/**
 * Objective, protocol-level depth for the protocol factor.
 *
 * There is no curated tier and no "unknown" state: every protocol is scored the
 * same way, from facts already in the snapshot (markets, chains, TVL, Pendle's
 * Prime flag). This measures *substance*, never *trust* — see `protocol.ts`.
 */
export interface ProtocolDepth {
  /** 0..1. */
  score: number;
  markets: number;
  chains: number;
  tvlUsd: number;
  isPrime: boolean;
}

export interface MarketScore {
  score: number;
  verdict: Verdict;
  factors: ScoreFactor[];
  flags: string[];
  assetClass: AssetClass;
  /** Null only when the snapshot produced no facts for this protocol. */
  protocolDepth: ProtocolDepth | null;
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
  gasPriceGwei: number;
  /** Remaining API budget hint, purely informational. */
  showRiskNotes: boolean;
  /**
   * Load market logos from Pendle's image CDN. Off by default: it is the only
   * request the extension would make to a host other than the two documented
   * APIs, and it would tell that host which markets you are looking at.
   */
  remoteLogos: boolean;
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
