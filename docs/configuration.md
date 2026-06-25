# Configuration

## Environment file

Copy `ENV_EXAMPLE.txt` to `.env` and set addresses for your Sonic deployment.

All `VITE_*` variables are baked in at **build time**. Rebuild after changing `.env`.

## Core contracts

| Variable | Role |
|----------|------|
| `VITE_TOKEN_ADDRESS` | AGS token |
| `VITE_GOVERNANCE_ADDRESS` | Shielded governance |
| `VITE_VERIFIER_FACTORY_ADDRESS` | On-chain verifier registry |
| `VITE_GOVERNANCE_TREASURY_ADDRESS` | Timelocked treasury |
| `VITE_TREASURYLIQUIDITYALLOCATOR_ADDRESS` | DAO liquidity allocator |
| `VITE_TOKEN_ALLOCATION_ADDRESS` | Tranche streaming |

## Modules (enable when deployed)

| Variable | Module |
|----------|--------|
| `VITE_STAKING_ADDRESS` | Staking |
| `VITE_LENDING_ADDRESS` | Lending |
| `VITE_INSURANCE_ADDRESS` | Insurance |
| `VITE_CROWDFUNDING_ADDRESS` | Crowdfunding |
| `VITE_YIELD_FARMING_ADDRESS` | Yield farming |
| `VITE_CROSS_CHAIN_BRIDGE_ADDRESS` | Cross-chain privacy bridge |
| `VITE_SONIC_GATEWAY_WRAPPER_ADDRESS` | Sonic Gateway wrapper |

Optional modules can stay unset — the UI hides surfaces that have no address.

## RPC and chain

| Variable | Purpose |
|----------|---------|
| `VITE_RPC_URL` | Default read RPC |
| `VITE_CHAIN_ID` | Sonic chain id (`146` mainnet, `14601` testnet) |

Users can pick another RPC in the header. Custom HTTPS URLs are accepted when they pass trust rules.

## Sonic chain pack

`public/config/sonic-chain-pack.json` carries network metadata, bridge tokens, and RPC hints. Keep it aligned with the [Aegis protocol](https://github.com/drmikecrypto/Aegis) deployment you target.

## Circuits and verifiers

Prover artifacts live under `public/circuits/`. Manifest: `public/config/verifier-artifact-manifest.json`.

Override CDN paths with `VITE_*` circuit URL variables if you host bundles separately.

## Token sale

The **Dutch auction / TGE** UI is a separate app: [aegis-token-sale](https://github.com/drmikecrypto/aegis-token-sale). This web application is the long-lived ecosystem console after distribution.

## Address format

Ethereum-style `0x` + 40 hex characters. Verify on [sonicscan.org](https://sonicscan.org) before production use.
