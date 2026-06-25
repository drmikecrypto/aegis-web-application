import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { EventLog } from 'ethers'
import toast from 'react-hot-toast'
import { parseEther, randomBytes } from 'ethers'

import { useWalletStore } from '@/store/walletStore'
import { getStakingContract } from '@/utils/contracts'
import { formatBalance } from '@/utils/format'
import { proveStaking, proveReward } from '@/utils/prover'
import { validateAmount, detectAttackPattern, isValidHex, checkRateLimit } from '@/utils/security'
import { waitAndParseTransaction } from '@/utils/transactionHelper'
import DaoModuleNotice, { ZkModeCaption } from '@/components/DaoModuleNotice'

export default function Staking() {
  const [activeTab, setActiveTab] = useState<'stake' | 'unstake' | 'rewards'>('stake')
  const [mode, setMode] = useState<'legacy' | 'zk'>('zk')

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h1 className="text-3xl font-bold text-terminal-accent mb-2">Staking</h1>
        <DaoModuleNotice>
          <p>
            Staking rewards and lock behaviour follow the <strong className="text-terminal-text">staking contract</strong>{' '}
            (epochs, rates, governance-controlled parameters). Rewards are not risk-free yield from an external bank —
            they are on-chain emissions and rules that can change after a successful vote.
          </p>
        </DaoModuleNotice>
      </div>

      {/* Privacy Mode Toggle */}
      <div className="flex items-center justify-center gap-2">
        <div className="flex rounded-lg overflow-hidden border border-terminal-border/40">
          <button
            className={`px-4 py-2 text-sm ${mode === 'legacy' ? 'bg-terminal-accent text-black' : 'bg-transparent text-terminal-text'}`}
            onClick={() => setMode('legacy')}
          >
            Public (Legacy)
          </button>
          <button
            className={`px-4 py-2 text-sm ${mode === 'zk' ? 'bg-terminal-accent text-black' : 'bg-transparent text-terminal-text'}`}
            onClick={() => setMode('zk')}
          >
            Private (ZK)
          </button>
        </div>
        {mode === 'zk' && <ZkModeCaption />}
      </div>

      {/* Stats */}
      <StakingStats />

      {/* Tabs */}
      <div className="flex gap-2 border-terminal-border border-b">
        {(['stake', 'unstake', 'rewards'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 font-medium capitalize transition-colors ${
              activeTab === tab
                ? 'text-terminal-accent border-b-2 border-terminal-accent'
                : 'text-terminal-text-dim hover:text-terminal-text'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Content */}
      {activeTab === 'stake' && <StakeForm mode={mode} />}
      {activeTab === 'unstake' && <UnstakeForm mode={mode} />}
      {activeTab === 'rewards' && <RewardsSection mode={mode} />}
    </div>
  )
}

function StakingStats() {
  const { provider } = useWalletStore()

  const { data: epochInfo } = useQuery({
    queryKey: ['staking-epoch'],
    queryFn: async () => {
      if (!provider) return null
      try {
        const contract = getStakingContract(provider)
        const epoch = await contract.getCurrentEpochInfo()
        const stakingState = await contract.stakingState()
        return {
          epoch: Number(epoch[0]),
          startTime: Number(epoch[1]),
          endTime: Number(epoch[2]),
          totalStaked: BigInt(stakingState.totalStakedAmount || 0),
          rewardPool: BigInt(stakingState.rewardPool || 0),
        }
      } catch (error) {
        console.error('Error fetching epoch info:', error)
        return null
      }
    },
    enabled: !!provider,
    refetchInterval: 30000,
  })

  const { data: poolStats } = useQuery({
    queryKey: ['staking-pool-stats'],
    queryFn: async () => {
      if (!provider) return null
      try {
        const contract = getStakingContract(provider)
        const stakingState = await contract.stakingState()
        const totalStaked = BigInt(stakingState.totalStakedAmount || 0)
        const rewardRate = await contract.rewardRate().catch(() => 1000n) // 100 basis points = 1%
        const epochDuration = await contract.epochDuration().catch(() => 604800n) // 7 days
        
        const epochsPerYear = (365n * 24n * 60n * 60n) / epochDuration
        const apy = Number((rewardRate * epochsPerYear) / 10000n) // Convert from basis points
        
        let totalStakers = 0
        try {
          const filter = contract.filters.Staked()
          const events = (await contract.queryFilter(filter, 0, 'latest')) as EventLog[]
          const uniqueCommitments = new Set<string>()
          for (const event of events) {
            const commitment = event.args?.[0] ?? event.topics?.[1]
            if (commitment) {
              uniqueCommitments.add(commitment.toString())
            }
          }
          totalStakers = uniqueCommitments.size
        } catch (error) {
          console.error('Error counting stakers:', error)
        }
        
        return {
          totalStakers,
          apy,
          totalStaked,
        }
      } catch (error) {
        console.error('Error fetching staking pool stats:', error)
        return {
          totalStakers: 0,
          apy: 0,
          totalStaked: 0n,
        }
      }
    },
    enabled: !!provider,
    refetchInterval: 30000,
  })

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
      <div className="card">
        <div className="text-sm text-terminal-text-dim mb-1">Current Epoch</div>
        <div className="text-2xl font-bold text-terminal-accent">
          {epochInfo?.epoch || 0}
        </div>
      </div>
      <div className="card">
        <div className="text-sm text-terminal-text-dim mb-1">Total Staked</div>
        <div className="text-2xl font-bold text-terminal-text">
          {epochInfo ? formatBalance(epochInfo.totalStaked) : '0'} AGS
        </div>
      </div>
      <div className="card">
        <div className="text-sm text-terminal-text-dim mb-1">Reward Pool</div>
        <div className="text-2xl font-bold text-terminal-accent">
          {epochInfo ? formatBalance(epochInfo.rewardPool) : '0'} AGS
        </div>
      </div>
      <div className="card">
        <div className="text-sm text-terminal-text-dim mb-1">APY</div>
        <div className="text-2xl font-bold text-terminal-text">
          {poolStats?.apy.toFixed(2) || '0.00'}%
        </div>
      </div>
    </div>
  )
}

interface StakeFormProps {
  mode: 'legacy' | 'zk'
}

function StakeForm({ mode }: StakeFormProps) {
  const { address, isConnected, provider, signer } = useWalletStore()
  const [amount, setAmount] = useState('')
  const [staking, setStaking] = useState(false)
  const proverUrl = import.meta.env.VITE_PROVER_URL as string | undefined

  async function handleStake() {
    // Security checks
    try {
      checkRateLimit('api')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Rate limit exceeded. Please wait before trying again.')
      return
    }

    if (!isConnected || !address || !provider || !signer) {
      toast.error('Connect your wallet first')
      return
    }

    // Input validation
    const amountValidation = validateAmount(amount)
    if (!amountValidation.valid) {
      toast.error(amountValidation.error || 'Invalid amount')
      return
    }

    // Attack pattern detection
    if (detectAttackPattern(amount)) {
      toast.error('Invalid input detected')
      return
    }

    setStaking(true)
    try {
      const contract = getStakingContract(signer)
      const amountWei = parseEther(amount)
      
      // Check minimum stake
      const minStake = await contract.minimumStake().catch(() => parseEther('100'))
      if (amountWei < minStake) {
        toast.error(`Minimum stake amount is ${formatBalance(minStake)} AGS`)
        return
      }

      toast.loading('Processing stake...', { id: 'stake' })

      if (mode === 'legacy') {
        // Legacy staking - note: PrivateStakingContract only supports ZK, so this would need a wrapper
        toast.error('Legacy staking not available. Please use ZK mode.')
        return
      } else {
        // ZK staking path
        let proof: bigint[]
        let publicInputs: bigint[]

        if (proverUrl) {
          // Use prover service
          const res = await fetch(`${proverUrl}/staking/prove`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              amount: amountWei.toString(),
              recipient: address,
            }),
          })
          if (!res.ok) throw new Error('Proof service error')
          const data = await res.json()
          proof = (data.proof ?? []).map((x: string) => BigInt(x))
          publicInputs = (data.publicInputs ?? []).map((x: string) => BigInt(x))
        } else {
          // Local proving
          try {
            // Generate nullifier and commitment using cryptographically secure random values
            const nullifierBytes = randomBytes(32)
            const commitmentBytes = randomBytes(32)
            const nullifier = BigInt('0x' + Buffer.from(nullifierBytes).toString('hex'))
            const commitment = BigInt('0x' + Buffer.from(commitmentBytes).toString('hex'))
            
            const result = await proveStaking({
              inputNullifier: nullifier.toString(),
              outputCommitment: commitment.toString(),
              amount: amountWei.toString(),
            })
            proof = result.proof
            publicInputs = result.publicInputs
          } catch (e) {
            throw new Error('Failed to generate proof. Configure prover URL or ensure circuit artifacts are available.')
          }
        }

        toast.loading('Submitting transaction...', { id: 'stake' })
        const tx = await contract.stake(proof, publicInputs)
        toast.loading('Waiting for confirmation...', { id: 'stake' })
        await waitAndParseTransaction(tx, address, provider)
        toast.success('Staking completed', { id: 'stake' })
        setAmount('')
      }
    } catch (error) {
      console.error('stake failed', error)
      const message = error instanceof Error ? error.message : 'Staking failed'
      toast.error(message, { id: 'stake' })
    } finally {
      setStaking(false)
    }
  }

  return (
    <div className="card max-w-md">
      <h2 className="text-xl font-semibold mb-4">Stake Tokens</h2>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); handleStake() }}>
        <div>
          <label className="block text-sm font-medium text-terminal-text-dim mb-2">
            Amount (AGS)
          </label>
          <input
            type="number"
            step="0.001"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="input-field w-full"
            placeholder="0.0"
            disabled={staking}
          />
        </div>
        <button 
          type="submit" 
          className="btn-primary w-full" 
          disabled={!isConnected || staking || !amount || parseFloat(amount) <= 0}
        >
          {staking ? 'Staking...' : mode === 'legacy' ? 'Stake (Public)' : 'Stake (Private ZK)'}
        </button>
        {mode === 'zk' && !proverUrl && (
          <p className="text-xs text-terminal-text-dim text-center">
            Configure VITE_PROVER_URL for one-click privacy, or ensure circuit artifacts are available.
          </p>
        )}
      </form>
    </div>
  )
}

function UnstakeForm({ mode }: { mode: 'legacy' | 'zk' }) {
  const { provider, signer, isConnected, address } = useWalletStore()
  const [nullifier, setNullifier] = useState('')
  const [requesting, setRequesting] = useState(false)
  const [completing, setCompleting] = useState(false)
  const proverUrl = import.meta.env.VITE_PROVER_URL as string | undefined

  // Check for pending unstake requests
  const { data: unstakeRequests } = useQuery({
    queryKey: ['unstake-requests', address],
    queryFn: async () => {
      if (!signer || !address) return []
      try {
        // Query unstake requests from local storage and on-chain contract
        if (!address) return []
        
        const { getUnstakeRequests } = await import('@/utils/commitmentStorage')
        const storedRequests = getUnstakeRequests(address)
        const contract = getStakingContract(signer)
        const unstakeRequests: Array<{ nullifier: string; timestamp: number; canComplete: boolean }> = []
        
        const currentTime = Math.floor(Date.now() / 1000)
        const unstakeDelay = await contract.unstakeDelay()
        
        for (const request of storedRequests) {
          try {
            // Check if unstake request exists on-chain
            // Note: unstakeRequests mapping may not be directly accessible via ABI
            // We'll need to track this via events instead
            // For now, use stored data if available
            if (request.timestamp > 0) {
              const unlockTimestamp = request.timestamp
              const delaySeconds = Number(unstakeDelay)
              unstakeRequests.push({
                nullifier: request.nullifier,
                timestamp: unlockTimestamp,
                canComplete: currentTime >= unlockTimestamp + delaySeconds,
              })
            }
          } catch (error) {
            // Request may not exist on-chain yet or ABI doesn't expose the mapping
            console.error(`Failed to check unstake request ${request.nullifier}:`, error)
          }
        }
        
        return unstakeRequests
      } catch {
        return []
      }
    },
    enabled: !!signer && !!address,
  })

  const handleRequestUnstake = async () => {
    try {
      checkRateLimit('api')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Rate limit exceeded')
      return
    }

    if (!signer || !isConnected) {
      toast.error('Please connect wallet')
      return
    }

    if (mode === 'zk' && nullifier && !isValidHex(nullifier, 32)) {
      toast.error('Invalid nullifier format (must be 32-byte hex)')
      return
    }

    setRequesting(true)
    try {
      const contract = getStakingContract(signer)
      toast.loading('Requesting unstake...', { id: 'unstake-request' })

      if (mode === 'legacy') {
        toast.error('Legacy unstaking not available. Please use ZK mode.')
        return
      } else {
        // ZK unstake request
        let proof: bigint[]
        let publicInputs: bigint[]

        if (proverUrl) {
          const res = await fetch(`${proverUrl}/staking/unstake-request/prove`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nullifier: nullifier || 'auto' }),
          })
          if (!res.ok) throw new Error('Proof service error')
          const data = await res.json()
          proof = (data.proof ?? []).map((x: string) => BigInt(x))
          publicInputs = (data.publicInputs ?? []).map((x: string) => BigInt(x))
        } else {
          const contract = getStakingContract(signer)
          const stakingNullifier = nullifier ? BigInt(nullifier) : BigInt('0x' + Buffer.from(randomBytes(32)).toString('hex'))
          const epoch = await contract.getCurrentEpochInfo().then(e => Number(e[0]))
          
          const result = await proveStaking({
            stakingNullifier: stakingNullifier.toString(),
            epoch: epoch.toString(),
          })
          proof = result.proof
          publicInputs = result.publicInputs
        }

        const tx = await contract.requestUnstake(proof, publicInputs)
        toast.loading('Waiting for confirmation...', { id: 'unstake-request' })
        await waitAndParseTransaction(tx, address!, provider!)
        toast.success('Unstake requested. Complete after 14-day delay.', { id: 'unstake-request' })
        setNullifier('')
      }
    } catch (error) {
      console.error('unstake request failed', error)
      toast.error(error instanceof Error ? error.message : 'Unstake request failed', { id: 'unstake-request' })
    } finally {
      setRequesting(false)
    }
  }

  const handleCompleteUnstake = async (requestNullifier: string) => {
    try {
      checkRateLimit('api')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Rate limit exceeded')
      return
    }

    if (!signer || !isConnected) return

    setCompleting(true)
    try {
      const contract = getStakingContract(signer)
      toast.loading('Completing unstake...', { id: 'unstake-complete' })

      let proof: bigint[]
      let publicInputs: bigint[]

      if (proverUrl) {
        const res = await fetch(`${proverUrl}/staking/unstake-complete/prove`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nullifier: requestNullifier }),
        })
        if (!res.ok) throw new Error('Proof service error')
        const data = await res.json()
        proof = (data.proof ?? []).map((x: string) => BigInt(x))
        publicInputs = (data.publicInputs ?? []).map((x: string) => BigInt(x))
      } else {
        const outputCommitmentBytes = randomBytes(32)
        const result = await proveStaking({
          stakingNullifier: requestNullifier,
          outputCommitment: '0x' + Buffer.from(outputCommitmentBytes).toString('hex'),
          amount: '0', // Will be determined by contract
        })
        proof = result.proof
        publicInputs = result.publicInputs
      }

      const tx = await contract.completeUnstake(proof, publicInputs)
      await waitAndParseTransaction(tx, address!, provider!)
      toast.success('Unstake completed', { id: 'unstake-complete' })
    } catch (error) {
      console.error('unstake complete failed', error)
      toast.error(error instanceof Error ? error.message : 'Unstake failed', { id: 'unstake-complete' })
    } finally {
      setCompleting(false)
    }
  }

  return (
    <div className="card max-w-md">
      <h2 className="text-xl font-semibold mb-4">Unstake Tokens</h2>
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-terminal-text-dim mb-2">
            Staking Nullifier (optional if prover configured)
          </label>
          <input
            type="text"
            value={nullifier}
            onChange={(e) => setNullifier(e.target.value)}
            className="input-field w-full"
            placeholder="0x... (32-byte hex)"
            disabled={requesting || !!proverUrl}
          />
        </div>
        <button
          className="btn-primary w-full"
          onClick={handleRequestUnstake}
          disabled={!isConnected || requesting}
        >
          {requesting ? 'Requesting...' : 'Request Unstake'}
        </button>
        
        {unstakeRequests && unstakeRequests.length > 0 && (
          <div className="mt-4 space-y-2">
            <h3 className="text-sm font-semibold">Pending Unstake Requests</h3>
            {unstakeRequests.map((req: { nullifier?: string }, idx: number) => (
              <div key={idx} className="flex justify-between items-center p-2 bg-terminal-surface rounded">
                <span className="text-sm">{req.nullifier?.slice(0, 10)}...</span>
                <button
                  className="btn-secondary btn-sm"
                  onClick={() => req.nullifier && handleCompleteUnstake(req.nullifier)}
                  disabled={completing || !req.nullifier}
                >
                  Complete
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function RewardsSection({ mode }: { mode: 'legacy' | 'zk' }) {
  const { provider, address, signer, isConnected } = useWalletStore()
  const [claiming, setClaiming] = useState(false)
  const proverUrl = import.meta.env.VITE_PROVER_URL as string | undefined

  const { data: rewards } = useQuery<{ claimable: bigint; totalEarned: bigint } | null>({
    queryKey: ['staking-rewards', address],
    queryFn: async () => {
      if (!provider || !address) return null
      try {
        // Note: Rewards are tracked via commitments, so we can't directly query by address
        // In production, track user's commitments to calculate rewards
        return {
          claimable: 0n,
          totalEarned: 0n,
        }
      } catch {
        return null
      }
    },
    enabled: !!provider && !!address,
  })

  const handleClaimRewards = async () => {
    try {
      checkRateLimit('api')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Rate limit exceeded')
      return
    }

    if (!signer || !isConnected) {
      toast.error('Please connect wallet')
      return
    }

    setClaiming(true)
    try {
      const contract = getStakingContract(signer)
      toast.loading('Claiming rewards...', { id: 'claim-rewards' })

      if (mode === 'legacy') {
        toast.error('Legacy reward claiming not available. Please use ZK mode.')
        return
      } else {
        let proof: bigint[]
        let publicInputs: bigint[]

        if (proverUrl) {
          const res = await fetch(`${proverUrl}/staking/rewards/prove`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ recipient: address }),
          })
          if (!res.ok) throw new Error('Proof service error')
          const data = await res.json()
          proof = (data.proof ?? []).map((x: string) => BigInt(x))
          publicInputs = (data.publicInputs ?? []).map((x: string) => BigInt(x))
        } else {
          const stakingNullifierBytes = randomBytes(32)
          const rewardCommitmentBytes = randomBytes(32)
          const stakingNullifier = BigInt('0x' + Buffer.from(stakingNullifierBytes).toString('hex'))
          const rewardCommitment = BigInt('0x' + Buffer.from(rewardCommitmentBytes).toString('hex'))
          
          const result = await proveReward({
            stakingNullifier: stakingNullifier.toString(),
            rewardCommitment: rewardCommitment.toString(),
            rewardAmount: '0', // Will be determined by contract
          })
          proof = result.proof
          publicInputs = result.publicInputs
        }

        const tx = await contract.claimRewards(proof, publicInputs)
        await waitAndParseTransaction(tx, address!, provider!)
        toast.success('Rewards claimed', { id: 'claim-rewards' })
      }
    } catch (error) {
      console.error('claim rewards failed', error)
      toast.error(error instanceof Error ? error.message : 'Claim failed', { id: 'claim-rewards' })
    } finally {
      setClaiming(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="card">
        <h2 className="text-xl font-semibold mb-4">Your Rewards</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-sm text-terminal-text-dim mb-1">Claimable</div>
            <div className="text-2xl font-bold text-terminal-accent">
              {rewards ? formatBalance(rewards.claimable) : '0'} AGS
            </div>
          </div>
          <div>
            <div className="text-sm text-terminal-text-dim mb-1">Total Earned</div>
            <div className="text-2xl font-bold text-terminal-text">
              {rewards ? formatBalance(rewards.totalEarned) : '0'} AGS
            </div>
          </div>
        </div>
        <button 
          className="btn-primary w-full mt-4" 
          onClick={handleClaimRewards}
          disabled={!isConnected || claiming || !rewards || rewards.claimable === 0n}
        >
          {claiming ? 'Claiming...' : 'Claim Rewards'}
        </button>
        {mode === 'zk' && !proverUrl && (
          <p className="text-xs text-terminal-text-dim text-center mt-2">
            Configure VITE_PROVER_URL for one-click privacy.
          </p>
        )}
      </div>
    </div>
  )
}
