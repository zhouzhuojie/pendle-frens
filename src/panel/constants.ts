/** Constants that describe *how the numbers are produced*, shown in the UI. */

/**
 * The Convert API requires a receiver. We are a read-only extension and never
 * sign transactions, so quotes are built for a burn address. The calldata is
 * only used to read back expected amounts / price impact.
 */
export const SIMULATION_RECEIVER = '0x000000000000000000000000000000000000dEaD';

export const DATA_SOURCES = [
  { label: 'Pendle hosted API (markets, history, quotes)', url: 'https://api-v2.pendle.finance/core/docs' },
  { label: 'U.S. Treasury Fiscal Data (benchmark)', url: 'https://fiscaldata.treasury.gov/datasets/average-interest-rates-treasury-securities/' },
];

export const DISCLAIMER =
  'Read-only research tool. Quotes are API estimates and move with liquidity; gas is an estimate. Nothing here is financial advice.';
