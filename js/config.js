/*
 * Proof of Design — settings you can edit.
 */
window.POD_CONFIG = {
  // 'main' for real stamps, 'test' for BSV testnet (free faucet coins, nothing of value).
  // Users can also switch this in the "Key & funds" tab; this is just the default.
  defaultNetwork: 'main',

  // Service fee charged per stamp, paid to the tool owner's own BSV address.
  // Set address to '' (or satoshis to 0) to charge nothing.
  // 1,000 sats ≈ £0.00014 (0.014p) at Oct 2026 prices. Charged on MAINNET stamps only
  // (testnet practice stamps are free). Paid as a normal P2PKH output in both the
  // built-in stamping-key mode and BRC-100 wallet mode.
  serviceFee: { address: '19Rzo9uMgt4Uiv15xyvGQkxvtxXwC1ayxG', satoshis: 1000 },

  // Fallback network fee if the live miner policy can't be fetched (satoshis per 1,000 bytes).
  fallbackSatsPerKb: 100,

  // Public infrastructure (no API keys needed).
  arc: { main: 'https://arc.gorillapool.io', test: 'https://testnet.arc.gorillapool.io' },
  woc: { main: 'https://api.whatsonchain.com/v1/bsv/main', test: 'https://api.whatsonchain.com/v1/bsv/test' },
  explorer: { main: 'https://whatsonchain.com/tx/', test: 'https://test.whatsonchain.com/tx/' },
  priceUrl: 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin-cash-sv&vs_currencies=gbp,usd',

  // Safety: warn if the stamping key holds more than this many satoshis.
  maxRecommendedBalanceSats: 1000000
}
