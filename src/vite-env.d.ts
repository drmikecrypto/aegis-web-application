/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TOKEN_ADDRESS: string
  readonly VITE_GOVERNANCE_ADDRESS: string
  readonly VITE_VERIFIER_FACTORY_ADDRESS: string
  readonly VITE_STAKING_ADDRESS: string
  readonly VITE_LENDING_ADDRESS: string
  readonly VITE_INSURANCE_ADDRESS: string
  readonly VITE_CROWDFUNDING_ADDRESS: string
  readonly VITE_YIELD_FARMING_ADDRESS: string
  readonly VITE_LEADERBOARD_ADDRESS: string
  readonly VITE_SONIC_GATEWAY_WRAPPER_ADDRESS: string
  readonly VITE_PRIVATEAMMCONTRACT_ADDRESS: string
  readonly VITE_TREASURYLIQUIDITYALLOCATOR_ADDRESS: string
  readonly VITE_GOVERNANCE_TREASURY_ADDRESS: string
  readonly VITE_TOKEN_ALLOCATION_ADDRESS: string
  readonly VITE_CROSS_CHAIN_BRIDGE_ADDRESS: string
  readonly VITE_GOVERNANCE_EMERGENCY_ADDRESS: string
  readonly VITE_POOL_PRICE_VALIDATOR_ADDRESS: string
  readonly VITE_DEFAULT_NETWORK?: string
  readonly VITE_DAO_RPC_URL?: string
  readonly VITE_TRUSTED_RPC_HOSTS?: string
  /** Comma-separated `https://host` (or bare hostnames) added to production CSP `connect-src` at build time. */
  readonly VITE_CSP_EXTRA_CONNECT?: string
  readonly VITE_ETHERSCAN_API_KEY?: string
  readonly VITE_CUSTOM_RPC_URL?: string
  /** Optional remote prover (mint/shield, lending, staking, …) */
  readonly VITE_PROVER_URL?: string
  readonly VITE_PRIVACY_ENTRY_ROUTER_ADDRESS?: string
  /** Optional `StagedCapitalVault` for VC-style milestone rounds */
  readonly VITE_STAGED_CAPITAL_VAULT_ADDRESS?: string
  /** Max random delay (ms) before `relayShield` / transparent-exit relay; capped at 30000. 0 or unset = off. */
  readonly VITE_PRIVACY_SUBMIT_JITTER_MAX_MS?: string
  /** When `1`, Wallet shows local shield / transparent-exit stats + optional telemetry opt-in — see docs/ops/PRIVACY_METRICS_PRODUCT_AND_LEGAL.md */
  readonly VITE_SHOW_LOCAL_PRIVACY_STATS?: string
  /** Optional HTTPS URL for opt-in anonymous aggregate privacy counters (CORS must allow static host). */
  readonly VITE_PRIVACY_TELEMETRY_ENDPOINT?: string
  /** Private lending — `VerifierFactory` split circuits (match `Aegis-contracts` + `npm run gen:frontend-env`) */
  readonly VITE_LENDING_TENOR_WASM?: string
  readonly VITE_LENDING_TENOR_ZKEY?: string
  readonly VITE_LENDING_TENOR_TXID?: string
  readonly VITE_LENDING_TENOR_ZKEY_TXID?: string
  readonly VITE_LENDING_LIQUIDITY_WASM?: string
  readonly VITE_LENDING_LIQUIDITY_ZKEY?: string
  readonly VITE_LENDING_LIQUIDITY_TXID?: string
  readonly VITE_LENDING_LIQUIDITY_ZKEY_TXID?: string
  readonly VITE_LENDING_REPAY_WASM?: string
  readonly VITE_LENDING_REPAY_ZKEY?: string
  readonly VITE_LENDING_REPAY_TXID?: string
  readonly VITE_LENDING_REPAY_ZKEY_TXID?: string
  readonly VITE_LENDING_WITHDRAW_WASM?: string
  readonly VITE_LENDING_WITHDRAW_ZKEY?: string
  readonly VITE_LENDING_WITHDRAW_TXID?: string
  readonly VITE_LENDING_WITHDRAW_ZKEY_TXID?: string
  readonly VITE_LENDING_LIQUIDATE_WASM?: string
  readonly VITE_LENDING_LIQUIDATE_ZKEY?: string
  readonly VITE_LENDING_LIQUIDATE_TXID?: string
  readonly VITE_LENDING_LIQUIDATE_ZKEY_TXID?: string
  /** Legacy single-circuit bundle (`lending.circom`) — not used by current `PrivateLendingContract` */
  readonly VITE_LENDING_WASM?: string
  readonly VITE_LENDING_ZKEY?: string
  readonly VITE_LENDING_TXID?: string
  readonly VITE_LENDING_ZKEY_TXID?: string
  readonly VITE_BONDING_CURVE_ADDRESS?: string
  readonly VITE_BONDING_CURVE_PURCHASE_WASM?: string
  readonly VITE_BONDING_CURVE_PURCHASE_ZKEY?: string
  readonly VITE_BONDING_CURVE_PURCHASE_TXID?: string
  readonly VITE_BONDING_CURVE_PURCHASE_ZKEY_TXID?: string
  readonly VITE_BONDING_CURVE_SELL_WASM?: string
  readonly VITE_BONDING_CURVE_SELL_ZKEY?: string
  readonly VITE_BONDING_CURVE_SELL_TXID?: string
  readonly VITE_BONDING_CURVE_SELL_ZKEY_TXID?: string
  readonly VITE_VERIFIER_ARTIFACT_MANIFEST?: string
  readonly VITE_GOVERNANCE_CORE_ADDRESS?: string
  readonly VITE_AUTOMATED_LIQUIDITY_DEPLOYER_ADDRESS?: string
  readonly VITE_TIME_LOCK_PURCHASE_LIMITS_ADDRESS?: string
  readonly VITE_CEREMONY_VERIFIER_ADDRESS?: string
  readonly VITE_FEEM_GOVERNANCE_EXTENSION_ADDRESS?: string
  readonly VITE_TIMELOCK_CONTROLLER_ADDRESS?: string
  readonly VITE_DAO_REVENUE_ROUTER_ADDRESS?: string
  readonly VITE_PUBLIC_POOL_ROUTER_ADDRESS?: string
  readonly VITE_TRANSPARENT_ESCROW_ORDERS_ADDRESS?: string
  readonly VITE_SIGNED_LIMIT_ORDER_REGISTRY_ADDRESS?: string
  readonly VITE_RFQ_INTENT_SETTLEMENT_ADDRESS?: string
  readonly VITE_TOKEN_DISTRIBUTION_SALE_ADDRESS?: string
  readonly VITE_LIQUIDITY_MINING_GAUGE_ADDRESS?: string
  readonly VITE_TREASURY_BOND_AUCTION_ADDRESS?: string
  readonly VITE_MESSAGING_ADAPTER_ALLOWLIST_ADDRESS?: string
  readonly VITE_ANALYTICS_SUB_PRICE_WEI?: string
  /** Set to `1` to load Google Translate (third-party script to Google). Default: off. */
  readonly VITE_OPERATIONAL_PROFILE?: string
  readonly VITE_SECURITY_PROFILE?: string
  readonly VITE_ENABLE_THIRD_PARTY_TRANSLATE?: string
  /** Set to `1` to enable canvas/WebGL/audio device fingerprint for DDoS heuristics. Default: session-only random id. */
  readonly VITE_ENABLE_CLIENT_FINGERPRINT?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

