import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Contract, parseEther, randomBytes } from 'ethers'
import { useWalletStore } from '@/store/walletStore'
import { formatBalance, formatAddress } from '@/utils/format'
import { getTokenContract } from '@/utils/contracts'
import { ABIS } from '@/abis'
import { CONTRACT_ADDRESSES, ZERO_ADDRESS } from '@/config/contracts'
import { signShieldIntent, signTransparentExitIntent } from '@/utils/privacyEntryRouter'
import { preferGaslessPrivacyRelay, postPrivacyRelay } from '@/utils/privacyRelay'
import { validateAmount, detectAttackPattern, checkRateLimit } from '@/utils/security'
import { waitAndParseTransaction } from '@/utils/transactionHelper'
import { getCommitments } from '@/utils/commitmentStorage'
import { formatContractErrorForToast } from '@/utils/zkRevertHints'
import SonicGatewayConverter from '@/components/SonicGatewayConverter'
import StealthReceivePanel from '@/components/StealthReceivePanel'
import DaoModuleNotice from '@/components/DaoModuleNotice'
import CommitmentLocalStorageWarning from '@/components/CommitmentLocalStorageWarning'
import CommitmentVaultControls from '@/components/CommitmentVaultControls'
import {
  formatLocalPrivacySummaryLine,
  getLocalPrivacyMetrics,
  isTelemetryOptIn,
  maybeSendPrivacyTelemetryBeacon,
  recordShieldStarted,
  recordShieldSucceeded,
  recordUnshieldStarted,
  recordUnshieldSucceeded,
  resetLocalPrivacyMetrics,
  setTelemetryOptIn,
} from '@/utils/localPrivacyMetrics'
import { allowPrivacyTelemetry } from '@/utils/operationalProfile'

function configuredPrivacyRouterAddress(): string | null {
  const a = CONTRACT_ADDRESSES.PRIVACY_ENTRY_ROUTER
  if (!a || a === ZERO_ADDRESS) return null
  if (!/^0x[a-fA-F0-9]{40}$/i.test(a)) return null
  return a
}

/** Optional inter-arrival jitter before `relayShield` / transparent exit relay (see docs/AEGIS_MAXIMUM_STEALTH_LOCAL_BUILD_SPEC.md §5). */
function privacyRelaySubmitJitterMaxMs(): number {
  const raw = (import.meta.env.VITE_PRIVACY_SUBMIT_JITTER_MAX_MS as string | undefined)?.trim()
  const n = raw ? parseInt(raw, 10) : 0
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.min(n, 30_000)
}

async function sleepPrivacyRelaySubmitJitter(): Promise<void> {
  const max = privacyRelaySubmitJitterMaxMs()
  if (max <= 0) return
  const ms = 1 + Math.floor(Math.random() * max)
  await new Promise((r) => setTimeout(r, ms))
}

export default function Wallet() {
  const { address, isConnected, provider, signer } = useWalletStore()
  const [shieldAmount, setShieldAmount] = useState('')
  const [unshieldAmount, setUnshieldAmount] = useState('')
  const [selectedCommitment, setSelectedCommitment] = useState<string>('')
  const [isShielding, setIsShielding] = useState(false)
  const [isUnshielding, setIsUnshielding] = useState(false)
  const [showShieldModal, setShowShieldModal] = useState(false)
  const [showUnshieldModal, setShowUnshieldModal] = useState(false)
  const [showCommitmentsModal, setShowCommitmentsModal] = useState(false)

  const { data: balance } = useQuery({
    queryKey: ['wallet-balance', address],
    queryFn: async () => {
      if (!provider || !address) return 0n
      try {
        return await provider.getBalance(address)
      } catch {
        return 0n
      }
    },
    enabled: !!provider && !!address,
  })

  const { data: tokenBalance } = useQuery({
    queryKey: ['token-balance', address],
    queryFn: async () => {
      if (!provider || !address) return 0n
      try {
        const contract = getTokenContract(provider)
        return await contract.balanceOf(address)
      } catch {
        return 0n
      }
    },
    enabled: !!provider && !!address,
  })

  const { data: commitments } = useQuery({
    queryKey: ['wallet-commitments', address],
    queryFn: async () => {
      if (!address) return []
      return getCommitments(address)
    },
    enabled: !!address,
  })

  const { data: publicEntryEnabled = true } = useQuery({
    queryKey: ['token-public-entry-enabled', provider],
    queryFn: async () => {
      if (!provider) return true
      const c = getTokenContract(provider)
      return (await c.publicEntryEnabled()) as boolean
    },
    enabled: !!provider,
    staleTime: 30_000,
  })

  const publicEntryOpen = publicEntryEnabled !== false
  const privacyRouterAddr = configuredPrivacyRouterAddress()
  const proverUrl = (import.meta.env.VITE_PROVER_URL as string | undefined)?.trim()
  const canShield = Boolean(proverUrl) && (publicEntryOpen || Boolean(privacyRouterAddr))
  /** Transparent exit uses the `transfer-unshield` rail — same prover requirement as shield (no legacy `transfer` circuit substitute). */
  const canUnshieldEntry =
    Boolean(proverUrl?.trim()) && (publicEntryOpen || Boolean(privacyRouterAddr))

  const showLocalPrivacyStats = allowPrivacyTelemetry()
  const privacyTelemetryEndpoint = (import.meta.env.VITE_PRIVACY_TELEMETRY_ENDPOINT as string | undefined)?.trim()
  const [telemetryOptInUi, setTelemetryOptInUi] = useState(false)
  const [localStatsNonce, setLocalStatsNonce] = useState(0)

  useEffect(() => {
    setTelemetryOptInUi(isTelemetryOptIn())
  }, [])

  const localPrivacySnapshot = useMemo(
    () => (showLocalPrivacyStats ? getLocalPrivacyMetrics() : null),
    [showLocalPrivacyStats, localStatsNonce]
  )

  const handleShield = async () => {
    try {
      checkRateLimit('critical')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Rate limit exceeded')
      return
    }

    if (!signer || !address || !shieldAmount) {
      toast.error('Please connect wallet and enter amount')
      return
    }

    const amountValidation = validateAmount(shieldAmount)
    if (!amountValidation.valid) {
      toast.error(amountValidation.error || 'Invalid amount')
      return
    }

    if (detectAttackPattern(shieldAmount)) {
      toast.error('Invalid input detected')
      return
    }

    if (!publicEntryOpen && !privacyRouterAddr) {
      toast.error(
        'Direct shield / transparent exit is disabled on-chain. Set VITE_PRIVACY_ENTRY_ROUTER_ADDRESS for the PrivacyEntryRouter path, or use another authorized contract.',
        { id: 'shield' }
      )
      return
    }

    setIsShielding(true)
    try {
      const contract = getTokenContract(signer)
      const amountWei = parseEther(shieldAmount)

      // Check balance
      const balance = await contract.balanceOf(address)
      if (balance < amountWei) {
        toast.error('Insufficient balance')
        return
      }

      if (!proverUrl?.trim()) {
        toast.error(
          'Shield requires a mint proof. Set VITE_PROVER_URL to your prover service (POST /mint/shield/prove) or use an authorized on-ramp contract.',
          { id: 'shield' }
        )
        return
      }

      recordShieldStarted()

      const depositNullifier = '0x' + Buffer.from(randomBytes(32)).toString('hex')
      toast.loading('Generating mint proof…', { id: 'shield' })
      const res = await fetch(`${proverUrl.replace(/\/+$/, '')}/mint/shield/prove`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          depositNullifier,
          depositor: address,
          amount: amountWei.toString(),
        }),
      })
      if (!res.ok) {
        const t = await res.text().catch(() => '')
        throw new Error(t || `Proof service error (${res.status})`)
      }
      const data = (await res.json()) as { proof?: string[]; publicInputs?: string[] }
      const proof = (data.proof ?? []).map((x) => BigInt(x))
      const publicInputs = (data.publicInputs ?? []).map((x) => BigInt(x))
      if (proof.length !== 8 || publicInputs.length !== 4) {
        throw new Error('Invalid proof response from prover (expected proof[8] and publicInputs[4])')
      }

      toast.loading('Submitting shield transaction...', { id: 'shield' })
      let tx
      const useGaslessRelay = preferGaslessPrivacyRelay() && Boolean(privacyRouterAddr)
      if (useGaslessRelay && privacyRouterAddr && provider) {
        const router = new Contract(privacyRouterAddr, ABIS.PrivacyEntryRouter, provider)
        const block = await provider.getBlock('latest')
        if (!block) throw new Error('Could not read latest block')
        const deadline = BigInt(block.timestamp) + 7200n
        const nonce = await router.nonces(address)
        toast.loading('Sign EIP-712 intent (gasless relayer)…', { id: 'shield' })
        const sig = await signShieldIntent(signer, privacyRouterAddr, publicInputs, nonce, deadline)
        await sleepPrivacyRelaySubmitJitter()
        toast.loading('Submitting via privacy relayer…', { id: 'shield' })
        const { txHash } = await postPrivacyRelay('/v1/relay-shield', {
          proof: proof.map(String),
          publicInputs: publicInputs.map(String),
          deadline: deadline.toString(),
          nonce: nonce.toString(),
          signature: sig,
        })
        tx = { hash: txHash, wait: async () => ({ hash: txHash }) }
      } else if (publicEntryOpen) {
        tx = await contract.shield(proof, publicInputs)
      } else {
        if (!privacyRouterAddr || !provider) throw new Error('Privacy router not configured')
        const router = new Contract(privacyRouterAddr, ABIS.PrivacyEntryRouter, signer)
        const feeWei = await router.relayFeeWei()
        const block = await provider.getBlock('latest')
        if (!block) throw new Error('Could not read latest block')
        const deadline = BigInt(block.timestamp) + 7200n
        const nonce = await router.nonces(address)
        toast.loading('Sign EIP-712 intent (Privacy entry router)…', { id: 'shield' })
        const sig = await signShieldIntent(signer, privacyRouterAddr, publicInputs, nonce, deadline)
        await sleepPrivacyRelaySubmitJitter()
        toast.loading('Submitting relayShield…', { id: 'shield' })
        tx = await router.relayShield(proof, publicInputs, deadline, nonce, sig, { value: feeWei })
      }
      toast.loading('Waiting for confirmation...', { id: 'shield' })
      
      // Wait and automatically parse events to save commitment
      await waitAndParseTransaction(tx, address, provider)

      recordShieldSucceeded()
      maybeSendPrivacyTelemetryBeacon()

      toast.success(`Shielded ${shieldAmount} AGS`, { id: 'shield' })
      setShieldAmount('')
      setShowShieldModal(false)
      setLocalStatsNonce((n) => n + 1)
    } catch (error) {
      console.error('shield failed', error)
      toast.error(formatContractErrorForToast(error, 'Shielding failed'), { id: 'shield' })
    } finally {
      setIsShielding(false)
    }
  }

  const handleUnshield = async () => {
    try {
      checkRateLimit('critical')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Rate limit exceeded')
      return
    }

    if (!signer || !address || !selectedCommitment || !unshieldAmount) {
      toast.error('Please select a commitment and enter amount')
      return
    }

    const amountValidation = validateAmount(unshieldAmount)
    if (!amountValidation.valid) {
      toast.error(amountValidation.error || 'Invalid amount')
      return
    }

    if (!publicEntryOpen && !privacyRouterAddr) {
      toast.error(
        'Direct shield / transparent exit is disabled on-chain. Set VITE_PRIVACY_ENTRY_ROUTER_ADDRESS for the PrivacyEntryRouter path, or use another authorized contract.',
        { id: 'transparent-exit' }
      )
      return
    }

    if (!proverUrl?.trim()) {
      toast.error(
        'Transparent exit needs `transfer-unshield` proofs. Set `VITE_PROVER_URL` (POST …/transfer/unshield/prove). The legacy client `transfer` circuit is not valid for on-chain `unshield`.',
        { id: 'transparent-exit' }
      )
      return
    }

    setIsUnshielding(true)
    try {
      const contract = getTokenContract(signer)
      const amountWei = parseEther(unshieldAmount)
      
      // Find the commitment record
      const userCommitments = getCommitments(address)
      const commitmentRecord = userCommitments.find(
        c => c.commitment.toLowerCase() === selectedCommitment.toLowerCase()
      )

      if (!commitmentRecord) {
        toast.error('Commitment not found')
        return
      }

      // Generate proof for transparent exit (on-chain `unshield`; prover path unchanged)
      // Public inputs: [nullifier, recipient, amount, commitment]
      const nullifierBytes = randomBytes(32)
      const nullifier = '0x' + Buffer.from(nullifierBytes).toString('hex')

      toast.loading('Generating transparent exit proof…', { id: 'transparent-exit' })

      const res = await fetch(`${proverUrl.replace(/\/+$/, '')}/transfer/unshield/prove`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nullifier,
          recipient: address,
          amount: amountWei.toString(),
          commitment: selectedCommitment,
        }),
      })
      if (!res.ok) throw new Error('Proof service error')
      const data = await res.json()
      const proof = (data.proof ?? []).map((x: string) => BigInt(x))
      const publicInputs = (data.publicInputs ?? []).map((x: string) => BigInt(x))

      recordUnshieldStarted()

      toast.loading('Submitting transparent exit…', { id: 'transparent-exit' })
      let tx
      const useGaslessRelay = preferGaslessPrivacyRelay() && Boolean(privacyRouterAddr)
      if (useGaslessRelay && privacyRouterAddr && provider) {
        const router = new Contract(privacyRouterAddr, ABIS.PrivacyEntryRouter, provider)
        const block = await provider.getBlock('latest')
        if (!block) throw new Error('Could not read latest block')
        const deadline = BigInt(block.timestamp) + 7200n
        const nonce = await router.nonces(address)
        toast.loading('Sign EIP-712 intent (gasless relayer)…', { id: 'transparent-exit' })
        const sig = await signTransparentExitIntent(signer, privacyRouterAddr, publicInputs, nonce, deadline)
        await sleepPrivacyRelaySubmitJitter()
        toast.loading('Submitting via privacy relayer…', { id: 'transparent-exit' })
        const { txHash } = await postPrivacyRelay('/v1/relay-transparent-exit', {
          proof: proof.map(String),
          publicInputs: publicInputs.map(String),
          deadline: deadline.toString(),
          nonce: nonce.toString(),
          signature: sig,
        })
        tx = { hash: txHash, wait: async () => ({ hash: txHash }) }
      } else if (publicEntryOpen) {
        tx = await contract.unshield(proof, publicInputs)
      } else {
        if (!privacyRouterAddr || !provider) throw new Error('Privacy router not configured')
        const router = new Contract(privacyRouterAddr, ABIS.PrivacyEntryRouter, signer)
        const feeWei = await router.relayFeeWei()
        const block = await provider.getBlock('latest')
        if (!block) throw new Error('Could not read latest block')
        const deadline = BigInt(block.timestamp) + 7200n
        const nonce = await router.nonces(address)
        toast.loading('Sign EIP-712 intent (Privacy entry router)…', { id: 'transparent-exit' })
        const sig = await signTransparentExitIntent(signer, privacyRouterAddr, publicInputs, nonce, deadline)
        await sleepPrivacyRelaySubmitJitter()
        toast.loading('Submitting relay (transparent exit)…', { id: 'transparent-exit' })
        tx = await router.relayUnshield(proof, publicInputs, deadline, nonce, sig, { value: feeWei })
      }
      toast.loading('Waiting for confirmation...', { id: 'transparent-exit' })
      
      // Wait and automatically parse events
      await waitAndParseTransaction(tx, address, provider)

      recordUnshieldSucceeded()
      maybeSendPrivacyTelemetryBeacon()

      toast.success(`Moved ${unshieldAmount} AGS to transparent balance`, { id: 'transparent-exit' })
      setUnshieldAmount('')
      setSelectedCommitment('')
      setShowUnshieldModal(false)
      setLocalStatsNonce((n) => n + 1)
    } catch (error) {
      console.error('transparent exit failed', error)
      toast.error(formatContractErrorForToast(error, 'Transparent exit failed'), { id: 'transparent-exit' })
    } finally {
      setIsUnshielding(false)
    }
  }

  if (!isConnected || !address) {
    return (
      <div className="card text-center py-12">
        <p className="text-terminal-text-dim">Please connect your wallet</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h1 className="text-3xl font-bold text-terminal-accent mb-2">Wallet</h1>
        <DaoModuleNotice>
          <p>
            <strong className="text-terminal-text">Maximum stealth (recommended):</strong> shield first — commitments are
            the primary Aegis privacy rail.
            <strong className="text-terminal-text"> Public AGS</strong> balances are normal ERC-20 reads — visible on Sonic
            explorers.             ZK proves only what the deployed verifier encodes; your RPC still sees that you sent a
            transaction. Each rail needs its own <code className="text-terminal-accent">VerifierFactory</code> type (
            <code className="text-terminal-accent">mint-optimized</code>, <code className="text-terminal-accent">transfer-unshield</code>, …); missing keys revert{' '}
            <code className="text-terminal-accent">InvalidVerifier</code> (see <code className="text-terminal-accent">Aegis-contracts/docs/CIRCUIT_TO_CONTRACT_MAP.md</code>).
          </p>
          <p className="mt-2 text-xs text-terminal-text-dim">
            Whether EOAs may call <code className="text-terminal-accent">shield</code> or the on-chain{' '}
            <code className="text-terminal-accent">unshield</code> (transparent exit) entrypoint directly is governed by{' '}
            <code className="text-terminal-accent">publicEntryEnabled</code> on the token contract (timelock / DAO). See
            repo <code className="text-terminal-accent">docs/ZK_DAO_GOVERNANCE_LESSONS.md</code> and the phased program in{' '}
            <code className="text-terminal-accent">docs/AEGIS_HIDDEN_FORT_EXECUTION_PLAN.md</code>.
          </p>
        </DaoModuleNotice>
      </div>

      <CommitmentLocalStorageWarning walletAddress={address} variant="wallet" />

      <CommitmentVaultControls walletAddress={address} />

      {!publicEntryOpen && privacyRouterAddr && (
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
          <strong className="text-terminal-text">Privacy entry router is configured.</strong> When{' '}
          <code className="text-terminal-accent">publicEntryEnabled</code> is false, this app submits{' '}
          <code className="text-terminal-accent">relayShield</code> /{' '}
          <code className="text-terminal-accent">relayUnshield</code> (transparent exit){' '}
          on <code className="text-terminal-accent">{formatAddress(privacyRouterAddr)}</code> with your EIP-712 signature
          (and optional native relay fee from the router). Inclusion and gas payer remain visible on-chain — see{' '}
          <code className="text-terminal-accent">docs/AEGIS_HIDDEN_FORT_EXECUTION_PLAN.md</code>.
        </div>
      )}

      {!publicEntryOpen && !privacyRouterAddr && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          <strong className="text-terminal-text">Governance has restricted direct privacy entry.</strong> EOAs cannot
          call <code className="text-terminal-accent">shield</code> or transparent exit (<code className="text-terminal-accent">unshield</code>) until{' '}
          <code className="text-terminal-accent">publicEntryEnabled</code> is true again or you interact through an authorized protocol contract.
        </div>
      )}

      {showLocalPrivacyStats && localPrivacySnapshot && (
        <div
          className="card border border-terminal-muted/80 text-sm text-terminal-text-dim space-y-2"
        >
          <h3 className="text-sm font-semibold text-terminal-text">Privacy flow stats (this browser only)</h3>
          <p>{formatLocalPrivacySummaryLine(localPrivacySnapshot)}</p>
          <p className="text-xs">
            Stored locally in your browser — not a global DAO metric. Operators: see{' '}
            <code className="text-terminal-accent">docs/ops/PRIVACY_METRICS_OPERATOR_RUNBOOK.md</code> and{' '}
            <code className="text-terminal-accent">docs/ops/PRIVACY_METRICS_PRODUCT_AND_LEGAL.md</code>.
          </p>
          {privacyTelemetryEndpoint ? (
            <label className="flex items-start gap-2 cursor-pointer text-terminal-text">
              <input
                type="checkbox"
                className="mt-1"
                checked={telemetryOptInUi}
                onChange={(e) => {
                  const on = e.target.checked
                  setTelemetryOptIn(on)
                  setTelemetryOptInUi(on)
                }}
              />
              <span>
                Send <strong>anonymous aggregate counts</strong> (integers only, no wallet address) to the DAO
                telemetry endpoint configured at build time. At most once per tab session. Counsel should review{' '}
                <code className="text-terminal-accent">docs/ops/PRIVACY_METRICS_PRODUCT_AND_LEGAL.md</code> before
                production.
              </span>
            </label>
          ) : null}
          <div>
            <button
              type="button"
              className="btn-secondary text-xs"
              onClick={() => {
                resetLocalPrivacyMetrics()
                setLocalStatsNonce((n) => n + 1)
              }}
            >
              Reset local counts
            </button>
          </div>
        </div>
      )}

      <div className="card">
        <div className="text-sm text-terminal-text-dim mb-1">Address</div>
        <div className="font-mono text-lg text-terminal-text">{address}</div>
      </div>

      {/* ZK rail — primary */}
      <div className="card border border-terminal-accent/30 bg-terminal-accent/5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="text-xl font-semibold text-terminal-accent">Shielded commitments (Maximum stealth — recommended)</h2>
            <p className="text-sm text-terminal-text-dim mt-1">
              Prefer holding and moving value in shielded commitments; use a transparent exit only when you need public rails (e.g. legacy DEX liquidity).
            </p>
          </div>
          <button className="btn-secondary text-sm" onClick={() => setShowCommitmentsModal(true)}>
            View all ({commitments?.length || 0})
          </button>
        </div>
        {commitments && commitments.length > 0 ? (
          <div className="space-y-2 mb-4">
            {commitments.slice(0, 5).map((commitment, index) => (
              <div key={index} className="bg-terminal-muted/30 rounded p-3 font-mono text-xs">
                <div className="text-terminal-text-dim">Commitment:</div>
                <div className="text-terminal-text">{formatAddress(commitment.commitment)}</div>
                <div className="text-terminal-text-dim mt-1">
                  {commitment.contractType} • {commitment.action}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-terminal-text-dim mb-4">No shielded commitments yet — shield public AGS to create one.</p>
        )}
        <h3 className="text-sm font-semibold text-terminal-text mb-3">Actions</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <button
            className="btn-primary"
            onClick={() => setShowShieldModal(true)}
            disabled={isShielding || !canShield}
            title={
              !canShield
                ? !proverUrl
                  ? 'Set VITE_PROVER_URL for mint proofs'
                  : 'publicEntryEnabled is false and no privacy router in env'
                : undefined
            }
          >
            {isShielding ? 'Shielding...' : 'Shield tokens'}
          </button>
          <button className="btn-secondary" onClick={() => setShowCommitmentsModal(true)}>
            View commitments
          </button>
          <button
            className="btn-secondary"
            onClick={() => setShowUnshieldModal(true)}
            disabled={isUnshielding || !commitments || commitments.length === 0 || !canUnshieldEntry}
            title={
              !canUnshieldEntry
                ? !proverUrl?.trim()
                  ? 'Set VITE_PROVER_URL for transfer-unshield proofs (transparent exit)'
                  : 'publicEntryEnabled is false and no privacy router in env'
                : undefined
            }
          >
            {isUnshielding ? 'Working…' : 'Transparent exit (legacy)'}
          </button>
          <button className="btn-secondary" disabled title="Governance prioritizes proof-backed transfers in milestones">
            Private transfer (roadmap)
          </button>
        </div>
      </div>

      <SonicGatewayConverter compact useChainPackList />

      <StealthReceivePanel />

      {/* Public balances — secondary */}
      <div>
        <h2 className="text-lg font-semibold text-terminal-text mb-2">Public balances (Transparent — compatibility / legacy)</h2>
        <p className="text-sm text-terminal-text-dim mb-3 max-w-2xl">
          Use these for gas and for compatibility with public liquidity. They are not the confidentiality layer.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="card">
            <div className="text-sm text-terminal-text-dim mb-1">Native (gas)</div>
            <div className="text-2xl font-bold text-terminal-text">{formatBalance(balance || 0n)} S</div>
          </div>
          <div className="card">
            <div className="text-sm text-terminal-text-dim mb-1">Public AGS (transparent balance)</div>
            <div className="text-2xl font-bold text-terminal-accent">{formatBalance(tokenBalance || 0n)} AGS</div>
          </div>
        </div>
      </div>

      {/* Shield Modal */}
      {showShieldModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
          <div className="card max-w-md w-full mx-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold">Shield Tokens</h2>
              <button
                className="text-terminal-text-dim hover:text-terminal-text"
                onClick={() => setShowShieldModal(false)}
              >
                ✕
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-terminal-text mb-2">
                  Amount (AGS)
                </label>
                <input
                  type="number"
                  step="0.001"
                  min="0"
                  value={shieldAmount}
                  onChange={(e) => setShieldAmount(e.target.value)}
                  className="input-field w-full"
                  placeholder="0.0"
                />
                <p className="text-xs text-terminal-text-dim mt-1">
                  Balance: {formatBalance(tokenBalance || 0n)} AGS
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  className="btn-primary flex-1"
                  onClick={handleShield}
                  disabled={isShielding || !shieldAmount || parseFloat(shieldAmount) <= 0}
                >
                  {isShielding ? 'Shielding...' : 'Shield'}
                </button>
                <button
                  className="btn-secondary"
                  onClick={() => setShowShieldModal(false)}
                  disabled={isShielding}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Transparent exit modal (on-chain `unshield`) */}
      {showUnshieldModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
          <div className="card max-w-md w-full mx-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold">Transparent exit</h2>
              <button
                className="text-terminal-text-dim hover:text-terminal-text"
                onClick={() => setShowUnshieldModal(false)}
              >
                ✕
              </button>
            </div>
            <div className="space-y-4">
              <p className="text-sm text-terminal-text-dim">
                Moves AGS from a shielded commitment to your <strong>public</strong> ERC-20 balance (explorers can read
                it). Prefer staying shielded unless you need a public leg.
              </p>
              <div>
                <label className="block text-sm font-medium text-terminal-text mb-2">
                  Select Commitment
                </label>
                <select
                  value={selectedCommitment}
                  onChange={(e) => setSelectedCommitment(e.target.value)}
                  className="input-field w-full"
                >
                  <option value="">Select a commitment...</option>
                  {commitments?.map((commitment, index) => (
                    <option key={index} value={commitment.commitment}>
                      {formatAddress(commitment.commitment)} - {commitment.contractType}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-terminal-text mb-2">
                  Amount (AGS)
                </label>
                <input
                  type="number"
                  step="0.001"
                  min="0"
                  value={unshieldAmount}
                  onChange={(e) => setUnshieldAmount(e.target.value)}
                  className="input-field w-full"
                  placeholder="0.0"
                />
              </div>
              <div className="flex gap-2">
                <button
                  className="btn-primary flex-1"
                  onClick={handleUnshield}
                  disabled={isUnshielding || !selectedCommitment || !unshieldAmount || parseFloat(unshieldAmount) <= 0}
                >
                  {isUnshielding ? 'Submitting…' : 'Confirm exit'}
                </button>
                <button
                  className="btn-secondary"
                  onClick={() => setShowUnshieldModal(false)}
                  disabled={isUnshielding}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Commitments Modal */}
      {showCommitmentsModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
          <div className="card max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold">All Commitments</h2>
              <button
                className="text-terminal-text-dim hover:text-terminal-text"
                onClick={() => setShowCommitmentsModal(false)}
              >
                ✕
              </button>
            </div>
            {commitments && commitments.length > 0 ? (
              <div className="space-y-2">
                {commitments.map((commitment, index) => (
                  <div
                    key={index}
                    className="bg-terminal-muted/30 rounded p-4 font-mono text-xs"
                  >
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      <div>
                        <div className="text-terminal-text-dim">Commitment:</div>
                        <div className="text-terminal-text break-all">{commitment.commitment}</div>
                      </div>
                      <div>
                        <div className="text-terminal-text-dim">Type:</div>
                        <div className="text-terminal-text">{commitment.contractType} • {commitment.action}</div>
                      </div>
                      {commitment.nullifier && (
                        <div>
                          <div className="text-terminal-text-dim">Nullifier:</div>
                          <div className="text-terminal-text break-all">{commitment.nullifier}</div>
                        </div>
                      )}
                      {commitment.amount && commitment.amount !== '0' && (
                        <div>
                          <div className="text-terminal-text-dim">Amount:</div>
                          <div className="text-terminal-text">{formatBalance(BigInt(commitment.amount))} AGS</div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-terminal-text-dim text-center py-8">No commitments found</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
