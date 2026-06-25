import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { EventLog } from 'ethers'
import { formatUnits } from 'ethers'
import toast from 'react-hot-toast'
import { randomBytes } from 'ethers'
import { ZERO_ADDRESS, CONTRACT_ADDRESSES } from '@/config/contracts'
import { useWalletStore } from '@/store/walletStore'
import {
  getGovernanceContract,
  getGovernanceTreasuryContract,
  getTokenAllocationContract,
  getGovernanceEmergencyContract,
  getErc20Contract,
} from '@/utils/contracts'
import { proveGovernance } from '@/utils/prover'
import { groth16ProofBigintsToBytes256 } from '@/utils/proofBytes'
import { isValidHex, checkRateLimit } from '@/utils/security'
import { waitAndParseTransaction } from '@/utils/transactionHelper'
import {
  formatAddress,
  formatBalance,
  formatDate,
  formatDuration,
  formatNumber,
} from '@/utils/format'
import DaoModuleNotice from '@/components/DaoModuleNotice'

export default function Governance() {
  const { provider } = useWalletStore()
  const [activeTab, setActiveTab] = useState<'proposals' | 'create' | 'private-vote' | 'delegate'>('proposals')

  const { data: metrics } = useQuery({
    queryKey: ['governance-metrics'],
    queryFn: async () => {
      if (!provider) return null
      try {
        const contract = getGovernanceContract(provider)
        const [nextProposalId, activeProposals, totalVotingPower] = await contract.getGovernanceMetrics()
        const [votingPeriod, executionDelay, proposalThreshold, quorumThreshold, executionMajorityThreshold] =
          await contract.getGovernanceConfig()
        return {
          nextProposalId: Number(nextProposalId),
          activeProposals: Number(activeProposals),
          totalVotingPower: BigInt(totalVotingPower),
          votingPeriod: BigInt(votingPeriod),
          executionDelay: BigInt(executionDelay),
          proposalThreshold: BigInt(proposalThreshold),
          quorumThreshold: BigInt(quorumThreshold),
          executionMajorityThreshold: BigInt(executionMajorityThreshold),
        }
      } catch (error) {
        console.error('Error fetching governance metrics:', error)
        return { nextProposalId: 0, activeProposals: 0, totalVotingPower: 0n }
      }
    },
    enabled: !!provider,
  })

  const { data: treasurySummary } = useQuery({
    queryKey: ['governance-treasury-overview'],
    queryFn: async () => {
      if (!provider) return null
      try {
        const contract = getGovernanceTreasuryContract(provider)
        const state = (await contract.getTreasuryState()) as unknown as {
          treasuryToken: string
          treasuryWallet: string
          totalAllocated: bigint
          totalExecuted: bigint
        }
        const treasuryAddress = await contract.getAddress()
        const tokenAddress = state.treasuryToken

        let tokenSymbol = 'AGS'
        let decimals = 18
        let balance = 0n

        if (tokenAddress && tokenAddress !== ZERO_ADDRESS) {
          const tokenContract = getErc20Contract(tokenAddress, provider)
          try {
            tokenSymbol = await tokenContract.symbol()
          } catch {
            tokenSymbol = 'AGS'
          }
          try {
            decimals = Number(await tokenContract.decimals())
          } catch {
            decimals = 18
          }
          try {
            balance = await tokenContract.balanceOf(treasuryAddress)
          } catch {
            balance = 0n
          }
        }

        const committed = state.totalAllocated - state.totalExecuted

        return {
          tokenAddress,
          treasuryAddress,
          tokenSymbol,
          decimals,
          balance,
          totalAllocated: state.totalAllocated,
          totalExecuted: state.totalExecuted,
          committed: committed > 0n ? committed : 0n,
        }
      } catch (error) {
        console.error('Error fetching governance treasury overview:', error)
        return null
      }
    },
    enabled: !!provider && CONTRACT_ADDRESSES.GOVERNANCE_TREASURY !== ZERO_ADDRESS,
    staleTime: 60_000,
  })

  const { data: allocationSummary } = useQuery({
    queryKey: ['token-allocation-overview'],
    queryFn: async () => {
      if (!provider) return null
      try {
        const contract = getTokenAllocationContract(provider)
        const allocationAmounts = (await contract.getAllocationAmounts()) as unknown as [
          bigint,
          bigint,
          bigint
        ]
        const allocationStatus = (await contract.getAllocationStatus()) as unknown as [
          boolean,
          boolean,
          boolean
        ]

        const tokenAddress = await contract.token()
        const tokenSet = await contract.tokenSet()

        let tokenSymbol = 'AGS'
        let decimals = 18
        if (tokenSet && tokenAddress && tokenAddress !== ZERO_ADDRESS) {
          const tokenContract = getErc20Contract(tokenAddress, provider)
          try {
            tokenSymbol = await tokenContract.symbol()
          } catch {
            tokenSymbol = 'AGS'
          }
          try {
            decimals = Number(await tokenContract.decimals())
          } catch {
            decimals = 18
          }
        }

        const publicSaleContract = await contract.publicSaleContract()
        const ecosystemRewardsContract = await contract.ecosystemRewardsContract()
        const treasuryWallet = await contract.treasuryWallet()

        return {
          tokenSymbol,
          decimals,
          allocations: {
            public: allocationAmounts[0],
            ecosystem: allocationAmounts[1],
            treasury: allocationAmounts[2],
          },
          status: {
            public: allocationStatus[0],
            ecosystem: allocationStatus[1],
            treasury: allocationStatus[2],
          },
          addresses: {
            publicSaleContract,
            ecosystemRewardsContract,
            treasuryWallet,
          },
        }
      } catch (error) {
        console.error('Error fetching token allocation overview:', error)
        return null
      }
    },
    enabled: !!provider && CONTRACT_ADDRESSES.TOKEN_ALLOCATION !== ZERO_ADDRESS,
    staleTime: 60_000,
  })

  const { data: emergencySummary } = useQuery({
    queryKey: ['governance-emergency-overview'],
    queryFn: async () => {
      if (!provider) return null
      try {
        const contract = getGovernanceEmergencyContract(provider)
        const proposalCount = Number(await contract.emergencyProposalCount())
        const criticalThreshold = Number(await contract.CRITICAL_THRESHOLD())
        const economicThreshold = Number(await contract.ECONOMIC_THRESHOLD())
        const complianceThreshold = Number(await contract.COMPLIANCE_THRESHOLD())

        return {
          proposalCount,
          thresholds: {
            critical: criticalThreshold,
            economic: economicThreshold,
            compliance: complianceThreshold,
          },
        }
      } catch (error) {
        console.error('Error fetching emergency oversight stats:', error)
        return null
      }
    },
    enabled: !!provider && CONTRACT_ADDRESSES.GOVERNANCE_EMERGENCY !== ZERO_ADDRESS,
    staleTime: 60_000,
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-terminal-accent mb-2">Governance</h1>
          <p className="text-terminal-text-dim">
            Propose changes, vote privately, execute decisions. ZK-backed flows use on-chain verifiers where
            deployed. Voting length and post-queue execution delay below are read live from the governance contract.
          </p>
          <DaoModuleNotice>
            <p>
              This is the <strong className="text-terminal-text">DAO control plane</strong>: thresholds, delays, and
              execution majority apply equally to every voter with power under the same rules — including early token
              allocation. If an emergency or admin path exists in your deployment, it will be visible in the contracts,
              not hidden behind this UI.
            </p>
          </DaoModuleNotice>
        </div>
      </div>

      {/* Metrics */}
      {metrics && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="card">
            <div className="text-sm text-terminal-text-dim mb-1">Next Proposal ID</div>
            <div className="text-2xl font-bold text-terminal-text">{metrics.nextProposalId}</div>
          </div>
          <div className="card">
            <div className="text-sm text-terminal-text-dim mb-1">Active Proposals</div>
            <div className="text-2xl font-bold text-terminal-text">{metrics.activeProposals}</div>
          </div>
          <div className="card">
            <div className="text-sm text-terminal-text-dim mb-1">Total Voting Power</div>
            <div className="text-2xl font-bold text-terminal-text">
              {formatBalance(metrics.totalVotingPower)}
            </div>
          </div>
          </div>
          {'votingPeriod' in metrics && metrics.votingPeriod !== undefined && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
              <div className="card">
                <div className="text-sm text-terminal-text-dim mb-1">Voting period</div>
                <div className="text-xl font-bold text-terminal-text">{formatDuration(metrics.votingPeriod)}</div>
              </div>
              <div className="card">
                <div className="text-sm text-terminal-text-dim mb-1">Execution delay (after queue)</div>
                <div className="text-xl font-bold text-terminal-text">{formatDuration(metrics.executionDelay!)}</div>
              </div>
              <div className="card">
                <div className="text-sm text-terminal-text-dim mb-1">Proposal threshold (AGS)</div>
                <div className="text-xl font-bold text-terminal-text">{formatBalance(metrics.proposalThreshold!)}</div>
              </div>
              <div className="card">
                <div className="text-sm text-terminal-text-dim mb-1">Quorum threshold (AGS)</div>
                <div className="text-xl font-bold text-terminal-text">{formatBalance(metrics.quorumThreshold!)}</div>
              </div>
              <div className="card">
                <div className="text-sm text-terminal-text-dim mb-1">Execution majority (AGS)</div>
                <div className="text-xl font-bold text-terminal-text">
                  {formatBalance(metrics.executionMajorityThreshold!)}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {(treasurySummary || allocationSummary || emergencySummary) && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          {treasurySummary && (
            <section className="card space-y-4">
              <header>
                <h2 className="text-xl font-semibold text-terminal-text">Governance Treasury</h2>
                <p className="text-sm text-terminal-text-dim">
                  Token balance and allocations controlled by governance votes.
                </p>
              </header>
              <dl className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <dt className="text-terminal-text-dim">Token</dt>
                  <dd className="font-semibold text-terminal-text">
                    {treasurySummary.tokenSymbol} ({formatAddress(treasurySummary.tokenAddress)})
                  </dd>
                </div>
                <div>
                  <dt className="text-terminal-text-dim">Treasury Wallet</dt>
                  <dd className="font-semibold text-terminal-text">
                    {formatAddress(treasurySummary.treasuryAddress)}
                  </dd>
                </div>
                <div>
                  <dt className="text-terminal-text-dim">On-Chain Balance</dt>
                  <dd className="font-semibold text-terminal-accent">
                    {formatBalance(treasurySummary.balance, treasurySummary.decimals)}{' '}
                    {treasurySummary.tokenSymbol}
                  </dd>
                </div>
                <div>
                  <dt className="text-terminal-text-dim">Committed (Queued)</dt>
                  <dd className="font-semibold text-terminal-warning">
                    {formatBalance(treasurySummary.committed, treasurySummary.decimals)}{' '}
                    {treasurySummary.tokenSymbol}
                  </dd>
                </div>
                <div>
                  <dt className="text-terminal-text-dim">Total Allocated</dt>
                  <dd className="font-semibold text-terminal-text">
                    {formatBalance(treasurySummary.totalAllocated, treasurySummary.decimals)}{' '}
                    {treasurySummary.tokenSymbol}
                  </dd>
                </div>
                <div>
                  <dt className="text-terminal-text-dim">Total Executed</dt>
                  <dd className="font-semibold text-terminal-text">
                    {formatBalance(treasurySummary.totalExecuted, treasurySummary.decimals)}{' '}
                    {treasurySummary.tokenSymbol}
                  </dd>
                </div>
              </dl>
            </section>
          )}

          {allocationSummary && (
            <section className="card space-y-4">
              <header>
                <h2 className="text-xl font-semibold text-terminal-text">Token Allocation</h2>
                <p className="text-sm text-terminal-text-dim">
                  Token distribution across public sale, ecosystem, and treasury.
                </p>
              </header>
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                  <AllocationStat
                    title="Public Sale (50%)"
                    amount={allocationSummary.allocations.public}
                    decimals={allocationSummary.decimals}
                    symbol={allocationSummary.tokenSymbol}
                    completed={allocationSummary.status.public}
                    addressLabel="Sale Contract"
                    addressValue={allocationSummary.addresses.publicSaleContract}
                  />
                  <AllocationStat
                    title="Ecosystem (30%)"
                    amount={allocationSummary.allocations.ecosystem}
                    decimals={allocationSummary.decimals}
                    symbol={allocationSummary.tokenSymbol}
                    completed={allocationSummary.status.ecosystem}
                    addressLabel="Rewards Contract"
                    addressValue={allocationSummary.addresses.ecosystemRewardsContract}
                  />
                  <AllocationStat
                    title="Treasury (20%)"
                    amount={allocationSummary.allocations.treasury}
                    decimals={allocationSummary.decimals}
                    symbol={allocationSummary.tokenSymbol}
                    completed={allocationSummary.status.treasury}
                    addressLabel="Treasury Wallet"
                    addressValue={allocationSummary.addresses.treasuryWallet}
                  />
                </div>
              </div>
            </section>
          )}

          {emergencySummary && (
            <section className="card space-y-4">
              <header>
                <h2 className="text-xl font-semibold text-terminal-text">Emergency Circuit</h2>
                <p className="text-sm text-terminal-text-dim">
                  Emergency proposals for critical issues. Requires high voting threshold.
                </p>
              </header>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="card bg-terminal-surface/60 border-terminal-border/60">
                  <p className="text-xs uppercase tracking-wide text-terminal-text-muted mb-1">
                    Submitted Proposals
                  </p>
                  <p className="text-2xl font-semibold text-terminal-text">
                    {formatNumber(emergencySummary.proposalCount)}
                  </p>
                </div>
                <div className="card bg-terminal-surface/60 border-terminal-border/60">
                  <p className="text-xs uppercase tracking-wide text-terminal-text-muted mb-1">
                    Critical Cooldown
                  </p>
                  <p className="text-lg font-semibold text-terminal-text">
                    {formatDuration(emergencySummary.thresholds.critical)}
                  </p>
                  <p className="text-[11px] text-terminal-text-dim">Circuit vulnerabilities</p>
                </div>
                <div className="card bg-terminal-surface/60 border-terminal-border/60">
                  <p className="text-xs uppercase tracking-wide text-terminal-text-muted mb-1">
                    Economic Cooldown
                  </p>
                  <p className="text-lg font-semibold text-terminal-text">
                    {formatDuration(emergencySummary.thresholds.economic)}
                  </p>
                  <p className="text-[11px] text-terminal-text-dim">Liquidity or oracle shocks</p>
                </div>
                <div className="card bg-terminal-surface/60 border-terminal-border/60">
                  <p className="text-xs uppercase tracking-wide text-terminal-text-muted mb-1">
                    Compliance Cooldown
                  </p>
                  <p className="text-lg font-semibold text-terminal-text">
                    {formatDuration(emergencySummary.thresholds.compliance)}
                  </p>
                  <p className="text-[11px] text-terminal-text-dim">Regulatory or governance failures</p>
                </div>
              </div>
            </section>
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 border-terminal-border border-b">
        <button
          onClick={() => setActiveTab('proposals')}
          className={`px-4 py-2 font-medium transition-colors ${
            activeTab === 'proposals'
              ? 'text-terminal-accent border-b-2 border-terminal-accent'
              : 'text-terminal-text-dim hover:text-terminal-text'
          }`}
        >
          Proposals
        </button>
        <button
          onClick={() => setActiveTab('create')}
          className={`px-4 py-2 font-medium transition-colors ${
            activeTab === 'create'
              ? 'text-terminal-accent border-b-2 border-terminal-accent'
              : 'text-terminal-text-dim hover:text-terminal-text'
          }`}
        >
          Create Proposal
        </button>
        <button
          onClick={() => setActiveTab('private-vote')}
          className={`px-4 py-2 font-medium transition-colors ${
            activeTab === 'private-vote'
              ? 'text-terminal-accent border-b-2 border-terminal-accent'
              : 'text-terminal-text-dim hover:text-terminal-text'
          }`}
        >
          Private vote (ZK)
        </button>
        <button
          onClick={() => setActiveTab('delegate')}
          className={`px-4 py-2 font-medium transition-colors ${
            activeTab === 'delegate'
              ? 'text-terminal-accent border-b-2 border-terminal-accent'
              : 'text-terminal-text-dim hover:text-terminal-text'
          }`}
        >
          Delegate (ZK)
        </button>
      </div>

      {/* Content */}
      {activeTab === 'proposals' && <ProposalsList />}
      {activeTab === 'create' && <CreateProposal />}
      {activeTab === 'private-vote' && <PrivateVotePanel />}
      {activeTab === 'delegate' && <PrivateDelegationPanel />}
    </div>
  )
}

type AllocationStatProps = {
  title: string
  amount: bigint
  decimals: number
  symbol: string
  completed: boolean
  addressLabel: string
  addressValue: string
}

function AllocationStat({
  title,
  amount,
  decimals,
  symbol,
  completed,
  addressLabel,
  addressValue,
}: AllocationStatProps) {
  const amountFormatted = formatUnits(amount, decimals)
  return (
    <div className="card space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-terminal-text font-semibold">{title}</span>
        <span
          className={`text-xs uppercase tracking-wide ${
            completed ? 'text-terminal-accent' : 'text-terminal-warning'
          }`}
        >
          {completed ? 'Distributed' : 'Pending'}
        </span>
      </div>
      <div className="text-sm text-terminal-text-dim">
        <div>
          {formatNumber(parseFloat(amountFormatted))} {symbol}
        </div>
        <div className="mt-1">
          <span className="block text-xs uppercase tracking-wide">{addressLabel}</span>
          <span className="font-mono text-terminal-text">{formatAddress(addressValue)}</span>
        </div>
      </div>
    </div>
  )
}

function ProposalsList() {
  const { provider } = useWalletStore()
  
  const { data: proposals } = useQuery<Proposal[]>({
    queryKey: ['governance-proposals'],
    queryFn: async () => {
      if (!provider) return []
      try {
        const contract = getGovernanceContract(provider)
        const filter = contract.filters.ProposalCreated()
        const events = (await contract.queryFilter(filter)) as EventLog[]

        const proposalPromises = events.map(async (event) => {
          const proposalId = event.args?.[0]
          if (!proposalId) return null
          try {
            const proposal = await contract.getProposal(proposalId)
            const votes = await contract.getProposalVotes(proposalId)
            return {
              id: Number(proposalId),
              title: proposal[0] as string,
              description: proposal[1] as string,
              startTime: Number(proposal[5]),
              endTime: Number(proposal[6]),
              state: proposal[8],
              forVotes: votes[0] as bigint,
              againstVotes: votes[1] as bigint,
              abstainVotes: votes[2] as bigint,
              totalVotes: votes[3] as bigint,
              quorumReached: votes[4] as boolean,
            }
          } catch (error) {
            console.warn('Failed to fetch proposal detail', error)
            return null
          }
        })

        const results = await Promise.all(proposalPromises)
        return results.filter((proposal): proposal is Proposal => proposal !== null)
      } catch (error) {
        console.error('Error fetching proposals:', error)
        return []
      }
    },
    enabled: !!provider,
  })

  if (!proposals || proposals.length === 0) {
    return (
      <div className="card text-center py-12">
        <p className="text-terminal-text-dim">No proposals found</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {proposals.map((proposal) => (
        <ProposalCard key={proposal.id} proposal={proposal} />
      ))}
    </div>
  )
}

type Proposal = {
  id: number
  title: string
  description: string
  startTime: number
  endTime: number
  state: number | string
  forVotes: bigint
  againstVotes: bigint
  abstainVotes: bigint
  totalVotes: bigint
  quorumReached: boolean
}

function ProposalCard({ proposal }: { proposal: Proposal }) {
  return (
    <div className="card">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-terminal-text mb-1">
            {proposal.title}
          </h3>
          <p className="text-sm text-terminal-text-dim">{proposal.description}</p>
        </div>
        <div className="text-xs text-terminal-text-dim">
          {formatDate(proposal.startTime)}
        </div>
      </div>
      <div className="flex items-center gap-4 text-sm">
        <div>
          <span className="text-terminal-text-dim">For: </span>
          <span className="text-terminal-accent">{formatBalance(proposal.forVotes)}</span>
        </div>
        <div>
          <span className="text-terminal-text-dim">Against: </span>
          <span className="text-terminal-error">{formatBalance(proposal.againstVotes)}</span>
        </div>
        <div>
          <span className="text-terminal-text-dim">Status: </span>
          <span className="text-terminal-warning">{proposal.state}</span>
        </div>
      </div>
    </div>
  )
}

function CreateProposal() {
  const { isConnected } = useWalletStore()

  return (
    <div className="card max-w-2xl space-y-4">
      <h2 className="text-xl font-semibold mb-2">Create governance proposal</h2>
      <p className="text-sm text-terminal-text-dim leading-relaxed">
        Private governance proposals require a valid ZK proof bound to your proposer commitment, plus encoded
        targets, values, and calldatas for <code className="text-terminal-accent">GovernanceCore</code>.
        This is intentionally not faked in the web UI: submitting an invalid proof would revert on-chain and
        waste gas.
      </p>
      <ul className="list-disc list-inside text-sm text-terminal-text-dim space-y-2">
        <li>
          Use the Hardhat/Node scripts under <code className="text-terminal-accent">Aegis-contracts/scripts/</code>{' '}
          (e.g. phase scripts that build <code>ProposalParams</code>) to generate proofs with the same verifier keys
          as mainnet.
        </li>
        <li>
          After voting ends: call <code className="text-terminal-accent">queueProposal(id)</code>, wait the timelock, then{' '}
          <code className="text-terminal-accent">executeProposal(id)</code> — see deployment docs for the exact flow.
        </li>
        <li>
          Optional: run a dedicated prover service and point the app at it via{' '}
          <code className="text-terminal-accent">VITE_PROVER_URL</code> if you want browser-driven proposal submission later.
        </li>
      </ul>
      <p className="text-xs text-terminal-text-dim">
        Connect a wallet above to vote and to read live proposal state from the chain; proposal creation from this
        screen stays off-chain scripted until a audited client-side governance circuit is wired here.
      </p>
      <button type="button" className="btn-secondary" disabled={!isConnected}>
        {isConnected ? 'Use Aegis-contracts scripts to submit proposals' : 'Connect wallet for voting'}
      </button>
    </div>
  )
}

function parseBytes32(raw: string): `0x${string}` | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const body = trimmed.startsWith('0x') ? trimmed.slice(2) : trimmed
  if (!isValidHex(body, 32)) return null
  return (`0x${body.padStart(64, '0')}`) as `0x${string}`
}

function PrivateVotePanel() {
  const { signer, address, provider } = useWalletStore()
  const [proposalId, setProposalId] = useState('')
  const [voteType, setVoteType] = useState<'0' | '1' | '2'>('1')
  const [voterCommitment, setVoterCommitment] = useState('')
  const [votingPower, setVotingPower] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const tallyConfigured =
    CONTRACT_ADDRESSES.SHIELDED_GOVERNANCE_TALLY &&
    CONTRACT_ADDRESSES.SHIELDED_GOVERNANCE_TALLY !== ZERO_ADDRESS

  const handleVote = async () => {
    try {
      checkRateLimit('critical')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Rate limit')
      return
    }
    if (!signer || !address) {
      toast.error('Connect wallet')
      return
    }
    const pid = parseInt(proposalId, 10)
    if (!Number.isFinite(pid) || pid < 0) {
      toast.error('Invalid proposal id')
      return
    }
    const commitment = parseBytes32(voterCommitment)
    if (!commitment) {
      toast.error('Voter commitment must be 32-byte hex')
      return
    }
    const power = BigInt(votingPower || '0')
    if (power <= 0n) {
      toast.error('Voting power must be positive')
      return
    }
    const contract = getGovernanceContract(signer)
    const nullifier = '0x' + Buffer.from(randomBytes(32)).toString('hex')
    const voteTimestamp = BigInt(Math.floor(Date.now() / 1000))

    setSubmitting(true)
    try {
      toast.loading('Generating governance proof…', { id: 'gov-vote' })
      const { proof } = await proveGovernance({
        proposalId: pid.toString(),
        voterCommitment: commitment,
        votingPower: power.toString(),
        voteTimestamp: voteTimestamp.toString(),
        nullifier,
        voteType,
      })
      const zkProof = groth16ProofBigintsToBytes256(proof)
      toast.loading('Submitting private vote…', { id: 'gov-vote' })
      const tx = await contract.castVote(
        pid,
        parseInt(voteType, 10),
        commitment,
        power,
        voteTimestamp,
        nullifier,
        zkProof
      )
      await waitAndParseTransaction(tx, address, provider)
      toast.success('Vote submitted', { id: 'gov-vote' })
    } catch (e) {
      toast.error(
        e instanceof Error
          ? e.message
          : 'Vote failed — ensure governance circuit artifacts or VITE_PROVER_URL are configured',
        { id: 'gov-vote' }
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="card max-w-2xl space-y-4">
      <h2 className="text-xl font-semibold">Private vote (ZK)</h2>
      <p className="text-sm text-terminal-text-dim leading-relaxed">
        Cast a vote via <code className="text-terminal-accent">PrivateGovernance.castVote</code> with a{' '}
        <code>governance</code> Groth16 proof. Vote weights stay bound to your commitment; tally finalization can use{' '}
        <code>ShieldedGovernanceTally</code> when deployed.
      </p>
      {tallyConfigured ? (
        <p className="text-xs text-terminal-accent">ShieldedGovernanceTally address is configured in env.</p>
      ) : (
        <p className="text-xs text-terminal-text-dim">
          Optional: set <code>VITE_SHIELDED_GOVERNANCE_TALLY_ADDRESS</code> for hidden-until-finalize tallies.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="block text-sm text-terminal-text-dim mb-1">Proposal ID</label>
          <input
            className="input-field w-full"
            value={proposalId}
            onChange={(e) => setProposalId(e.target.value)}
            disabled={submitting}
          />
        </div>
        <div>
          <label className="block text-sm text-terminal-text-dim mb-1">Vote</label>
          <select
            className="input-field w-full"
            value={voteType}
            onChange={(e) => setVoteType(e.target.value as '0' | '1' | '2')}
            disabled={submitting}
          >
            <option value="0">Against</option>
            <option value="1">For</option>
            <option value="2">Abstain</option>
          </select>
        </div>
      </div>
      <div>
        <label className="block text-sm text-terminal-text-dim mb-1">Voter commitment</label>
        <input
          className="input-field w-full font-mono text-xs"
          value={voterCommitment}
          onChange={(e) => setVoterCommitment(e.target.value)}
          placeholder="0x…"
          disabled={submitting}
        />
      </div>
      <div>
        <label className="block text-sm text-terminal-text-dim mb-1">Voting power (wei)</label>
        <input
          className="input-field w-full"
          value={votingPower}
          onChange={(e) => setVotingPower(e.target.value)}
          disabled={submitting}
        />
      </div>
      <button type="button" className="btn-primary" disabled={submitting} onClick={() => void handleVote()}>
        {submitting ? 'Submitting…' : 'Cast private vote'}
      </button>
    </div>
  )
}

function PrivateDelegationPanel() {
  const { signer, address, provider } = useWalletStore()
  const [delegatorCommitment, setDelegatorCommitment] = useState('')
  const [delegateCommitment, setDelegateCommitment] = useState('')
  const [delegatedPower, setDelegatedPower] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleDelegate = async () => {
    try {
      checkRateLimit('critical')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Rate limit')
      return
    }
    if (!signer || !address) {
      toast.error('Connect wallet')
      return
    }
    const from = parseBytes32(delegatorCommitment)
    const to = parseBytes32(delegateCommitment)
    if (!from || !to) {
      toast.error('Commitments must be 32-byte hex')
      return
    }
    const power = BigInt(delegatedPower || '0')
    if (power <= 0n) {
      toast.error('Delegated power must be positive')
      return
    }
    const contract = getGovernanceContract(signer)
    const nullifier = '0x' + Buffer.from(randomBytes(32)).toString('hex')

    setSubmitting(true)
    try {
      toast.loading('Generating delegation proof…', { id: 'gov-delegate' })
      const { proof } = await proveGovernance({
        delegatorCommitment: from,
        delegateCommitment: to,
        delegatedPower: power.toString(),
        nullifier,
        action: 'delegate',
      })
      const zkProof = groth16ProofBigintsToBytes256(proof)
      toast.loading('Submitting delegation…', { id: 'gov-delegate' })
      const tx = await contract.delegateVotingPower(from, to, power, nullifier, zkProof)
      await waitAndParseTransaction(tx, address, provider)
      toast.success('Delegation submitted', { id: 'gov-delegate' })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delegation failed', { id: 'gov-delegate' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="card max-w-2xl space-y-4">
      <h2 className="text-xl font-semibold">Anonymous delegation (ZK)</h2>
      <p className="text-sm text-terminal-text-dim">
        Delegate voting power between commitments via <code>GovernanceDelegation</code> — no public wallet link on
        chain. Revoke uses the same governance circuit with a fresh nullifier.
      </p>
      <div>
        <label className="block text-sm text-terminal-text-dim mb-1">Delegator commitment</label>
        <input
          className="input-field w-full font-mono text-xs"
          value={delegatorCommitment}
          onChange={(e) => setDelegatorCommitment(e.target.value)}
          disabled={submitting}
        />
      </div>
      <div>
        <label className="block text-sm text-terminal-text-dim mb-1">Delegate commitment</label>
        <input
          className="input-field w-full font-mono text-xs"
          value={delegateCommitment}
          onChange={(e) => setDelegateCommitment(e.target.value)}
          disabled={submitting}
        />
      </div>
      <div>
        <label className="block text-sm text-terminal-text-dim mb-1">Delegated power (wei)</label>
        <input
          className="input-field w-full"
          value={delegatedPower}
          onChange={(e) => setDelegatedPower(e.target.value)}
          disabled={submitting}
        />
      </div>
      <button type="button" className="btn-primary" disabled={submitting} onClick={() => void handleDelegate()}>
        {submitting ? 'Submitting…' : 'Delegate voting power'}
      </button>
    </div>
  )
}

