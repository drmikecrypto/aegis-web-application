# Security & privacy

## Design stance

Aegis is **private finance on Sonic — verifiable and open for audit**. This client is honest about what it can and cannot hide:

- **No private keys in the app** — signing happens in the user’s wallet.
- **ZK only with on-chain verifiers** — Groth16 where a matching verifier is deployed.
- **No universal anonymity claim** — privacy follows what the contracts and circuits actually implement.
- **RPC visibility** — the header shows which RPC you use; prefer your own node or the sovereign app for stronger isolation.

## Client-side protections

| Measure | Purpose |
|---------|---------|
| Rate limiting | Reduces abuse of RPC and gateway endpoints |
| Gateway fallback | Multiple Arweave gateways with failover |
| Input validation | Sanitizes user-facing input |
| Request throttling | Limits rapid repeated calls |
| CSP (hosting) | Set at deploy time for your origin |

Implementation: `src/utils/rateLimiter.ts`, `arweaveGateway.ts`, `ddosProtection.ts`, `security.ts`.

## Operational security

- Host the built `dist/` over **HTTPS**.
- Pin contract addresses to a governance-approved manifest.
- Publish `manifest.hash.json` with every release so users can verify integrity.
- Report vulnerabilities via the [Aegis SECURITY policy](https://github.com/drmikecrypto/Aegis/blob/main/SECURITY.md).

## Dependency hygiene

```bash
npm run security:scan
```

Runs production audit and unused-dependency checks. Run in CI before tagging a release.

## Sovereign node

For maximum control: run the [Aegis sovereign node](https://github.com/drmikecrypto/aegis-sovereign-node-app) — local loopback RPC and circuit server, same UI bundled inside the native app.
