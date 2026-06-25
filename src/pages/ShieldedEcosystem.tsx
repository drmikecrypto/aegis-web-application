import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { parseEther, formatUnits } from 'ethers'
import { useWalletStore } from '@/store/walletStore'
import { CONTRACT_ADDRESSES, ZERO_ADDRESS } from '@/config/contracts'
import {
  getPrivacySavingsVaultContract,
  getAnonymousPayrollContract,
  getPrivatePredictionMarketContract,
  getRelayerMarketplaceContract,
  getSelectiveDisclosureHubContract,
  getShieldedYieldVaultContract,
  getShieldedIncentiveClaimsContract,
  getTokenContract,
} from '@/utils/contracts'
import { proveSelectiveDisclosure } from '@/utils/prover'
import { validateAmount, isValidHex, checkRateLimit } from '@/utils/security'
import { waitAndParseTransaction } from '@/utils/transactionHelper'
import DaoModuleNotice from '@/components/DaoModuleNotice'
import ZkModeToggle, { type ZkPrivacyMode } from '@/components/ZkModeToggle'
import StealthReceivePanel from '@/components/StealthReceivePanel'

type Tab =
  | 'stealth'
  | 'savings'
  | 'yield'
  | 'incentives'
  | 'payroll'
  | 'prediction'
  | 'stable'
  | 'credit'
  | 'bonds'
  | 'disclosure'
  | 'relayer'

const TABS: { id: Tab; label: string }[] = [
  { id: 'stealth', label: 'Stealth receive' },
  { id: 'savings', label: 'Savings' },
  { id: 'yield', label: 'Yield vault' },
  { id: 'incentives', label: 'Incentive claims' },
  { id: 'payroll', label: 'Payroll' },
  { id: 'prediction', label: 'Prediction' },
  { id: 'stable', label: 'Stable vault' },
  { id: 'credit', label: 'Credit profile' },
  { id: 'bonds', label: 'Private bonds' },
  { id: 'disclosure', label: 'Selective disclosure' },
  { id: 'relayer', label: 'Relayer market' },
]

function parseBytes32(raw: string): `0x${string}` | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const body = trimmed.startsWith('0x') ? trimmed.slice(2) : trimmed
  if (!isValidHex(body, 32)) return null
  return (`0x${body.padStart(64, '0')}`) as `0x${string}`
}

function ConfigBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`text-xs px-2 py-0.5 rounded border ${
        ok
          ? 'border-terminal-accent/40 text-terminal-accent'
          : 'border-amber-500/40 text-amber-700'
      }`}
    >
      {ok ? label : `${label} — not configured`}
    </span>
  )
}

export default function ShieldedEcosystem() {
  const [tab, setTab] = useState<Tab>('stealth')
  const [mode, setMode] = useState<ZkPrivacyMode>('zk')

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h1 className="text-3xl font-bold text-terminal-accent">Shielded ecosystem</h1>
        <p className="text-terminal-text-dim max-w-3xl">
          Selective-privacy financial modules for{' '}
          <a
            href="https://docs.soniclabs.com/"
            target="_blank"
            rel="noreferrer"
            className="text-terminal-accent underline-offset-2 hover:underline"
          >
            Sonic
          </a>{' '}
          — savings, payroll, prediction markets, credit reputation, and unified relayer rails. ZK paths prove only what
          each verifier encodes; explorers still see that a transaction occurred.
        </p>
        <DaoModuleNotice>
          <p>
            Ecosystem contracts in <code>contracts/ecosystem/</code> are local scaffolds. Fund flows, maturity rules, and
            oracle assumptions must be read from bytecode before sizing positions. Selective disclosure is explicit —
            nothing here promises law-enforcement opacity.
          </p>
        </DaoModuleNotice>
      </div>

      <ZkModeToggle mode={mode} onChange={setMode} />

      <div className="flex flex-wrap gap-2 border-b border-terminal-border pb-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-3 py-1.5 text-sm rounded-t transition-colors ${
              tab === t.id
                ? 'text-terminal-accent border-b-2 border-terminal-accent font-medium'
                : 'text-terminal-text-dim hover:text-terminal-text'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'stealth' && <StealthReceivePanel />}
      {tab === 'savings' && <SavingsPanel mode={mode} />}
      {tab === 'yield' && <YieldVaultPanel mode={mode} />}
      {tab === 'incentives' && <IncentiveClaimsPanel mode={mode} />}
      {tab === 'payroll' && <PayrollPanel mode={mode} />}
      {tab === 'prediction' && <PredictionPanel />}
      {tab === 'stable' && <StablePanel mode={mode} />}
      {tab === 'credit' && <CreditPanel mode={mode} />}
      {tab === 'bonds' && <BondsPanel mode={mode} />}
      {tab === 'disclosure' && <DisclosurePanel mode={mode} />}
      {tab === 'relayer' && <RelayerPanel />}
    </div>
  )
}

function SavingsPanel({ mode }: { mode: 'legacy' | 'zk' }) {
  const { signer, address, provider } = useWalletStore()
  const [commitment, setCommitment] = useState('')
  const [lockDays, setLockDays] = useState('30')
  const [busy, setBusy] = useState(false)
  const vault = CONTRACT_ADDRESSES.PRIVACY_SAVINGS_VAULT
  const configured = Boolean(vault && vault !== ZERO_ADDRESS)

  const handleOpen = async () => {
    try {
      checkRateLimit('critical')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Rate limit')
      return
    }
    if (!signer || !address) return toast.error('Connect wallet')
    const c = parseBytes32(commitment)
    if (!c) return toast.error('Commitment must be 32-byte hex')
    const days = parseInt(lockDays, 10)
    if (!Number.isFinite(days) || days <= 0) return toast.error('Invalid lock duration')
    const contract = getPrivacySavingsVaultContract(signer)
    if (!contract) return toast.error('PrivacySavingsVault not configured')
    setBusy(true)
    try {
      const lockDuration = BigInt(days) * 86400n
      toast.loading('Opening savings…', { id: 'savings' })
      const tx = await contract.openSavings(c, lockDuration)
      await waitAndParseTransaction(tx, address, provider)
      toast.success('Savings deposit opened', { id: 'savings' })
      setCommitment('')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed', { id: 'savings' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card max-w-lg space-y-4">
      <ConfigBadge ok={configured} label="PrivacySavingsVault" />
      <p className="text-sm text-terminal-text-dim">
        Lock a shielded commitment until maturity; withdraw with a <code>savings</code> ZK proof and nullifier.
      </p>
      <div>
        <label className="block text-sm text-terminal-text-dim mb-1">Commitment hash</label>
        <input
          className="input-field w-full font-mono text-xs"
          value={commitment}
          onChange={(e) => setCommitment(e.target.value)}
          placeholder="0x…"
          disabled={busy}
        />
      </div>
      <div>
        <label className="block text-sm text-terminal-text-dim mb-1">Lock (days)</label>
        <input
          type="number"
          min={1}
          className="input-field w-full"
          value={lockDays}
          onChange={(e) => setLockDays(e.target.value)}
          disabled={busy}
        />
      </div>
      <button
        type="button"
        className="btn-primary"
        disabled={!configured || busy || mode === 'legacy'}
        onClick={() => void handleOpen()}
      >
        {busy ? 'Submitting…' : mode === 'zk' ? 'Open shielded savings' : 'ZK-only module'}
      </button>
    </div>
  )
}

function YieldVaultPanel({ mode }: { mode: 'legacy' | 'zk' }) {
  const { signer, address, provider } = useWalletStore()
  const [commitment, setCommitment] = useState('')
  const [lockDays, setLockDays] = useState('30')
  const [busy, setBusy] = useState(false)
  const configured =
    CONTRACT_ADDRESSES.SHIELDED_YIELD_VAULT && CONTRACT_ADDRESSES.SHIELDED_YIELD_VAULT !== ZERO_ADDRESS

  const handleOpen = async () => {
    try {
      checkRateLimit('critical')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Rate limit')
      return
    }
    if (!signer || !address) return toast.error('Connect wallet')
    const c = parseBytes32(commitment)
    if (!c) return toast.error('Commitment must be 32-byte hex')
    const days = parseInt(lockDays, 10)
    if (!Number.isFinite(days) || days <= 0) return toast.error('Invalid lock duration')
    const vault = getShieldedYieldVaultContract(signer)
    if (!vault) return toast.error('ShieldedYieldVault not configured')
    setBusy(true)
    try {
      const lockDuration = BigInt(days) * 86400n
      toast.loading('Opening locked yield…', { id: 'yield' })
      const tx = await vault.openLockedYield(c, lockDuration)
      await waitAndParseTransaction(tx, address, provider)
      toast.success('Locked yield opened (savings + farming rail)', { id: 'yield' })
      setCommitment('')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed', { id: 'yield' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card max-w-lg space-y-4">
      <ConfigBadge ok={Boolean(configured)} label="ShieldedYieldVault" />
      <p className="text-sm text-terminal-text-dim">
        Unified term lock via <code>PrivacySavingsVault</code> plus optional <code>farming</code> circuit stake records
        on the same rail.
      </p>
      <div>
        <label className="block text-sm text-terminal-text-dim mb-1">Commitment hash</label>
        <input
          className="input-field w-full font-mono text-xs"
          value={commitment}
          onChange={(e) => setCommitment(e.target.value)}
          placeholder="0x…"
          disabled={busy}
        />
      </div>
      <div>
        <label className="block text-sm text-terminal-text-dim mb-1">Lock (days)</label>
        <input
          type="number"
          min={1}
          className="input-field w-full"
          value={lockDays}
          onChange={(e) => setLockDays(e.target.value)}
          disabled={busy}
        />
      </div>
      <button
        type="button"
        className="btn-primary"
        disabled={!configured || busy || mode === 'legacy'}
        onClick={() => void handleOpen()}
      >
        {busy ? 'Submitting…' : mode === 'zk' ? 'Open locked yield' : 'ZK-only module'}
      </button>
    </div>
  )
}

function IncentiveClaimsPanel({ mode }: { mode: 'legacy' | 'zk' }) {
  const { provider } = useWalletStore()
  const configured =
    CONTRACT_ADDRESSES.SHIELDED_INCENTIVE_CLAIMS &&
    CONTRACT_ADDRESSES.SHIELDED_INCENTIVE_CLAIMS !== ZERO_ADDRESS

  const { data: gaugeAddr } = useQuery({
    queryKey: ['shielded-incentive-gauge'],
    queryFn: async () => {
      const c = getShieldedIncentiveClaimsContract(provider!)
      if (!c) return null
      const addr = (await c.liquidityMiningGauge()) as string
      return addr === ZERO_ADDRESS ? null : addr
    },
    enabled: Boolean(provider && configured),
  })

  return (
    <div className="card max-w-lg space-y-3">
      <ConfigBadge ok={Boolean(configured)} label="ShieldedIncentiveClaims" />
      <p className="text-sm text-terminal-text-dim">
        Route <code>LiquidityMiningGauge</code> rewards and <code>TreasuryBondAuction</code> redemptions into shielded
        commitments via <code>farming</code> / <code>private-bond</code> proofs. Claim transparent legs on the public
        contracts first, then verify here.
      </p>
      {gaugeAddr ? (
        <p className="text-xs font-mono text-terminal-text-dim">
          Gauge wired: {gaugeAddr.slice(0, 10)}…{gaugeAddr.slice(-8)}
        </p>
      ) : null}
      {mode === 'legacy' ? (
        <p className="text-xs text-amber-700">Incentive shielding is ZK-only; use Private (ZK) mode.</p>
      ) : null}
    </div>
  )
}

function PayrollPanel({ mode }: { mode: 'legacy' | 'zk' }) {
  const { signer, address, provider } = useWalletStore()
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const configured =
    CONTRACT_ADDRESSES.ANONYMOUS_PAYROLL && CONTRACT_ADDRESSES.ANONYMOUS_PAYROLL !== ZERO_ADDRESS

  const { data: balance } = useQuery({
    queryKey: ['payroll-balance', address],
    queryFn: async () => {
      if (!provider || !address) return 0n
      const c = getAnonymousPayrollContract(provider)
      if (!c) return 0n
      return (await c.employerBalances(address)) as bigint
    },
    enabled: Boolean(provider && address && configured),
  })

  const handleFund = async () => {
    try {
      checkRateLimit('critical')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Rate limit')
      return
    }
    if (!signer || !address) return toast.error('Connect wallet')
    const v = validateAmount(amount)
    if (!v.valid) return toast.error(v.error || 'Invalid amount')
    const payroll = getAnonymousPayrollContract(signer)
    const token = getTokenContract(signer)
    if (!payroll) return toast.error('AnonymousPayroll not configured')
    setBusy(true)
    try {
      const wei = parseEther(amount)
      toast.loading('Approving AGS…', { id: 'payroll' })
      const approveTx = await token.approve(await payroll.getAddress(), wei)
      await approveTx.wait()
      toast.loading('Funding payroll…', { id: 'payroll' })
      const tx = await payroll.fundPayroll(wei)
      await waitAndParseTransaction(tx, address, provider)
      toast.success('Payroll funded', { id: 'payroll' })
      setAmount('')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed', { id: 'payroll' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card max-w-lg space-y-4">
      <ConfigBadge ok={Boolean(configured)} label="AnonymousPayroll" />
      <p className="text-sm text-terminal-text-dim">
        Employers fund the vault; employees claim with <code>payroll</code> ZK proofs (employer hash + period nullifier).
      </p>
      {balance != null ? (
        <p className="text-sm">
          Your payroll balance: <strong>{formatUnits(balance, 18)} AGS</strong>
        </p>
      ) : null}
      <div>
        <label className="block text-sm text-terminal-text-dim mb-1">Fund amount (AGS)</label>
        <input
          type="number"
          step="0.001"
          min={0}
          className="input-field w-full"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          disabled={busy}
        />
      </div>
      <button
        type="button"
        className="btn-primary"
        disabled={!configured || busy || mode === 'legacy'}
        onClick={() => void handleFund()}
      >
        {busy ? 'Funding…' : mode === 'zk' ? 'Fund payroll vault' : 'ZK payroll path'}
      </button>
    </div>
  )
}

function PredictionPanel() {
  const { provider } = useWalletStore()
  const configured =
    CONTRACT_ADDRESSES.PRIVATE_PREDICTION_MARKET &&
    CONTRACT_ADDRESSES.PRIVATE_PREDICTION_MARKET !== ZERO_ADDRESS

  const { data: marketCount } = useQuery({
    queryKey: ['prediction-market-count'],
    queryFn: async () => {
      const c = getPrivatePredictionMarketContract(provider!)
      if (!c) return 0
      return Number(await c.nextMarketId())
    },
    enabled: Boolean(provider && configured),
  })

  return (
    <div className="card max-w-lg space-y-3">
      <ConfigBadge ok={Boolean(configured)} label="PrivatePredictionMarket" />
      <p className="text-sm text-terminal-text-dim">
        Governance creates markets; traders open shielded positions via <code>prediction-market</code> proofs. Vote
        amounts stay off the public graph until settlement.
      </p>
      {marketCount != null ? (
        <p className="text-sm">
          Markets created: <strong>{marketCount}</strong>
        </p>
      ) : null}
      <p className="text-xs text-terminal-text-dim">
        Open / settle positions require local circuit artifacts or <code>VITE_PROVER_URL</code> — use Governance to
        create markets on a local Sonic fork.
      </p>
    </div>
  )
}

function StablePanel({ mode }: { mode: 'legacy' | 'zk' }) {
  const configured =
    CONTRACT_ADDRESSES.PRIVATE_STABLE_VAULT && CONTRACT_ADDRESSES.PRIVATE_STABLE_VAULT !== ZERO_ADDRESS
  return (
    <div className="card max-w-lg space-y-3">
      <ConfigBadge ok={Boolean(configured)} label="PrivateStableVault" />
      <p className="text-sm text-terminal-text-dim">
        Shielded stable-asset positions — mint / redeem via <code>private-stable</code> circuit when{' '}
        {mode === 'zk' ? 'ZK mode is active' : 'you switch to ZK mode'}.
      </p>
    </div>
  )
}

function CreditPanel({ mode }: { mode: 'legacy' | 'zk' }) {
  const configured =
    CONTRACT_ADDRESSES.PRIVATE_CREDIT_PROFILE && CONTRACT_ADDRESSES.PRIVATE_CREDIT_PROFILE !== ZERO_ADDRESS
  return (
    <div className="card max-w-lg space-y-3">
      <ConfigBadge ok={Boolean(configured)} label="PrivateCreditProfile" />
      <p className="text-sm text-terminal-text-dim">
        Anonymous credit scores for private lending — lenders verify <code>credit-profile</code> proofs without learning
        wallet identity. {mode === 'zk' ? 'ZK path is the default here.' : 'Switch to ZK for proof-gated rates.'}
      </p>
    </div>
  )
}

function BondsPanel({ mode }: { mode: 'legacy' | 'zk' }) {
  const configured =
    CONTRACT_ADDRESSES.PRIVATE_BOND_MARKET && CONTRACT_ADDRESSES.PRIVATE_BOND_MARKET !== ZERO_ADDRESS
  return (
    <div className="card max-w-lg space-y-3">
      <ConfigBadge ok={Boolean(configured)} label="PrivateBondMarket" />
      <p className="text-sm text-terminal-text-dim">
        Private bond issuance and settlement via <code>private-bond</code> circuit — complements public{' '}
        <code>TreasuryBondAuction</code> with shielded holder graph.
      </p>
      {mode === 'legacy' ? (
        <p className="text-xs text-amber-700">Bond market is ZK-only; use Private (ZK) mode.</p>
      ) : null}
    </div>
  )
}

function DisclosurePanel({ mode }: { mode: 'legacy' | 'zk' }) {
  const { signer, address, provider } = useWalletStore()
  const [kind, setKind] = useState('0')
  const [nullifier, setNullifier] = useState('')
  const [subjectCommitment, setSubjectCommitment] = useState('')
  const [threshold, setThreshold] = useState('')
  const [merkleRoot, setMerkleRoot] = useState('')
  const [busy, setBusy] = useState(false)
  const configured =
    CONTRACT_ADDRESSES.SELECTIVE_DISCLOSURE_HUB &&
    CONTRACT_ADDRESSES.SELECTIVE_DISCLOSURE_HUB !== ZERO_ADDRESS

  const handleVerify = async () => {
    if (mode !== 'zk') {
      toast.error('Switch to Private (ZK) mode for selective disclosure')
      return
    }
    if (!signer || !address) return toast.error('Connect wallet')
    const n = parseBytes32(nullifier)
    const s = parseBytes32(subjectCommitment)
    const root = parseBytes32(merkleRoot)
    if (!n || !s || !root) return toast.error('Nullifier, commitment, and merkle root must be 32-byte hex')
    const hub = getSelectiveDisclosureHubContract(signer)
    if (!hub) return toast.error('SelectiveDisclosureHub not configured')
    setBusy(true)
    try {
      const kindNum = parseInt(kind, 10)
      const thresholdWei = BigInt(threshold || '0')
      toast.loading('Generating disclosure proof…', { id: 'disclosure' })
      const { proof, publicInputs } = await proveSelectiveDisclosure({
        nullifierHash: n,
        kind: kindNum.toString(),
        subjectCommitment: s,
        threshold: thresholdWei.toString(),
        merkleRoot: root,
      })
      toast.loading('Submitting disclosure…', { id: 'disclosure' })
      const tx = await hub.verifyDisclosure(kindNum, proof, publicInputs)
      await waitAndParseTransaction(tx, address, provider)
      toast.success('Disclosure verified on-chain', { id: 'disclosure' })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Disclosure failed', { id: 'disclosure' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card max-w-lg space-y-4">
      <ConfigBadge ok={Boolean(configured)} label="SelectiveDisclosureHub" />
      <p className="text-sm text-terminal-text-dim">
        User-controlled attestations — prove chosen fields to auditors without revealing full balances. Explicit
        consent per disclosure kind.
      </p>
      <div>
        <label className="block text-sm text-terminal-text-dim mb-1">Disclosure kind</label>
        <select className="input-field w-full" value={kind} onChange={(e) => setKind(e.target.value)} disabled={busy}>
          <option value="0">Net worth band</option>
          <option value="1">Age threshold</option>
          <option value="2">Ownership</option>
          <option value="3">Repayment history</option>
        </select>
      </div>
      <div>
        <label className="block text-sm text-terminal-text-dim mb-1">Nullifier hash</label>
        <input className="input-field w-full font-mono text-xs" value={nullifier} onChange={(e) => setNullifier(e.target.value)} disabled={busy} />
      </div>
      <div>
        <label className="block text-sm text-terminal-text-dim mb-1">Subject commitment</label>
        <input className="input-field w-full font-mono text-xs" value={subjectCommitment} onChange={(e) => setSubjectCommitment(e.target.value)} disabled={busy} />
      </div>
      <div>
        <label className="block text-sm text-terminal-text-dim mb-1">Threshold / band (wei)</label>
        <input className="input-field w-full" value={threshold} onChange={(e) => setThreshold(e.target.value)} disabled={busy} />
      </div>
      <div>
        <label className="block text-sm text-terminal-text-dim mb-1">Merkle root</label>
        <input className="input-field w-full font-mono text-xs" value={merkleRoot} onChange={(e) => setMerkleRoot(e.target.value)} disabled={busy} />
      </div>
      <button type="button" className="btn-primary" disabled={!configured || busy} onClick={() => void handleVerify()}>
        {busy ? 'Verifying…' : 'Verify selective disclosure'}
      </button>
    </div>
  )
}

function RelayerPanel() {
  const { signer, address, provider } = useWalletStore()
  const [stakeAmount, setStakeAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const configured =
    CONTRACT_ADDRESSES.RELAYER_MARKETPLACE && CONTRACT_ADDRESSES.RELAYER_MARKETPLACE !== ZERO_ADDRESS

  const handleRegister = async () => {
    try {
      checkRateLimit('critical')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Rate limit')
      return
    }
    if (!signer || !address) return toast.error('Connect wallet')
    const v = validateAmount(stakeAmount)
    if (!v.valid) return toast.error(v.error || 'Invalid stake')
    const market = getRelayerMarketplaceContract(signer)
    const token = getTokenContract(signer)
    if (!market) return toast.error('RelayerMarketplace not configured')
    setBusy(true)
    try {
      const wei = parseEther(stakeAmount)
      toast.loading('Approving stake…', { id: 'relayer' })
      const approveTx = await token.approve(await market.getAddress(), wei)
      await approveTx.wait()
      toast.loading('Registering relayer…', { id: 'relayer' })
      const tx = await market.register(wei)
      await waitAndParseTransaction(tx, address, provider)
      toast.success('Relayer registered', { id: 'relayer' })
      setStakeAmount('')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed', { id: 'relayer' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card max-w-lg space-y-4">
      <ConfigBadge ok={Boolean(configured)} label="RelayerMarketplace" />
      <p className="text-sm text-terminal-text-dim">
        Stake AGS to operate gasless <code>PrivacyEntryRouter</code> relays on Sonic — 90% fee monetization flows to
        app developers per Sonic docs; relayer economics are separate from protocol treasury.
      </p>
      <div>
        <label className="block text-sm text-terminal-text-dim mb-1">Stake (AGS)</label>
        <input
          type="number"
          step="0.001"
          min={0}
          className="input-field w-full"
          value={stakeAmount}
          onChange={(e) => setStakeAmount(e.target.value)}
          disabled={busy}
        />
      </div>
      <button type="button" className="btn-primary" disabled={!configured || busy} onClick={() => void handleRegister()}>
        {busy ? 'Registering…' : 'Register as relayer'}
      </button>
    </div>
  )
}
