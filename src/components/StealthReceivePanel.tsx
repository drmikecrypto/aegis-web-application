import { useState } from 'react'
import toast from 'react-hot-toast'
import { randomBytes } from 'ethers'
import { useWalletStore } from '@/store/walletStore'
import { CONTRACT_ADDRESSES, ZERO_ADDRESS } from '@/config/contracts'
import { getStealthAddressHubContract } from '@/utils/contracts'
import { isValidHex, checkRateLimit } from '@/utils/security'
import { waitAndParseTransaction } from '@/utils/transactionHelper'
import { formatAddress } from '@/utils/format'

function parseBytes32(raw: string): `0x${string}` | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const body = trimmed.startsWith('0x') ? trimmed.slice(2) : trimmed
  if (!isValidHex(body, 32)) return null
  return (`0x${body.padStart(64, '0')}`) as `0x${string}`
}

export default function StealthReceivePanel() {
  const { signer, address, provider } = useWalletStore()
  const [viewTag, setViewTag] = useState('')
  const [spendingKeyHash, setSpendingKeyHash] = useState('')
  const [registering, setRegistering] = useState(false)

  const hubConfigured =
    CONTRACT_ADDRESSES.STEALTH_ADDRESS_HUB &&
    CONTRACT_ADDRESSES.STEALTH_ADDRESS_HUB !== ZERO_ADDRESS

  const generateTags = () => {
    setViewTag('0x' + Buffer.from(randomBytes(32)).toString('hex'))
    setSpendingKeyHash('0x' + Buffer.from(randomBytes(32)).toString('hex'))
  }

  const handleRegister = async () => {
    try {
      checkRateLimit('critical')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Rate limit exceeded')
      return
    }
    if (!signer || !address) {
      toast.error('Connect wallet first')
      return
    }
    const vt = parseBytes32(viewTag)
    const sk = parseBytes32(spendingKeyHash)
    if (!vt || !sk) {
      toast.error('View tag and spending key hash must be 32-byte hex')
      return
    }
    const hub = getStealthAddressHubContract(signer)
    if (!hub) {
      toast.error('StealthAddressHub not configured (set VITE_STEALTH_ADDRESS_HUB_ADDRESS)')
      return
    }
    setRegistering(true)
    try {
      toast.loading('Registering stealth meta…', { id: 'stealth-meta' })
      const tx = await hub.registerStealthMeta(vt, sk)
      await waitAndParseTransaction(tx, address, provider)
      toast.success('Stealth receive rail registered', { id: 'stealth-meta' })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Registration failed', { id: 'stealth-meta' })
    } finally {
      setRegistering(false)
    }
  }

  return (
    <div className="card space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-terminal-accent">Stealth receive</h2>
        <p className="text-sm text-terminal-text-dim mt-1">
          Register a <strong className="text-terminal-text">view tag</strong> on Sonic so payers can route funds with
          opaque payment tags — without reusing your public wallet graph. Claiming into shielded commitments requires a
          ZK proof (<code className="text-terminal-accent">stealth-address</code> circuit).
        </p>
      </div>

      {!hubConfigured ? (
        <p className="text-sm text-amber-700">
          Deploy <code>StealthAddressHub</code> locally and set{' '}
          <code className="text-terminal-accent">VITE_STEALTH_ADDRESS_HUB_ADDRESS</code> in your frontend env.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary text-sm" onClick={generateTags}>
          Generate random tags
        </button>
      </div>

      <div>
        <label className="block text-sm font-medium text-terminal-text-dim mb-1">View tag (share with payers)</label>
        <input
          className="input-field w-full font-mono text-xs"
          value={viewTag}
          onChange={(e) => setViewTag(e.target.value)}
          placeholder="0x… (32 bytes)"
          disabled={registering}
        />
        {viewTag && parseBytes32(viewTag) ? (
          <p className="text-xs text-terminal-text-dim mt-1">Short: {formatAddress(viewTag)}</p>
        ) : null}
      </div>

      <div>
        <label className="block text-sm font-medium text-terminal-text-dim mb-1">Spending key hash (keep private)</label>
        <input
          className="input-field w-full font-mono text-xs"
          value={spendingKeyHash}
          onChange={(e) => setSpendingKeyHash(e.target.value)}
          placeholder="0x… (32 bytes)"
          disabled={registering}
        />
      </div>

      <button
        type="button"
        className="btn-primary w-full sm:w-auto"
        disabled={!hubConfigured || registering || !viewTag || !spendingKeyHash}
        onClick={() => void handleRegister()}
      >
        {registering ? 'Registering…' : 'Register stealth meta'}
      </button>
    </div>
  )
}
