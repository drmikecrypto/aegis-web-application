import { useQuery } from '@tanstack/react-query'
import { useWalletStore } from '@/store/walletStore'
import { Contract } from 'ethers'
import { formatBalance, formatDate } from '@/utils/format'
import { CONTRACT_ADDRESSES, ZERO_ADDRESS } from '@/config/contracts'
import { SONIC_GATEWAY_DOCS } from '@/config/sonicInfra'
import { Link } from 'react-router-dom'

const LEADERBOARD_ADDRESS = CONTRACT_ADDRESSES.LEADERBOARD
const TREASURY_ALLOCATOR_ADDRESS = CONTRACT_ADDRESSES.TREASURY_LIQUIDITY_ALLOCATOR
const PRIVATE_AMM_ADDRESS = CONTRACT_ADDRESSES.PRIVATE_AMM

export default function Home() {
  const { provider, isConnected, address } = useWalletStore()

  // Fetch leaderboard data
  const { data: leaderboardData } = useQuery({
    queryKey: ['leaderboard', LEADERBOARD_ADDRESS],
    queryFn: async () => {
      if (!provider || LEADERBOARD_ADDRESS === '0x0000000000000000000000000000000000000000') return null
      try {
        const leaderboardABI = [
          'function getCurrentLibertyCycleInfo() view returns (uint256, uint256, uint256)',
          'function getFreeMarketLeaderboard(uint256) view returns (uint256, uint256, uint256, uint256, uint256, uint8, bytes32, uint256)',
          'function getSovereigntyRankings(uint256) view returns (bytes32[])',
          'function getSovereignIndividual(bytes32) view returns (bytes32, string, uint256, uint256, uint256, uint256, uint256, uint256, uint8, bool, bytes32, uint256)',
          'function getActiveSovereignsCount() view returns (uint256)',
        ]
        const contract = new Contract(LEADERBOARD_ADDRESS, leaderboardABI, provider)
        
        const [cycleInfo, activeCount] = await Promise.all([
          contract.getCurrentLibertyCycleInfo(),
          contract.getActiveSovereignsCount(),
        ])

        const currentCycle = Number(cycleInfo[0])
        const leaderboard = await contract.getFreeMarketLeaderboard(currentCycle)
        const rankings = await contract.getSovereigntyRankings(currentCycle)

        // Fetch top 10 sovereigns
        const topSovereigns = await Promise.all(
          rankings.slice(0, 10).map(async (commitment: string) => {
            try {
              const sovereign = await contract.getSovereignIndividual(commitment)
              return {
                commitment,
                alias: sovereign[1],
                score: BigInt(sovereign[2]),
                exchanges: BigInt(sovereign[3]),
                wealth: BigInt(sovereign[4]),
                tier: Number(sovereign[8]),
              }
            } catch {
              return null
            }
          })
        )

        return {
          currentCycle: Number(cycleInfo[0]),
          cycleStart: Number(cycleInfo[1]),
          cycleEnd: Number(cycleInfo[2]),
          totalSovereigns: Number(leaderboard[1]),
          prizePool: BigInt(leaderboard[2]),
          peakScore: BigInt(leaderboard[7]),
          topSovereigns: topSovereigns.filter((s): s is NonNullable<typeof s> => s !== null),
          activeCount: Number(activeCount),
        }
      } catch (error) {
        console.error('Error fetching leaderboard:', error)
        return null
      }
    },
    enabled: !!provider,
    refetchInterval: 30000,
  })

  const tierNames = ['Liberty Seeker', 'Market Participant', 'Sound Money Advocate', 'Austrian Scholar', 'Praxeological Master', 'Misesian Sovereign']

  return (
    <div className="space-y-8">
      {/* Hero Section */}
      <div className="space-y-6 text-center">
        <p className="uppercase tracking-[0.25em] text-sm text-terminal-text-dim font-medium">
          Groth16 ZK · Sonic settlement · Ethereum bridge
        </p>
        <h1 className="text-4xl md:text-5xl font-bold text-terminal-text leading-tight">
          Privacy rails you can audit,<br />
          <span className="text-terminal-accent">governance without a back door</span>
        </h1>
        <p className="text-lg text-terminal-text-dim max-w-3xl mx-auto leading-relaxed">
          Aegis roots in <strong className="text-terminal-text">zero-knowledge proofs</strong> (Groth16) only where a
          verifier is deployed, <strong className="text-terminal-text">stealth-oriented token flows</strong> where the
          contracts expose them, and a <strong className="text-terminal-text">real DAO</strong>: parameter and upgrade
          paths run through on-chain proposals and timelocks — not through a secret operator panel in this static site.
          <strong className="text-terminal-text"> Primary settlement is Sonic.</strong> Ethereum appears where you bridge
          or where modules intentionally read cross-chain state — always read the deployed bytecode for the exact
          boundary.
        </p>
        <p className="text-sm text-terminal-text-dim max-w-2xl mx-auto">
          <Link to="/principles" className="text-terminal-accent underline font-medium">
            Principles &amp; honesty bar
          </Link>{' '}
          — same DAO trust contract for every module (
          <code className="text-terminal-accent text-xs">docs/DAO_TRUST_CONTRACT.md</code>). No hype: verify, don&apos;t
          trust.
        </p>
        <p className="text-sm text-terminal-text-dim max-w-2xl mx-auto mt-2">
          <strong className="text-terminal-text">Maximum stealth (recommended):</strong> after you hold AGS, prefer
          shielding and commitments over raw ERC-20 balances — open the{' '}
          <Link to="/wallet" className="text-terminal-accent underline font-medium">
            Wallet
          </Link>{' '}
          rail. Operator program:{' '}
          <code className="text-terminal-accent text-xs">docs/AEGIS_HIDDEN_FORT_EXECUTION_PLAN.md</code>.
        </p>

        {/* Pillars — factual, minimal */}
        <div className="grid gap-4 md:grid-cols-3 text-left mt-8">
          <div className="card bg-terminal-surface/70 border-terminal-border/60">
            <h3 className="text-base font-semibold text-terminal-text mb-2">Verifiable</h3>
            <p className="text-sm text-terminal-text-dim leading-relaxed">
              Solidity sources and tests live in the repository. The UI only calls the addresses in your build-time env.
            </p>
          </div>
          <div className="card bg-terminal-surface/70 border-terminal-border/60">
            <h3 className="text-base font-semibold text-terminal-text mb-2">Governance on-chain</h3>
            <p className="text-sm text-terminal-text-dim leading-relaxed">
              The DAO owns the rulebook: votes and timelocks — not a hidden admin in this UI. Launch-era multisigs or
              owners are explicit in Solidity; read them before assuming central control.
            </p>
          </div>
          <div className="card bg-terminal-surface/70 border-terminal-border/60">
            <h3 className="text-base font-semibold text-terminal-text mb-2">Sonic &amp; Ethereum</h3>
            <p className="text-sm text-terminal-text-dim leading-relaxed">
              Day-to-day settlement targets <strong className="text-terminal-text">Sonic</strong>.{' '}
              <strong className="text-terminal-text">Ethereum</strong> is supported where the Gateway bridge and listed
              contracts say so — not every screen talks to L1. Pick an RPC you trust.
            </p>
          </div>
        </div>

        {/* How it works — bitcoin.org-style clarity */}
        <div className="card text-left max-w-3xl mx-auto mt-6 border-terminal-border/80 bg-terminal-surface/50">
          <h2 className="text-lg font-semibold text-terminal-text mb-3">
            How it works{' '}
            <Link to="/how-it-works" className="text-sm font-normal text-terminal-accent underline">
              (diagram)
            </Link>
          </h2>
          <ol className="list-decimal pl-5 space-y-2 text-sm text-terminal-text-dim leading-relaxed">
            <li>
              Install an EVM wallet that supports Sonic (see the official{' '}
              <a
                href={SONIC_GATEWAY_DOCS.wallets}
                target="_blank"
                rel="noreferrer"
                className="text-terminal-accent underline"
              >
                wallet list
              </a>
              {' '}
              — MetaMask, Rabby, OKX, Trust, and others. This app uses EIP-6963 so you can pick which extension connects
              when several are installed.
            </li>
            <li>This site submits transactions to the contracts it was configured for—nothing off-chain signs on your behalf.</li>
            <li>Flows that require ZK ask your browser (or a prover URL you set) to build a proof the on-chain verifier checks.</li>
            <li>Anyone can mirror this static bundle; the chain does not care which host served the HTML.</li>
          </ol>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap justify-center gap-3 mt-8">
          <Link to="/principles" className="btn-secondary px-6 py-3 text-base">
            Principles
          </Link>
          <Link to="/swap" className="btn-primary px-8 py-3 text-base">
            Trade
          </Link>
          <Link to="/dex-roadmap" className="btn-secondary px-6 py-3 text-base">
            DEX roadmap
          </Link>
          <Link to="/liquidity" className="btn-secondary px-6 py-3 text-base">
            Liquidity
          </Link>
          <Link to="/treasury-incentives" className="btn-secondary px-6 py-3 text-base">
            Treasury &amp; LP mine
          </Link>
          <Link to="/bridge" className="btn-secondary px-8 py-3 text-base">
            Bridge
          </Link>
          <Link to="/governance" className="btn-secondary px-8 py-3 text-base">
            Governance
          </Link>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[{
          title: 'Max Supply',
          value: '21M',
          subtitle: 'AGS tokens',
        }, {
          title: 'Execution',
          value: '100%',
          subtitle: 'On-chain',
        }, {
          title: 'Privacy',
          value: 'ZK',
          subtitle: 'Per deployed flow',
        }, {
          title: 'Active Users',
          value: leaderboardData?.activeCount || 0,
          subtitle: 'This cycle',
        }].map((stat) => (
          <div key={stat.title} className="card text-center bg-terminal-surface/60 border-terminal-border/60">
            <p className="text-xs uppercase tracking-[0.2em] text-terminal-text-dim mb-2 font-medium">{stat.title}</p>
            <div className="text-2xl font-bold text-terminal-accent mb-1">{stat.value}</div>
            <div className="text-sm text-terminal-text-dim">{stat.subtitle}</div>
          </div>
        ))}
      </div>

      {/* Liquidity Section */}
      <div className="card border-terminal-border/60 bg-terminal-surface/60">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          <div className="space-y-3">
            <h2 className="text-2xl font-bold text-terminal-accent">Liquidity Pools</h2>
            <p className="text-terminal-text-dim max-w-2xl leading-relaxed">
              Public pools and treasury plumbing are on-chain like everything else. Inspect pool and allocator contracts
              before depositing size.
            </p>
          </div>
          <div className="bg-terminal-surface border border-terminal-border/40 rounded-lg px-5 py-4 font-mono text-xs text-terminal-text-dim space-y-2 min-w-[280px]">
            <div>
              <div className="text-terminal-text mb-1 font-semibold">Allocator</div>
              <div className="text-sm">
                {TREASURY_ALLOCATOR_ADDRESS !== ZERO_ADDRESS
                  ? `${TREASURY_ALLOCATOR_ADDRESS.slice(0, 10)}...${TREASURY_ALLOCATOR_ADDRESS.slice(-8)}`
                  : 'Not deployed'}
              </div>
            </div>
            <div>
              <div className="text-terminal-text mb-1 font-semibold">Private AMM</div>
              <div className="text-sm">
                {PRIVATE_AMM_ADDRESS !== ZERO_ADDRESS
                  ? `${PRIVATE_AMM_ADDRESS.slice(0, 10)}...${PRIVATE_AMM_ADDRESS.slice(-8)}`
                  : 'Not deployed'}
              </div>
            </div>
          </div>
        </div>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link to="/liquidity" className="btn-secondary">
            Add / remove liquidity
          </Link>
          <Link to="/treasury-incentives" className="btn-secondary">
            Treasury bonds &amp; LP gauge
          </Link>
          <Link to="/swap" className="btn-secondary">
            View Pools
          </Link>
        </div>
      </div>

      {/* Privacy Leaderboard Section */}
      {LEADERBOARD_ADDRESS !== ZERO_ADDRESS && (
        <div className="card">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-2xl font-bold text-terminal-accent mb-2">
                Privacy Leaderboard
              </h2>
              <p className="text-terminal-text-dim">
                On-chain rankings from the leaderboard contract (commitment-based aliases).
              </p>
            </div>
            {leaderboardData && (
              <div className="text-right">
                <div className="text-sm text-terminal-text-dim mb-1">Cycle</div>
                <div className="text-2xl font-bold text-terminal-text">
                  #{leaderboardData.currentCycle}
                </div>
                <div className="text-xs text-terminal-text-dim mt-1">
                  Ends {formatDate(leaderboardData.cycleEnd * 1000)}
                </div>
              </div>
            )}
          </div>

          {leaderboardData ? (
            <div className="space-y-4">
              {/* Stats */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <div className="card bg-terminal-surface">
                  <div className="text-sm text-terminal-text-dim mb-1">Total</div>
                  <div className="text-xl font-bold text-terminal-accent">
                    {leaderboardData.totalSovereigns}
                  </div>
                </div>
                <div className="card bg-terminal-surface">
                  <div className="text-sm text-terminal-text-dim mb-1">Prize Pool</div>
                  <div className="text-xl font-bold text-terminal-accent">
                    {formatBalance(leaderboardData.prizePool)} AGS
                  </div>
                </div>
                <div className="card bg-terminal-surface">
                  <div className="text-sm text-terminal-text-dim mb-1">Top Score</div>
                  <div className="text-xl font-bold text-terminal-accent">
                    {formatBalance(leaderboardData.peakScore)}
                  </div>
                </div>
              </div>

              {/* Top Rankings */}
              {leaderboardData.topSovereigns.length > 0 ? (
                <div className="space-y-2">
                  <h3 className="text-lg font-semibold text-terminal-text mb-4">Top Participants</h3>
                  <div className="space-y-2">
                    {leaderboardData.topSovereigns.map((sovereign, index) => (
                      <div
                        key={sovereign.commitment}
                        className="flex items-center justify-between p-4 rounded-lg border border-terminal-border/30 hover:border-terminal-accent/50 transition-colors bg-terminal-surface/50"
                      >
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 rounded-full bg-terminal-accent/20 flex items-center justify-center font-bold text-terminal-accent text-sm">
                            {index + 1}
                          </div>
                          <div>
                            <div className="font-semibold text-terminal-text">
                              {sovereign.alias || `${sovereign.commitment.slice(0, 8)}...`}
                            </div>
                            <div className="text-sm text-terminal-text-dim">
                              {tierNames[sovereign.tier] || 'Participant'}
                            </div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-semibold text-terminal-accent">
                            {formatBalance(sovereign.score)} pts
                          </div>
                          <div className="text-sm text-terminal-text-dim">
                            {formatBalance(sovereign.exchanges)} exchanges
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-center py-8 text-terminal-text-dim">
                  No participants yet. Be the first!
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-8 text-terminal-text-dim">
              Loading leaderboard data...
            </div>
          )}
        </div>
      )}

      {/* Connection Status */}
      {!isConnected && (
        <div className="card bg-terminal-surface/80 border-terminal-border/60 text-center">
          <p className="text-terminal-text-dim leading-relaxed">
            Connect a Sonic-compatible wallet to sign transactions. That does <strong className="text-terminal-text">not</strong> by itself
            run a blockchain node—it only gives the dApp an address and uses the wallet&apos;s chosen RPC for writes.
          </p>
        </div>
      )}

      {isConnected && address && (
        <div className="card bg-terminal-accent/10 border-terminal-accent/30 text-center">
          <p className="text-terminal-accent font-medium">
            Connected: {address.slice(0, 6)}...{address.slice(-4)}
          </p>
          <p className="text-xs text-terminal-text-dim mt-2">
            Wallet ready. For reads, pick RPC in the header; for sovereignty, run local Sonic JSON-RPC.
          </p>
        </div>
      )}
    </div>
  )
}
