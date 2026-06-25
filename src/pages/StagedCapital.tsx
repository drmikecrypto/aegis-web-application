import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Contract, ethers, getAddress } from 'ethers'
import toast from 'react-hot-toast'

import DaoModuleNotice from '@/components/DaoModuleNotice'
import { CONTRACT_ADDRESSES, DEFAULT_NETWORK, RPC_CONFIG, ZERO_ADDRESS } from '@/config/contracts'
import { useWalletStore } from '@/store/walletStore'
import {
  getDefaultReadProvider,
  getStagedCapitalVaultAt,
} from '@/utils/contracts'
import { formatAddress } from '@/utils/format'
import { isValidAddress } from '@/utils/security'
import { stagedCapitalInvestorLeaf } from '@/utils/stagedCapitalMerkle'
import { stagedCapitalTypedDomain, STAGED_CAPITAL_EIP712_TYPES } from '@/utils/stagedCapitalEip712'
import { waitAndParseTransaction } from '@/utils/transactionHelper'

const ROUND_STATUS = ['Funding', 'Failed', 'Active', 'Completed'] as const

const ERC20_MIN = [
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
] as const

type RoundView = {
  founder: string
  token: string
  hardCap: bigint
  minRaise: bigint
  startTime: bigint
  endTime: bigint
  totalRaised: bigint
  status: number
  milestoneCount: number
  committeeThreshold: number
  nextMilestone: number
  releaseBps: readonly bigint[]
  investorMerkleRoot: string
}

function parseRound(raw: unknown): RoundView {
  const r = raw as Record<string, unknown>
  const bpsRaw = r.releaseBps
  const releaseBps = Array.isArray(bpsRaw)
    ? (bpsRaw as unknown[]).map((x) => BigInt(String(x)))
    : []
  return {
    founder: String(r.founder),
    token: String(r.token),
    hardCap: BigInt(String(r.hardCap)),
    minRaise: BigInt(String(r.minRaise)),
    startTime: BigInt(String(r.startTime)),
    endTime: BigInt(String(r.endTime)),
    totalRaised: BigInt(String(r.totalRaised)),
    status: Number(r.status),
    milestoneCount: Number(r.milestoneCount),
    committeeThreshold: Number(r.committeeThreshold),
    nextMilestone: Number(r.nextMilestone),
    releaseBps,
    investorMerkleRoot: String(r.investorMerkleRoot ?? ethers.ZeroHash),
  }
}

export default function StagedCapital() {
  const { provider, signer, address, chainId, isConnected } = useWalletStore()
  const [roundIdStr, setRoundIdStr] = useState('1')
  const [depositAmount, setDepositAmount] = useState('')
  const [stealthTagHex, setStealthTagHex] = useState('')
  const [evidenceHex, setEvidenceHex] = useState('')
  const [committeeSigs, setCommitteeSigs] = useState<{ signer: string; signature: string }[]>([])
  const [merkleProofJson, setMerkleProofJson] = useState('[]')

  const [searchParams] = useSearchParams()
  const vaultParam = (searchParams.get('vault') ?? '').trim()
  const vaultQueryInvalid = Boolean(vaultParam && !isValidAddress(vaultParam))

  const readProvider = provider ?? getDefaultReadProvider()

  const effectiveVaultAddr = useMemo(() => {
    if (vaultParam) {
      if (!isValidAddress(vaultParam)) return null
      return getAddress(vaultParam)
    }
    const d = CONTRACT_ADDRESSES.STAGED_CAPITAL_VAULT
    if (!d || d === ZERO_ADDRESS || !isValidAddress(d)) return null
    return getAddress(d)
  }, [vaultParam])

  const vaultRead = useMemo(
    () => (effectiveVaultAddr ? getStagedCapitalVaultAt(effectiveVaultAddr, readProvider) : null),
    [effectiveVaultAddr, readProvider]
  )

  const effectiveChainId = chainId ?? DEFAULT_NETWORK.chainId

  const roundId = useMemo(() => {
    try {
      return BigInt(roundIdStr.trim() || '0')
    } catch {
      return 0n
    }
  }, [roundIdStr])

  const { data: roundData, refetch: refetchRound } = useQuery({
    queryKey: ['staged-capital-round', effectiveVaultAddr, roundIdStr, address],
    enabled: Boolean(vaultRead && roundId > 0n),
    queryFn: async () => {
      if (!vaultRead || roundId === 0n) return null
      const raw = await vaultRead.getRound(roundId)
      const committee: string[] = await vaultRead.getCommittee(roundId)
      const payouts: bigint[] = []
      const rv = parseRound(raw)
      for (let i = 0; i < rv.milestoneCount; i++) {
        const p: bigint = await vaultRead.milestonePayout(roundId, i)
        payouts.push(p)
      }
      const dep =
        address && roundId > 0n
          ? (await vaultRead.deposits(roundId, address)) as bigint
          : 0n
      let tokenSymbol = 'TOKEN'
      let tokenDecimals = 18
      try {
        const t = new Contract(rv.token, ERC20_MIN, readProvider)
        tokenSymbol = await t.symbol()
        const d = Number(await t.decimals())
        if (Number.isFinite(d) && d >= 0 && d <= 36) tokenDecimals = d
      } catch {
        /* ignore */
      }
      let investorLeafPreview: string | null = null
      if (address) {
        investorLeafPreview = stagedCapitalInvestorLeaf(address)
        try {
          const onChain = (await vaultRead.computeInvestorLeaf(address)) as string
          if (onChain.toLowerCase() !== investorLeafPreview.toLowerCase()) {
            console.warn('stagedCapital leaf mismatch JS vs chain', { investorLeafPreview, onChain })
          }
        } catch {
          /* ignore */
        }
      }
      return { round: rv, committee, payouts, myDeposit: dep, tokenSymbol, tokenDecimals, investorLeafPreview }
    },
  })

  const signAttestation = async () => {
    if (!effectiveVaultAddr || !vaultRead || !signer || roundId === 0n) {
      toast.error('Connect a committee wallet and set a valid round id.')
      return
    }
    if (roundData?.round.status !== 2) {
      toast.error('Round must be Active (finalize after min raise) before committee attestations.')
      return
    }
    const addr = await signer.getAddress()
    const committee = roundData?.committee ?? []
    if (!committee.some((c) => c.toLowerCase() === addr.toLowerCase())) {
      toast.error('Connected wallet is not on this round’s committee.')
      return
    }
    let evidence: string
    try {
      evidence = ethers.isHexString(evidenceHex.trim(), 32)
        ? evidenceHex.trim()
        : ethers.keccak256(ethers.toUtf8Bytes(evidenceHex.trim() || 'milestone'))
    } catch {
      toast.error('Evidence must be 32-byte hex or text (hashed).')
      return
    }
    if (committeeSigs.some((s) => s.signer.toLowerCase() === addr.toLowerCase())) {
      toast.error('You already added a signature for this wallet.')
      return
    }
    try {
      const domain = stagedCapitalTypedDomain(effectiveVaultAddr!, effectiveChainId)
      const sig = await signer.signTypedData(domain, STAGED_CAPITAL_EIP712_TYPES, {
        roundId,
        milestoneIndex: BigInt(roundData?.round.nextMilestone ?? 0),
        evidenceHash: evidence,
      })
      setCommitteeSigs((prev) => [...prev, { signer: addr, signature: sig }])
      toast.success('Attestation signature recorded locally — submit when you have enough committee sigs.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Signing failed')
    }
  }

  const submitAttestation = async () => {
    if (!vaultRead || !signer || roundId === 0n) return
    if (roundData?.round.status !== 2) {
      toast.error('Round must be Active.')
      return
    }
    const v = effectiveVaultAddr ? getStagedCapitalVaultAt(effectiveVaultAddr, signer) : null
    if (!v) return
    const thr = roundData?.round.committeeThreshold ?? 0
    if (committeeSigs.length < thr) {
      toast.error(`Need at least ${thr} committee signatures (have ${committeeSigs.length}).`)
      return
    }
    let evidence: string
    try {
      evidence = ethers.isHexString(evidenceHex.trim(), 32)
        ? evidenceHex.trim()
        : ethers.keccak256(ethers.toUtf8Bytes(evidenceHex.trim() || 'milestone'))
    } catch {
      toast.error('Invalid evidence hash.')
      return
    }
    const idx = roundData?.round.nextMilestone ?? 0
    const signers = committeeSigs.map((s) => s.signer)
    const signatures = committeeSigs.map((s) => s.signature)
    try {
      const tx = await v.attestMilestone(roundId, idx, evidence, signers, signatures)
      const user = await signer.getAddress()
      await waitAndParseTransaction(tx, user, provider ?? readProvider)
      toast.success('Milestone attested on-chain.')
      setCommitteeSigs([])
      await refetchRound()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Attestation failed')
    }
  }

  const deposit = async () => {
    if (!signer || !roundData || roundId === 0n) return
    const v = effectiveVaultAddr ? getStagedCapitalVaultAt(effectiveVaultAddr, signer) : null
    if (!v) return
    let amount: bigint
    try {
      amount = ethers.parseUnits(depositAmount.trim() || '0', roundData.tokenDecimals)
    } catch {
      toast.error(`Invalid amount (token uses ${roundData.tokenDecimals} decimals).`)
      return
    }
    if (amount <= 0n) {
      toast.error('Amount must be positive.')
      return
    }
    const token = new Contract(roundData.round.token, ERC20_MIN, signer)
    const user = await signer.getAddress()
    try {
      const allowance: bigint = await token.allowance(user, effectiveVaultAddr!)
      if (allowance < amount) {
        const txA = await token.approve(effectiveVaultAddr!, ethers.MaxUint256)
        await waitAndParseTransaction(txA, user, provider ?? readProvider)
      }
      let tag = ethers.ZeroHash
      if (stealthTagHex.trim()) {
        tag = ethers.isHexString(stealthTagHex.trim(), 32)
          ? stealthTagHex.trim()
          : ethers.keccak256(ethers.toUtf8Bytes(stealthTagHex.trim()))
      }
      const root = roundData.round.investorMerkleRoot
      const hasAllowlist =
        root &&
        root !== ethers.ZeroHash &&
        root.toLowerCase() !== '0x0000000000000000000000000000000000000000000000000000000000000000'
      let merkleProof: string[] = []
      if (hasAllowlist) {
        try {
          const parsed = JSON.parse(merkleProofJson.trim() || '[]') as unknown
          if (!Array.isArray(parsed)) throw new Error('Proof must be a JSON array')
          merkleProof = parsed.map((x) => {
            const s = String(x).trim()
            if (!ethers.isHexString(s, 32)) throw new Error(`Invalid proof element: ${s}`)
            return s
          })
        } catch (err) {
          toast.error(err instanceof Error ? err.message : 'Invalid Merkle proof JSON')
          return
        }
      }
      const tx = await v.commitCapital(roundId, amount, tag, merkleProof)
      await waitAndParseTransaction(tx, user, provider ?? readProvider)
      toast.success('Capital committed.')
      setDepositAmount('')
      await refetchRound()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Deposit failed')
    }
  }

  const finalize = async () => {
    if (!signer) {
      toast.error('Connect a wallet to send finalizeRound.')
      return
    }
    const v = effectiveVaultAddr ? getStagedCapitalVaultAt(effectiveVaultAddr, signer) : null
    if (!v || roundId === 0n) return
    try {
      const user = await signer.getAddress()
      const tx = await v.finalizeRound(roundId)
      await waitAndParseTransaction(tx, user, provider ?? readProvider)
      toast.success('Round finalized.')
      await refetchRound()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Finalize failed')
    }
  }

  const refund = async () => {
    if (!signer) return
    const v = effectiveVaultAddr ? getStagedCapitalVaultAt(effectiveVaultAddr, signer) : null
    if (!v || roundId === 0n) return
    try {
      const user = await signer.getAddress()
      const tx = await v.refund(roundId)
      await waitAndParseTransaction(tx, user, provider ?? readProvider)
      toast.success('Refund claimed.')
      await refetchRound()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Refund failed')
    }
  }

  const claim = async () => {
    if (!signer) return
    const v = effectiveVaultAddr ? getStagedCapitalVaultAt(effectiveVaultAddr, signer) : null
    if (!v || roundId === 0n) return
    try {
      const user = await signer.getAddress()
      const tx = await v.claimMilestone(roundId)
      await waitAndParseTransaction(tx, user, provider ?? readProvider)
      toast.success('Milestone claimed to founder.')
      await refetchRound()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Claim failed')
    }
  }

  if (vaultQueryInvalid) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold text-terminal-accent">Staged capital</h1>
        <div className="border border-red-500/40 bg-red-950/30 rounded-lg p-4 text-sm text-red-200">
          Invalid <code className="text-xs">vault</code> query parameter:{' '}
          <code className="break-all">{vaultParam}</code>. Use a valid checksummed contract address, or remove{' '}
          <code className="text-xs">?vault=</code> to fall back to <code className="text-xs">VITE_STAGED_CAPITAL_VAULT_ADDRESS</code>.
        </div>
        <Link to="/staged-capital" className="text-terminal-accent underline text-sm">
          Clear query and retry
        </Link>
      </div>
    )
  }

  if (!vaultRead) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold text-terminal-accent">Staged capital</h1>
        <DaoModuleNotice>
          <p>
            Deploy <code className="text-xs">StagedCapitalVault</code> from{' '}
            <code className="text-xs">Aegis-contracts</code>, merge into <code className="text-xs">latest.json</code>, then run{' '}
            <code className="text-xs">npm run gen:frontend-env</code> so{' '}
            <code className="text-xs">VITE_STAGED_CAPITAL_VAULT_ADDRESS</code> is set — or open{' '}
            <code className="text-xs">/staged-capital?vault=0x…</code> to point at any deployed vault. See{' '}
            <code className="text-xs">docs/crowdfunding/STAGED_CAPITAL_VAULT.md</code>.
          </p>
        </DaoModuleNotice>
        <p className="text-terminal-text-dim text-sm">
          Public crowdfunding remains on{' '}
          <Link to="/crowdfunding" className="text-terminal-accent underline">
            Crowdfunding
          </Link>
          .
        </p>
      </div>
    )
  }

  const nowSec = Math.floor(Date.now() / 1000)
  const r = roundData?.round
  const canFinalize = r?.status === 0 && nowSec > Number(r.endTime)
  const isFounder = address && r?.founder.toLowerCase() === address.toLowerCase()

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold text-terminal-accent">Staged capital</h1>
        <p className="text-terminal-text-dim text-sm max-w-3xl">
          VC-style tranches: investors commit ERC20 during a window; committee attests milestones (EIP-712); the
          founder multisig claims each tranche in order. Optional commitment tag on deposit for off-chain cap-table
          privacy. Full spec: Aegis-contracts <code className="text-xs">docs/crowdfunding/STAGED_CAPITAL_VAULT.md</code>.
        </p>
        <p className="text-xs text-terminal-text-dim">
          Vault: <code className="break-all">{effectiveVaultAddr}</code> · RPC: {RPC_CONFIG.default.slice(0, 48)}…
        </p>
        {vaultParam && effectiveVaultAddr && (
          <p className="text-xs text-amber-700 border border-amber-500/30 rounded px-2 py-1 inline-block">
            Using <code className="text-xs">?vault=</code> override (not the default env address).
          </p>
        )}
      </div>

      <DaoModuleNotice>
        <p>
          This module is <strong className="text-terminal-text">not</strong> a dispute court: the committee attests
          delivery; investors should treat committee choice as the trust anchor. Use fresh funding addresses + optional
          commitment tags for stealth-aligned UX.
        </p>
      </DaoModuleNotice>

      <div className="flex flex-wrap gap-3 items-end border border-terminal-border rounded-lg p-4">
        <label className="flex flex-col gap-1 text-sm">
          Round id
          <input
            value={roundIdStr}
            onChange={(e) => setRoundIdStr(e.target.value)}
            className="bg-terminal-bg border border-terminal-border rounded px-2 py-1 text-terminal-text w-32"
          />
        </label>
        <button
          type="button"
          onClick={() => void refetchRound()}
          className="px-3 py-1.5 rounded bg-terminal-accent text-terminal-bg text-sm font-medium"
        >
          Refresh
        </button>
      </div>

      {roundData && r && (
        <div className="space-y-4 border border-terminal-border rounded-lg p-4 text-sm">
          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <div className="text-terminal-text-dim">Status</div>
              <div className="font-medium">{ROUND_STATUS[r.status] ?? r.status}</div>
            </div>
            <div>
              <div className="text-terminal-text-dim">Payment token</div>
              <div>
                {roundData.tokenSymbol} · {formatAddress(r.token)}
              </div>
            </div>
            <div>
              <div className="text-terminal-text-dim">Founder</div>
              <div>{formatAddress(r.founder)}</div>
            </div>
            <div>
              <div className="text-terminal-text-dim">Committee</div>
              <div className="text-xs space-y-1">
                {roundData.committee.map((c) => (
                  <div key={c}>{formatAddress(c)}</div>
                ))}
                <div className="text-terminal-text-dim">
                  Threshold: {r.committeeThreshold} of {roundData.committee.length}
                </div>
              </div>
            </div>
            <div>
              <div className="text-terminal-text-dim">Raised / caps</div>
              <div>
                {ethers.formatUnits(r.totalRaised, roundData.tokenDecimals)} /{' '}
                {ethers.formatUnits(r.hardCap, roundData.tokenDecimals)} (min{' '}
                {ethers.formatUnits(r.minRaise, roundData.tokenDecimals)})
              </div>
            </div>
            <div>
              <div className="text-terminal-text-dim">Window (unix)</div>
              <div>
                {r.startTime.toString()} → {r.endTime.toString()}
              </div>
            </div>
            <div>
              <div className="text-terminal-text-dim">Next milestone index</div>
              <div>{r.nextMilestone}</div>
            </div>
            <div>
              <div className="text-terminal-text-dim">Your deposit (refund basis)</div>
              <div>{ethers.formatUnits(roundData.myDeposit, roundData.tokenDecimals)}</div>
            </div>
            <div className="md:col-span-2">
              <div className="text-terminal-text-dim">Investor allowlist root</div>
              <div className="font-mono text-xs break-all">
                {r.investorMerkleRoot === ethers.ZeroHash ? (
                  <span className="text-terminal-text-dim">Open round (no Merkle proof)</span>
                ) : (
                  r.investorMerkleRoot
                )}
              </div>
              {roundData.investorLeafPreview && (
                <p className="text-xs text-terminal-text-dim mt-1 break-all">
                  Your leaf (connected wallet): <span className="font-mono">{roundData.investorLeafPreview}</span>
                </p>
              )}
            </div>
          </div>

          <div>
            <div className="text-terminal-text-dim mb-1">Milestones (bps / payout wei)</div>
            <ul className="list-disc list-inside text-xs space-y-0.5">
              {r.releaseBps.map((bps, i) => (
                <li key={i}>
                  #{i}: {bps.toString()} bps →{' '}
                  {ethers.formatUnits(roundData.payouts[i] ?? 0n, roundData.tokenDecimals)} {roundData.tokenSymbol}
                </li>
              ))}
            </ul>
          </div>

          {r.status === 0 && (
            <div className="space-y-2 border-t border-terminal-border pt-3">
              <div className="font-medium text-terminal-accent">Investor · commit</div>
              <div className="flex flex-wrap gap-2 items-end">
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-terminal-text-dim">Amount ({roundData.tokenDecimals} decimals)</span>
                  <input
                    value={depositAmount}
                    onChange={(e) => setDepositAmount(e.target.value)}
                    className="bg-terminal-bg border border-terminal-border rounded px-2 py-1 w-40"
                    placeholder="0.0"
                  />
                </label>
                <label className="flex flex-col gap-1 flex-1 min-w-[200px]">
                  <span className="text-xs text-terminal-text-dim">Stealth tag (optional hex or text → keccak)</span>
                  <input
                    value={stealthTagHex}
                    onChange={(e) => setStealthTagHex(e.target.value)}
                    className="bg-terminal-bg border border-terminal-border rounded px-2 py-1"
                    placeholder="0x… or label"
                  />
                </label>
                {(r.investorMerkleRoot &&
                  r.investorMerkleRoot !== ethers.ZeroHash &&
                  r.investorMerkleRoot.toLowerCase() !==
                    '0x0000000000000000000000000000000000000000000000000000000000000000') && (
                  <label className="flex flex-col gap-1 w-full min-w-[280px]">
                    <span className="text-xs text-terminal-text-dim">
                      Merkle proof (JSON array of 32-byte hex — OpenZeppelin merkle-tree)
                    </span>
                    <textarea
                      value={merkleProofJson}
                      onChange={(e) => setMerkleProofJson(e.target.value)}
                      className="bg-terminal-bg border border-terminal-border rounded px-2 py-1 font-mono text-xs min-h-[4rem]"
                      placeholder='["0x…","0x…"]'
                    />
                  </label>
                )}
                <button
                  type="button"
                  disabled={!isConnected}
                  onClick={() => void deposit()}
                  className="px-3 py-1.5 rounded bg-terminal-accent text-terminal-bg disabled:opacity-40"
                >
                  Commit capital
                </button>
              </div>
            </div>
          )}

          {r.status === 0 && (
            <div className="space-y-2 border-t border-terminal-border pt-3">
              <div className="font-medium text-terminal-accent">Anyone · finalize</div>
              <p className="text-xs text-terminal-text-dim">
                After funding ends: if raised &lt; min → Failed (refunds). Else → Active (milestones).
              </p>
              <button
                type="button"
                disabled={!isConnected || !canFinalize}
                onClick={() => void finalize()}
                className="px-3 py-1.5 rounded border border-terminal-accent text-terminal-accent disabled:opacity-40"
              >
                finalizeRound
              </button>
              {!canFinalize && (
                <span className="text-xs text-terminal-text-dim ml-2">
                  Unlocks after end time ({r.endTime.toString()}, now {nowSec}).
                </span>
              )}
            </div>
          )}

          {r.status === 1 && (
            <div className="border-t border-terminal-border pt-3">
              <button
                type="button"
                disabled={!isConnected || roundData.myDeposit === 0n}
                onClick={() => void refund()}
                className="px-3 py-1.5 rounded bg-red-900/40 border border-red-500/50 text-red-200 disabled:opacity-40"
              >
                Refund my deposit
              </button>
            </div>
          )}

          {r.status === 2 && (
            <div className="space-y-3 border-t border-terminal-border pt-3">
              <div className="font-medium text-terminal-accent">Committee · EIP-712 attestation</div>
              <label className="flex flex-col gap-1 max-w-xl">
                <span className="text-xs text-terminal-text-dim">Evidence (32-byte hex or arbitrary text → keccak)</span>
                <input
                  value={evidenceHex}
                  onChange={(e) => setEvidenceHex(e.target.value)}
                  className="bg-terminal-bg border border-terminal-border rounded px-2 py-1 font-mono text-xs"
                  placeholder="0x… or description"
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={!isConnected}
                  onClick={() => void signAttestation()}
                  className="px-3 py-1.5 rounded border border-terminal-border disabled:opacity-40"
                >
                  Sign current milestone
                </button>
                <button
                  type="button"
                  disabled={!isConnected}
                  onClick={() => void submitAttestation()}
                  className="px-3 py-1.5 rounded bg-terminal-accent text-terminal-bg disabled:opacity-40"
                >
                  Submit attestations ({committeeSigs.length} sigs)
                </button>
                {committeeSigs.length > 0 && (
                  <button type="button" onClick={() => setCommitteeSigs([])} className="text-xs text-terminal-text-dim underline">
                    Clear sigs
                  </button>
                )}
              </div>
              {committeeSigs.length > 0 && (
                <ul className="text-xs font-mono break-all space-y-1">
                  {committeeSigs.map((s) => (
                    <li key={s.signer}>
                      {formatAddress(s.signer)}: {s.signature.slice(0, 20)}…
                    </li>
                  ))}
                </ul>
              )}

              <div className="font-medium text-terminal-accent">Founder · claim</div>
              <button
                type="button"
                disabled={!isConnected || !isFounder}
                onClick={() => void claim()}
                className="px-3 py-1.5 rounded bg-terminal-accent text-terminal-bg disabled:opacity-40"
              >
                claimMilestone (sequential)
              </button>
              {!isFounder && (
                <span className="text-xs text-terminal-text-dim ml-2">Connect the founder wallet to claim.</span>
              )}
            </div>
          )}

          {r.status === 3 && <p className="text-terminal-text-dim text-sm">Round completed — all milestones claimed.</p>}
        </div>
      )}

      {!roundData && roundId > 0n && (
        <p className="text-terminal-text-dim text-sm">Load a round by id (on-chain round must exist).</p>
      )}
    </div>
  )
}
