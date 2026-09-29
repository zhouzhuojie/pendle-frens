/**
 * Chain metadata and Pendle deep-links.
 *
 * Chain slugs mirror the `chain` query param used by app.pendle.finance.
 */

export interface ChainMeta {
  id: number;
  slug: string;
  name: string;
  /** Wrapped native token, used to price gas. */
  wrappedNative: string;
}

export const CHAINS: ChainMeta[] = [
  { id: 1, slug: 'ethereum', name: 'Ethereum', wrappedNative: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2' },
  { id: 42161, slug: 'arbitrum', name: 'Arbitrum', wrappedNative: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1' },
  { id: 8453, slug: 'base', name: 'Base', wrappedNative: '0x4200000000000000000000000000000000000006' },
  { id: 10, slug: 'optimism', name: 'Optimism', wrappedNative: '0x4200000000000000000000000000000000000006' },
  { id: 56, slug: 'bnb', name: 'BNB Chain', wrappedNative: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c' },
  { id: 5000, slug: 'mantle', name: 'Mantle', wrappedNative: '0x78c1b0c915c4faa5fffa6cabf0219da63d7f4cb8' },
  { id: 146, slug: 'sonic', name: 'Sonic', wrappedNative: '0x039e2fb66102314ce7b64ce5ce3e48bc01915524' },
  { id: 999, slug: 'hyperevm', name: 'HyperEVM', wrappedNative: '0x5555555555555555555555555555555555555555' },
  { id: 80094, slug: 'berachain', name: 'Berachain', wrappedNative: '0x6969696969696969696969696969696969696969' },
  { id: 143, slug: 'monad', name: 'Monad', wrappedNative: '0x0000000000000000000000000000000000000000' },
  { id: 747474, slug: 'katana', name: 'Katana', wrappedNative: '0x0000000000000000000000000000000000000000' },
  { id: 57073, slug: 'ink', name: 'Ink', wrappedNative: '0x4200000000000000000000000000000000000006' },
];

const BY_ID = new Map(CHAINS.map((c) => [c.id, c]));

export function chainMeta(id: number): ChainMeta | undefined {
  return BY_ID.get(id);
}

export function chainName(id: number): string {
  return BY_ID.get(id)?.name ?? `Chain ${id}`;
}

export function chainSlug(id: number): string {
  return BY_ID.get(id)?.slug ?? 'ethereum';
}

/** Stablecoins we accept as a simulation input token on each chain. */
export const STABLE_TOKENS: Record<number, { address: string; symbol: string; decimals: number }[]> = {
  1: [
    { address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', symbol: 'USDC', decimals: 6 },
    { address: '0xdac17f958d2ee523a2206206994597c13d831ec7', symbol: 'USDT', decimals: 6 },
    { address: '0x6b175474e89094c44da98b954eedeac495271d0f', symbol: 'DAI', decimals: 18 },
    { address: '0x4c9edd5852cd905f086c759e8383e09bff1e68b3', symbol: 'USDe', decimals: 18 },
    { address: '0xdc035d45d973e3ec169d2276ddab16f1e407384f', symbol: 'USDS', decimals: 18 },
  ],
  42161: [
    { address: '0xaf88d065e77c8cc2239327c5edb3a432268e5831', symbol: 'USDC', decimals: 6 },
    { address: '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9', symbol: 'USDT', decimals: 6 },
    { address: '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1', symbol: 'DAI', decimals: 18 },
  ],
  8453: [
    { address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', symbol: 'USDC', decimals: 6 },
  ],
  10: [
    { address: '0x0b2c639c533813f4aa9d7837caf62653d097ff85', symbol: 'USDC', decimals: 6 },
    { address: '0x94b008aa00579c1307b0ef2c499ad98a8ce58e58', symbol: 'USDT', decimals: 6 },
  ],
};

export const PENDLE_APP = 'https://app.pendle.finance';

export function marketDeepLink(chainId: number, marketAddress: string, view: 'pt' | 'yt' | 'lp' = 'pt'): string {
  const params = new URLSearchParams({ chain: chainSlug(chainId), view });
  return `${PENDLE_APP}/trade/markets/${marketAddress}/swap?${params.toString()}`;
}

export function marketsListDeepLink(chainId: number): string {
  return `${PENDLE_APP}/trade/markets?chains=${chainSlug(chainId)}`;
}
