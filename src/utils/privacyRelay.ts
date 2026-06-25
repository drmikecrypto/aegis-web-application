import { CONTRACT_ADDRESSES, ZERO_ADDRESS } from '@/config/contracts'

/** HTTP relayer base URL (`privacy-entry-relayer-http.mjs`). */
export function privacyRelayHttpUrl(): string | undefined {
  const u = (import.meta.env.VITE_PRIVACY_RELAY_HTTP_URL as string | undefined)?.trim()
  return u || undefined
}

export function privacyRelayApiKey(): string | undefined {
  const k = (import.meta.env.VITE_PRIVACY_RELAY_API_KEY as string | undefined)?.trim()
  return k || undefined
}

function configuredPrivacyRouterAddress(): string | null {
  const a = CONTRACT_ADDRESSES.PRIVACY_ENTRY_ROUTER
  if (!a || a === ZERO_ADDRESS) return null
  if (!/^0x[a-fA-F0-9]{40}$/i.test(a)) return null
  return a
}

/**
 * When true, Wallet shield/unshield prefers POSTing to the local relayer daemon (gas paid by relayer).
 * Default on when `VITE_PRIVACY_RELAY_HTTP_URL` + router are set unless `VITE_DEFAULT_GASLESS_RELAY=0`.
 */
export function preferGaslessPrivacyRelay(): boolean {
  const off =
    import.meta.env.VITE_DEFAULT_GASLESS_RELAY === '0' ||
    import.meta.env.VITE_DEFAULT_GASLESS_RELAY === 'false'
  if (off) return false
  return Boolean(privacyRelayHttpUrl() && configuredPrivacyRouterAddress())
}

export type RelayShieldPayload = {
  proof: string[]
  publicInputs: string[]
  deadline: string
  nonce: string
  signature: string
}

export async function postPrivacyRelay(
  path: '/v1/relay-shield' | '/v1/relay-unshield' | '/v1/relay-transparent-exit',
  body: RelayShieldPayload & { authorizedSigner?: string }
): Promise<{ txHash: string }> {
  const base = privacyRelayHttpUrl()
  if (!base) throw new Error('VITE_PRIVACY_RELAY_HTTP_URL not configured')
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const apiKey = privacyRelayApiKey()
  if (apiKey) headers['X-Relayer-Api-Key'] = apiKey

  const res = await fetch(`${base.replace(/\/+$/, '')}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; txHash?: string; error?: string }
  if (!res.ok || !data.ok || !data.txHash) {
    throw new Error(data.error || `Relayer error (${res.status})`)
  }
  return { txHash: data.txHash }
}
