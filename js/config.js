/*
 * Proof of Design — settings you can edit.
 */
window.POD_CONFIG = {
  // 'main' for real stamps, 'test' for BSV testnet (free faucet coins, nothing of value).
  // Users can also switch this in the "Key & funds" tab; this is just the default.
  defaultNetwork: 'main',

  // OPTIONAL: charge a tiny fee per stamp, paid to YOUR OWN BSV address.
  // Leave address empty ('') to charge nothing. Example: { address: '1YourAddress...', satoshis: 1000 }
  // 1,000 sats ≈ £0.00014 at Oct 2026 prices — set whatever you like. Only applies to the
  // built-in stamping-key mode (BRC-100 wallet mode adds it as a normal output too).
  serviceFee: { address: '', satoshis: 0 },

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
