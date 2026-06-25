# Deployment

## Build

```bash
npm ci
npm run build
```

Artifacts: `dist/` plus `dist/manifest.hash.json`.

## Self-host

Serve `dist/` from any static host (CDN, object storage, IPFS, Arweave, nginx, etc.).

Requirements:

- **HTTPS** in production
- Correct `Content-Type` for `.wasm` and `.json`
- Cache busting via filename hashes (Vite default)

## Integrity

1. Record the SHA-256 manifest after build.
2. Attach checksums to your [GitHub Release](https://github.com/drmikecrypto/aegis-web-application/releases) or governance announcement.
3. Users verify before trusting a hosted copy.

## Sonic mainnet reference

| | |
|--|--|
| Chain ID | **146** |
| RPC | `https://rpc.soniclabs.com` |
| Explorer | [sonicscan.org](https://sonicscan.org) |
| AGS | `0x5125bF734a95F2Df0ddEf99934dc33fb1d175E3d` |

Confirm addresses against the [Aegis protocol repo](https://github.com/drmikecrypto/Aegis) for your target network.

## Releases

Tagged releases (`v*`) trigger `.github/workflows/release.yml`, which publishes a zip and checksum on GitHub.

## After deployment

- Point your `.sonic` or DNS name at the hosted bundle if applicable.
- Update the sovereign-node manifest if you ship the same hash in the native app.
