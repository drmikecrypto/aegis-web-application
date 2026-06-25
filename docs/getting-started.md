# Getting started

## Prerequisites

- Node.js 22+ (see `.nvmrc`)
- npm
- A Sonic RPC endpoint (public or your own)
- Deployed Aegis contract addresses for the network you target

## Install

```bash
npm ci
cp ENV_EXAMPLE.txt .env
```

Edit `.env` with addresses for your deployment. See [configuration.md](configuration.md).

## Development

```bash
npm run dev
```

Open `http://localhost:3000`.

## Contract ABIs

ABIs ship in `src/abis/`. After protocol upgrades, refresh them from the canonical [Aegis protocol](https://github.com/drmikecrypto/Aegis) tree and run:

```bash
npm run copy-abis
```

## Build for production

```bash
npm run build
```

Output is in `dist/`. The build writes `dist/manifest.hash.json` — include it when you publish or audit a bundle.

## Verify a GitHub release

1. Download the release zip and `.sha256` sidecar.
2. Check the zip hash matches the sidecar.
3. Optionally compare `dist/manifest.hash.json` inside the bundle with a governance-published manifest.

## What this app is

- **Static client** — no Aegis server holds your keys.
- **Sonic-first** — settlement on Sonic; Ethereum appears only where the Gateway bridge or a module explicitly uses L1.
- **ZK where wired** — Groth16 flows only when a matching verifier is deployed on-chain. The UI does not claim universal anonymity.
- **DAO-governed protocol** — parameter changes belong on-chain, not in a hidden admin panel inside this bundle.
