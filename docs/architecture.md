# Architecture

## Overview

The Aegis Web Application is a **static** React (Vite + TypeScript) client. Wallets sign transactions; RPC nodes serve reads. On-chain contracts are the source of truth.

```
Browser  →  Wallet (EIP-1193)  →  Sonic RPC
         →  Local prover (optional)  →  Groth16 verifier on-chain
         →  Static assets (circuits, chain pack, ABIs)
```

There is no mandatory Aegis backend for users to trade or govern.

## Trust model

| Layer | Responsibility |
|-------|----------------|
| **Contracts** | Balances, rules, verification |
| **Wallet** | Keys and transaction signing |
| **RPC** | Chain reads (user-selectable) |
| **This client** | UX, proof generation in-browser where implemented |
| **Governance** | Upgrades and parameters via timelock |

This repository cannot silently change deployed bytecode — it is a static bundle.

## Privacy and ZK

- Witness material should stay in the **browser** when flows use local proving (`public/circuits/*.wasm`, `*.zkey`).
- A remote prover URL is **optional** and should be disclosed to users if used.
- Stealth and shielded paths exist only where the deployed Solidity implements them.

## Modules

Governance, treasury, staking, lending, insurance, crowdfunding, liquidity, bridge, and explorer surfaces map to pages under `src/pages/`. Each module reads addresses from `src/config/contracts.ts` (from `.env` at build time).

## Tech stack

React 18 · TypeScript · Vite · Ethers v6 · Zustand · TanStack Query · Tailwind CSS · React Router

## Related repositories

- [Aegis protocol](https://github.com/drmikecrypto/Aegis) — Solidity, Circom, tests
- [Aegis token sale](https://github.com/drmikecrypto/aegis-token-sale) — TGE microsite
- [Aegis sovereign node](https://github.com/drmikecrypto/aegis-sovereign-node-app) — native shell with local RPC
