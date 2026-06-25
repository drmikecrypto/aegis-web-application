import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { parseEther } from 'ethers'

import { useWalletStore } from '@/store/walletStore'
import { getLendingContract } from '@/utils/contracts'
import { formatBalance } from '@/utils/format'
import {
  proveLendingLiquidity,
  proveLendingTenor,
  proveLendingRepay,
  proveLendingWithdraw,
  proveLendingLiquidate,
} from '@/utils/prover'
import { poseidon2, poseidon3, poseidon4, randomFieldElement } from '@/utils/lendingPoseidon'
import { validateAmount, detectAttackPattern, checkRateLimit } from '@/utils/security'
import {
  getLoans,
  removeLoan,
  getSupplyCommitments,
} from '@/utils/commitmentStorage'
import { waitAndParseTransaction } from '@/utils/transactionHelper'
import DaoModuleNotice, { ZkModeCaption } from '@/components/DaoModuleNotice'
import CommitmentLocalStorageWarning from '@/components/CommitmentLocalStorageWarning'

type UserLoan = {
  loanId: string
  amount: bigint
  collateral: bigint
  interest: number
  timestamp: number
  liquidatable?: boolean
  currentDebt?: bigint
}

/** Seconds — must match `lending_tenor.circom` / `PrivateLendingContract` allowed tenors */
const LENDING_TENOR_CHOICES = [
  { label: '30 days', seconds: 2592000n },
  { label: '90 days', seconds: 7776000n },
  { label: '365 days', seconds: 31536000n },
] as const

export default function Lending() {
  const { address } = useWalletStore()
  const [activeTab, setActiveTab] = useState<'supply' | 'borrow' | 'loans'>('supply')
  const [mode, setMode] = useState<'legacy' | 'zk'>('zk')

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h1 className="text-3xl font-bold text-terminal-accent mb-2">Lending</h1>
        <DaoModuleNotice>
          <p>
            Supply and borrow against the <strong className="text-terminal-text">on-chain pool rules</strong> (collateral,
            utilization, interest, liquidation). APY is not a guarantee; liquidations and oracle behaviour are your
            downside paths — confirm them in the contract before borrowing or lending meaningful size.
          </p>
        </DaoModuleNotice>
      </div>

      <CommitmentLocalStorageWarning walletAddress={address} variant="lending" />

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

      {/* Pool Stats */}
      <LendingStats />

      {/* Tabs */}
      <div className="flex gap-2 border-terminal-border border-b">
        {(['supply', 'borrow', 'loans'] as const).map((tab) => (
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
      {activeTab === 'supply' && <SupplyLiquidity mode={mode} />}
      {activeTab === 'borrow' && <BorrowForm mode={mode} />}
      {activeTab === 'loans' && <MyLoans />}
    </div>
  )
}

function LendingStats() {
  const { provider } = useWalletStore()

  const { data: poolStats } = useQuery({
    queryKey: ['lending-pool-stats'],
    queryFn: async () => {
      if (!provider) return null
      try {
        const contract = getLendingContract(provider)
        const [totalLiquidity, liquidityPool, totalBorrowed, utilizationRate] = 
          await contract.getPoolStats()
        let spotBorrowBps = 500n
        try {
          spotBorrowBps = await contract.currentAggregateBorrowRateBps()
        } catch {
          spotBorrowBps = await contract.INTEREST_RATE().catch(() => 500n)
        }
        
        return {
          totalLiquidity: BigInt(totalLiquidity || 0),
          liquidityPool: BigInt(liquidityPool || 0),
          totalBorrowed: BigInt(totalBorrowed || 0),
          utilizationRate: Number(utilizationRate || 0) / 100,
          spotBorrowAprPercent: Number(spotBorrowBps || 0) / 100,
        }
      } catch (error) {
        console.error('Error fetching lending stats:', error)
        return {
          totalLiquidity: 0n,
          liquidityPool: 0n,
          totalBorrowed: 0n,
          utilizationRate: 0,
          spotBorrowAprPercent: 0,
        }
      }
    },
    enabled: !!provider,
    refetchInterval: 30000,
  })

  if (!poolStats) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="card">
            <div className="text-sm text-terminal-text-dim mb-1">Loading...</div>
            <div className="text-xl font-bold text-terminal-text">-</div>
          </div>
        ))}
      </div>
    )
  }

  const utilizationRate = poolStats.utilizationRate

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
      <div className="card">
        <div className="text-sm text-terminal-text-dim mb-1">Total Liquidity</div>
        <div className="text-2xl font-bold text-terminal-text">
          {formatBalance(poolStats.totalLiquidity)} AGS
        </div>
      </div>
      <div className="card">
        <div className="text-sm text-terminal-text-dim mb-1">Available</div>
        <div className="text-2xl font-bold text-terminal-accent">
          {formatBalance(poolStats.liquidityPool)} AGS
        </div>
      </div>
      <div className="card">
        <div className="text-sm text-terminal-text-dim mb-1">Total Borrowed</div>
        <div className="text-2xl font-bold text-terminal-text">
          {formatBalance(poolStats.totalBorrowed)} AGS
        </div>
      </div>
      <div className="card">
        <div className="text-sm text-terminal-text-dim mb-1">Utilization</div>
        <div className="text-2xl font-bold text-terminal-accent">
          {utilizationRate.toFixed(2)}%
        </div>
        <div className="text-xs text-terminal-text-dim mt-1">
          Spot borrow APR (pool aggregate): {poolStats.spotBorrowAprPercent.toFixed(2)}% — your loan locks at origination; no wallet deanonymization.
        </div>
      </div>
    </div>
  )
}

function SupplyLiquidity({ mode }: { mode: 'legacy' | 'zk' }) {
  const { provider, signer, isConnected, address } = useWalletStore()
  const [amount, setAmount] = useState('')
  const [supplying, setSupplying] = useState(false)
  const [withdrawing, setWithdrawing] = useState(false)
  const [withdrawAmount, setWithdrawAmount] = useState('')
  const proverUrl = import.meta.env.VITE_PROVER_URL as string | undefined
  const { data: userSupply } = useQuery({
    queryKey: ['user-supply', address],
    queryFn: async () => {
      if (!provider || !address) return { supplied: 0n, shares: 0n }
      try {
        // Query supply commitments from local storage and on-chain pool stats
        const supplyCommitments = getSupplyCommitments(address)
        const contract = getLendingContract(provider)
        const [totalLiquidity, liquidityPool, _totalBorrowed] = await contract.getPoolStats()

        // Calculate user's supply from tracked commitments
        let totalSupplied = 0n
        let totalShares = 0n

        for (const commitment of supplyCommitments) {
          const commitmentHex = commitment.commitment.startsWith('0x') 
            ? commitment.commitment 
            : `0x${commitment.commitment}`
          
          // Check if commitment exists on-chain
          try {
            const shares = await contract.liquidityShares(commitmentHex)
            if (shares > 0n) {
              totalShares += BigInt(shares.toString())
              // Estimate supplied amount from shares (approximation)
              if (totalLiquidity > 0n) {
                const estimatedAmount = (BigInt(shares.toString()) * BigInt(liquidityPool.toString())) / BigInt(totalLiquidity.toString())
                totalSupplied += estimatedAmount
              }
            }
          } catch {
            // Commitment may not exist on-chain yet
          }
        }

        return { supplied: totalSupplied, shares: totalShares }
      } catch (error) {
        console.error('Failed to query user supply:', error)
        return { supplied: 0n, shares: 0n }
      }
    },
    enabled: !!address && !!provider,
    refetchInterval: 30000, // Refresh every 30 seconds
  })

  const handleSupply = async () => {
    try {
      checkRateLimit('api')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Rate limit exceeded')
      return
    }

    if (!signer || !amount || !isConnected) {
      toast.error('Please connect wallet and enter amount')
      return
    }

    const amountValidation = validateAmount(amount)
    if (!amountValidation.valid) {
      toast.error(amountValidation.error || 'Invalid amount')
      return
    }

    if (detectAttackPattern(amount)) {
      toast.error('Invalid input detected')
      return
    }

    setSupplying(true)
    try {
      const contract = getLendingContract(signer)
      const amountWei = parseEther(amount)
      
      toast.loading('Processing supply...', { id: 'supply' })

      if (mode === 'legacy') {
        toast.error('Legacy supply not available. Please use ZK mode.')
        return
      } else {
        let proof: bigint[]
        let publicInputs: bigint[]

        if (proverUrl) {
          const res = await fetch(`${proverUrl}/lending/provide-liquidity/prove`, {
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
          const secret = randomFieldElement()
          const nullifier = randomFieldElement()
          const inputNullifier = await poseidon2(secret, nullifier)
          const outputCommitment = await poseidon3(secret, amountWei, nullifier)

          const result = await proveLendingLiquidity({
            nullifierHash: inputNullifier.toString(),
            outputCommitment: outputCommitment.toString(),
            amount: amountWei.toString(),
            secret: secret.toString(),
            nullifier: nullifier.toString(),
          })
          proof = result.proof
          publicInputs = result.publicInputs
        }

        toast.loading('Submitting transaction...', { id: 'supply' })
        const tx = await contract.provideLiquidity(proof, publicInputs)
        toast.loading('Waiting for confirmation...', { id: 'supply' })
        await waitAndParseTransaction(tx, address!, provider!)
        toast.success('Liquidity supplied', { id: 'supply' })
        setAmount('')
      }
    } catch (error) {
      console.error('supply failed', error)
      toast.error(error instanceof Error ? error.message : 'Supply failed', { id: 'supply' })
    } finally {
      setSupplying(false)
    }
  }

  const handleWithdraw = async () => {
    try {
      checkRateLimit('api')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Rate limit exceeded')
      return
    }

    if (!signer || !withdrawAmount || !isConnected) {
      toast.error('Please connect wallet and enter amount')
      return
    }

    const amountValidation = validateAmount(withdrawAmount)
    if (!amountValidation.valid) {
      toast.error(amountValidation.error || 'Invalid amount')
      return
    }

    setWithdrawing(true)
    try {
      const contract = getLendingContract(signer)
      const amountWei = parseEther(withdrawAmount)
      
      toast.loading('Processing withdrawal...', { id: 'withdraw' })

      let proof: bigint[]
      let publicInputs: bigint[]

      if (proverUrl) {
        const res = await fetch(`${proverUrl}/lending/withdraw-liquidity/prove`, {
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
        const secret = randomFieldElement()
        const nullifier = randomFieldElement()
        const liquidityNullifier = await poseidon2(secret, nullifier)
        const outputCommitment = await poseidon4(secret, amountWei, amountWei, nullifier)

        const result = await proveLendingWithdraw({
          liquidityNullifier: liquidityNullifier.toString(),
          outputCommitment: outputCommitment.toString(),
          shares: amountWei.toString(),
          amount: amountWei.toString(),
          secret: secret.toString(),
          nullifier: nullifier.toString(),
        })
        proof = result.proof
        publicInputs = result.publicInputs
      }

      toast.loading('Submitting transaction...', { id: 'withdraw' })
      const tx = await contract.withdrawLiquidity(proof, publicInputs)
      toast.loading('Waiting for confirmation...', { id: 'withdraw' })
      await waitAndParseTransaction(tx, address!, provider!)
      if (address) {
        // Refresh or handle post-withdraw logic
      }
      toast.success('Liquidity withdrawn', { id: 'withdraw' })
      setWithdrawAmount('')
    } catch (error) {
      console.error('withdraw failed', error)
      toast.error(error instanceof Error ? error.message : 'Withdrawal failed', { id: 'withdraw' })
    } finally {
      setWithdrawing(false)
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="card">
        <h2 className="text-xl font-semibold mb-4">Supply Liquidity</h2>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); handleSupply() }}>
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
              disabled={supplying}
            />
          </div>
          <button 
            type="submit" 
            className="btn-primary w-full" 
            disabled={!isConnected || supplying || !amount || parseFloat(amount) <= 0}
          >
            {supplying ? 'Supplying...' : mode === 'legacy' ? 'Supply (Public)' : 'Supply (Private ZK)'}
          </button>
        </form>
      </div>
      <div className="card">
        <h2 className="text-xl font-semibold mb-4">Your Supply</h2>
        <div className="space-y-4">
          <div className="flex justify-between">
            <span className="text-terminal-text-dim">Supplied</span>
            <span className="font-semibold">
              {userSupply ? formatBalance(userSupply.supplied) : '0'} AGS
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-terminal-text-dim">Earning</span>
            <span className="font-semibold text-terminal-accent">5% APY</span>
          </div>
          <div className="mt-4 space-y-2">
            <label className="block text-sm font-medium text-terminal-text-dim mb-2">
              Withdraw Amount (AGS)
            </label>
            <input
              type="number"
              step="0.001"
              min="0"
              value={withdrawAmount}
              onChange={(e) => setWithdrawAmount(e.target.value)}
              className="input-field w-full"
              placeholder="0.0"
              disabled={withdrawing}
            />
            <button
              className="btn-secondary w-full"
              onClick={handleWithdraw}
              disabled={!isConnected || withdrawing || !withdrawAmount || parseFloat(withdrawAmount) <= 0}
            >
              {withdrawing ? 'Withdrawing...' : 'Withdraw'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function BorrowForm({ mode }: { mode: 'legacy' | 'zk' }) {
  const { provider, signer, isConnected, address } = useWalletStore()
  const [collateral, setCollateral] = useState('')
  const [loanAmount, setLoanAmount] = useState('')
  const [tenorSeconds, setTenorSeconds] = useState<string>('31536000')
  const [borrowing, setBorrowing] = useState(false)
  const proverUrl = import.meta.env.VITE_PROVER_URL as string | undefined

  const handleBorrow = async () => {
    try {
      checkRateLimit('api')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Rate limit exceeded')
      return
    }

    if (!signer || !collateral || !loanAmount || !isConnected) {
      toast.error('Please connect wallet and enter amounts')
      return
    }

    const collateralValidation = validateAmount(collateral)
    if (!collateralValidation.valid) {
      toast.error(collateralValidation.error || 'Invalid collateral amount')
      return
    }

    const loanValidation = validateAmount(loanAmount)
    if (!loanValidation.valid) {
      toast.error(loanValidation.error || 'Invalid loan amount')
      return
    }

    if (detectAttackPattern(collateral) || detectAttackPattern(loanAmount)) {
      toast.error('Invalid input detected')
      return
    }

    const collateralWei = parseEther(collateral)
    const loanWei = parseEther(loanAmount)

    // Check collateral ratio (150% required)
    if (collateralWei * 100n < loanWei * 150n) {
      toast.error('Insufficient collateral. Minimum 150% collateralization required.')
      return
    }

    setBorrowing(true)
    try {
      const contract = getLendingContract(signer)
      
      toast.loading('Processing borrow...', { id: 'borrow' })

      if (mode === 'legacy') {
        toast.error('Legacy borrowing not available. Please use ZK mode.')
        return
      } else {
        let proof: bigint[]
        let publicInputs: bigint[]

        if (proverUrl) {
          const res = await fetch(`${proverUrl}/lending/borrow/prove`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              collateralAmount: collateralWei.toString(),
              loanAmount: loanWei.toString(),
              tenorSeconds,
              recipient: address,
            }),
          })
          if (!res.ok) throw new Error('Proof service error')
          const data = await res.json()
          proof = (data.proof ?? []).map((x: string) => BigInt(x))
          publicInputs = (data.publicInputs ?? []).map((x: string) => BigInt(x))
        } else {
          const secret = randomFieldElement()
          const nullifier = randomFieldElement()
          const tenor = BigInt(tenorSeconds)
          const nullifierHash = await poseidon2(secret, nullifier)
          const collateralCommitment = await poseidon3(secret, collateralWei, nullifier)
          const loanCommitment = await poseidon4(secret, loanWei, nullifier, tenor)

          const result = await proveLendingTenor({
            nullifierHash: nullifierHash.toString(),
            collateralCommitment: collateralCommitment.toString(),
            loanCommitment: loanCommitment.toString(),
            collateralAmount: collateralWei.toString(),
            loanAmount: loanWei.toString(),
            tenorSeconds: tenor.toString(),
            secret: secret.toString(),
            nullifier: nullifier.toString(),
          })
          proof = result.proof
          publicInputs = result.publicInputs
        }

        toast.loading('Submitting transaction...', { id: 'borrow' })
        const tx = await contract.borrowWithCollateral(proof, publicInputs)
        toast.loading('Waiting for confirmation...', { id: 'borrow' })
        await waitAndParseTransaction(tx, address!, provider!)
        toast.success('Loan issued', { id: 'borrow' })
        setCollateral('')
        setLoanAmount('')
      }
    } catch (error) {
      console.error('borrow failed', error)
      toast.error(error instanceof Error ? error.message : 'Borrow failed', { id: 'borrow' })
    } finally {
      setBorrowing(false)
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="card">
        <h2 className="text-xl font-semibold mb-4">Borrow</h2>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); handleBorrow() }}>
          <div>
            <label className="block text-sm font-medium text-terminal-text-dim mb-2">
              Collateral Amount (AGS)
            </label>
            <input
              type="number"
              step="0.001"
              min="0"
              value={collateral}
              onChange={(e) => setCollateral(e.target.value)}
              className="input-field w-full"
              placeholder="0.0"
              disabled={borrowing}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-terminal-text-dim mb-2">
              Loan tenor
            </label>
            <select
              className="input-field w-full"
              value={tenorSeconds}
              onChange={(e) => setTenorSeconds(e.target.value)}
              disabled={borrowing}
            >
              {LENDING_TENOR_CHOICES.map((t) => (
                <option key={t.seconds.toString()} value={t.seconds.toString()}>
                  {t.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-terminal-text-dim mt-1">
              On-chain proof type <code className="text-terminal-accent">lending-tenor</code> — must match circuit + commitment hash.
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-terminal-text-dim mb-2">
              Loan Amount (AGS)
            </label>
            <input
              type="number"
              step="0.001"
              min="0"
              value={loanAmount}
              onChange={(e) => setLoanAmount(e.target.value)}
              className="input-field w-full"
              placeholder="0.0"
              disabled={borrowing}
            />
          </div>
          <button 
            type="submit" 
            className="btn-primary w-full" 
            disabled={!isConnected || borrowing || !collateral || !loanAmount}
          >
            {borrowing ? 'Borrowing...' : mode === 'legacy' ? 'Borrow (Public)' : 'Borrow (Private ZK)'}
          </button>
        </form>
      </div>
      <div className="card">
        <h2 className="text-xl font-semibold mb-4">Borrowing Info</h2>
        <div className="space-y-4">
          <div className="flex justify-between">
            <span className="text-terminal-text-dim">Collateral Ratio</span>
            <span className="font-semibold">150%</span>
          </div>
          <div className="flex justify-between">
            <span className="text-terminal-text-dim">Interest Rate</span>
            <span className="font-semibold text-terminal-accent">5% APY</span>
          </div>
          {collateral && loanAmount && (
            <div className="mt-4 p-3 bg-terminal-surface rounded">
              <div className="text-sm text-terminal-text-dim mb-1">Current Ratio</div>
              <div className="font-semibold">
                {collateral && loanAmount
                  ? ((parseFloat(collateral) / parseFloat(loanAmount)) * 100).toFixed(2)
                  : '0'}%
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function MyLoans() {
  const { provider, address, signer, isConnected } = useWalletStore()
  const [repaying, setRepaying] = useState<string | null>(null)
  const [liquidating, setLiquidating] = useState<string | null>(null)
  const [repayAmount, setRepayAmount] = useState('')
  const proverUrl = import.meta.env.VITE_PROVER_URL as string | undefined

  const { data: loans } = useQuery<UserLoan[]>({
    queryKey: ['user-loans', address],
    queryFn: async () => {
      if (!provider || !address) return []
      try {
        const storedLoans = getLoans(address)
        const contract = getLendingContract(provider)
        const userLoans: UserLoan[] = []

        for (const storedLoan of storedLoans) {
          try {
            const loanInfo = await contract.getLoanInfo(storedLoan.loanId)
            if (loanInfo && loanInfo.active) {
              const currentDebt = await contract.calculateCurrentDebt(storedLoan.loanId)
              const principal = loanInfo.principal
              const interest = currentDebt > principal ? currentDebt - principal : 0n
              const interestPercent =
                principal > 0n ? Number((BigInt(interest) * 10000n) / principal) / 100 : 0
              let liquidatable = false
              try {
                liquidatable = await contract.isLiquidatable(storedLoan.loanId)
              } catch {
                liquidatable = false
              }

              userLoans.push({
                loanId: storedLoan.loanId,
                amount: loanInfo.principal,
                collateral: loanInfo.collateralAmount,
                interest: interestPercent,
                timestamp: Number(loanInfo.timestamp),
                liquidatable,
                currentDebt,
              })
            }
          } catch (error) {
            console.error(`Failed to query loan ${storedLoan.loanId}:`, error)
            userLoans.push({
              loanId: storedLoan.loanId,
              amount: BigInt(storedLoan.principal),
              collateral: BigInt(storedLoan.collateralAmount),
              interest: 0,
              timestamp: storedLoan.timestamp,
            })
          }
        }

        return userLoans
      } catch (error) {
        console.error('Failed to query loans:', error)
        return []
      }
    },
    enabled: !!provider && !!address,
    refetchInterval: 30000,
  })

  const handleRepay = async (loanId: string) => {
    if (!address || !provider) {
      toast.error('Please connect wallet')
      return
    }

    try {
      checkRateLimit('api')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Rate limit exceeded')
      return
    }

    if (!signer || !isConnected || !repayAmount) {
      toast.error('Please connect wallet and enter repayment amount')
      return
    }

    const amountValidation = validateAmount(repayAmount)
    if (!amountValidation.valid) {
      toast.error(amountValidation.error || 'Invalid amount')
      return
    }

    setRepaying(loanId)
    try {
      const contract = getLendingContract(signer)
      const amountWei = parseEther(repayAmount)

      toast.loading('Processing repayment...', { id: 'repay' })

      let proof: bigint[]
      let publicInputs: bigint[]

      if (proverUrl) {
        const res = await fetch(`${proverUrl}/lending/repay/prove`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            loanId,
            repaymentAmount: amountWei.toString(),
            recipient: address,
          }),
        })
        if (!res.ok) throw new Error('Proof service error')
        const data = await res.json()
        proof = (data.proof ?? []).map((x: string) => BigInt(x))
        publicInputs = (data.publicInputs ?? []).map((x: string) => BigInt(x))
      } else {
        const secret = randomFieldElement()
        const nullifierLoan = randomFieldElement()
        const nullifierRepay = randomFieldElement()
        const loanNullifier = await poseidon2(secret, nullifierLoan)
        const repaymentNullifier = await poseidon2(secret, nullifierRepay)
        const collateralOutputCommitment = await poseidon3(secret, amountWei, nullifierRepay)
        const loanIdField = BigInt(loanId).toString()

        const result = await proveLendingRepay({
          loanNullifier: loanNullifier.toString(),
          repaymentNullifier: repaymentNullifier.toString(),
          collateralOutputCommitment: collateralOutputCommitment.toString(),
          loanId: loanIdField,
          repaymentAmount: amountWei.toString(),
          secret: secret.toString(),
          nullifierLoan: nullifierLoan.toString(),
          nullifierRepay: nullifierRepay.toString(),
        })
        proof = result.proof
        publicInputs = result.publicInputs
      }

      toast.loading('Submitting transaction...', { id: 'repay' })
      const tx = await contract.repayLoan(proof, publicInputs)
      toast.loading('Waiting for confirmation...', { id: 'repay' })
      await waitAndParseTransaction(tx, address, provider)
      toast.success('Loan repaid', { id: 'repay' })
      setRepayAmount('')

      if (address) {
        removeLoan(address, loanId)
      }
    } catch (error) {
      console.error('repay failed', error)
      toast.error(error instanceof Error ? error.message : 'Repayment failed', { id: 'repay' })
    } finally {
      setRepaying(null)
    }
  }

  const handleLiquidate = async (loan: UserLoan) => {
    if (!address || !provider) {
      toast.error('Please connect wallet')
      return
    }

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

    if (!loan.liquidatable || loan.currentDebt === undefined) {
      toast.error('Loan is not liquidatable on-chain right now')
      return
    }

    setLiquidating(loan.loanId)
    try {
      const contract = getLendingContract(signer)
      const can = await contract.isLiquidatable(loan.loanId)
      if (!can) {
        toast.error('Loan is no longer liquidatable', { id: 'liq' })
        return
      }

      const currentDebt = await contract.calculateCurrentDebt(loan.loanId)
      const loanInfo = await contract.getLoanInfo(loan.loanId)
      const collateral = loanInfo.collateralAmount
      const penaltyBps = 110n
      const maxLiquidation = (collateral * 100n) / penaltyBps
      let liquidationWei = currentDebt <= maxLiquidation ? currentDebt : maxLiquidation
      if (liquidationWei === 0n) {
        toast.error('Computed liquidation amount is zero', { id: 'liq' })
        return
      }

      toast.loading('Building liquidation proof...', { id: 'liq' })

      let proof: bigint[]
      let publicInputs: bigint[]

      if (proverUrl) {
        const res = await fetch(`${proverUrl}/lending/liquidate/prove`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            loanId: loan.loanId,
            liquidationAmount: liquidationWei.toString(),
            liquidator: address,
          }),
        })
        if (!res.ok) throw new Error('Proof service error')
        const data = await res.json()
        proof = (data.proof ?? []).map((x: string) => BigInt(x))
        publicInputs = (data.publicInputs ?? []).map((x: string) => BigInt(x))
      } else {
        const secret = randomFieldElement()
        const nullifier = randomFieldElement()
        const liquidatorNullifier = await poseidon2(secret, nullifier)
        const liquidatorCommitment = await poseidon3(secret, liquidationWei, nullifier)
        const loanIdField = BigInt(loan.loanId).toString()

        const result = await proveLendingLiquidate({
          liquidatorNullifier: liquidatorNullifier.toString(),
          liquidatorCommitment: liquidatorCommitment.toString(),
          loanId: loanIdField,
          liquidationAmount: liquidationWei.toString(),
          secret: secret.toString(),
          nullifier: nullifier.toString(),
        })
        proof = result.proof
        publicInputs = result.publicInputs
      }

      toast.loading('Submitting liquidation...', { id: 'liq' })
      const tx = await contract.liquidateLoan(proof, publicInputs)
      toast.loading('Waiting for confirmation...', { id: 'liq' })
      await waitAndParseTransaction(tx, address, provider)
      toast.success('Loan liquidated', { id: 'liq' })

      if (address) {
        removeLoan(address, loan.loanId)
      }
    } catch (error) {
      console.error('liquidate failed', error)
      toast.error(error instanceof Error ? error.message : 'Liquidation failed', { id: 'liq' })
    } finally {
      setLiquidating(null)
    }
  }

  if (!loans || loans.length === 0) {
    return (
      <div className="card text-center py-12">
        <p className="text-terminal-text-dim">No active loans</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {loans.map((loan) => (
        <div key={loan.loanId} className="card space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <div className="text-sm text-terminal-text-dim mb-1">Borrowed</div>
              <div className="font-semibold">{formatBalance(loan.amount)} AGS</div>
            </div>
            <div>
              <div className="text-sm text-terminal-text-dim mb-1">Collateral</div>
              <div className="font-semibold">{formatBalance(loan.collateral)} AGS</div>
            </div>
            <div>
              <div className="text-sm text-terminal-text-dim mb-1">Interest</div>
              <div className="font-semibold text-terminal-accent">{loan.interest}%</div>
            </div>
            <div className="space-y-2">
              <input
                type="number"
                step="0.001"
                min="0"
                value={repayAmount}
                onChange={(e) => setRepayAmount(e.target.value)}
                className="input-field w-full"
                placeholder="Repay amount"
                disabled={repaying === loan.loanId}
              />
              <button
                className="btn-secondary w-full"
                onClick={() => handleRepay(loan.loanId)}
                disabled={repaying === loan.loanId || !repayAmount || parseFloat(repayAmount) <= 0}
              >
                {repaying === loan.loanId ? 'Repaying...' : 'Repay'}
              </button>
            </div>
          </div>
          {loan.liquidatable && (
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-t border-terminal-border/40 pt-3">
              <p className="text-xs text-terminal-text-dim">
                This loan is <strong className="text-terminal-accent">liquidatable</strong> (undercollateralized or past
                maturity). Anyone may close it with a valid <code className="text-terminal-accent">lending-liquidate</code>{' '}
                proof. Amount sent to the pool is capped by collateral and the on-chain penalty (see contract).
              </p>
              <button
                type="button"
                className="btn-primary whitespace-nowrap shrink-0"
                onClick={() => handleLiquidate(loan)}
                disabled={liquidating === loan.loanId}
              >
                {liquidating === loan.loanId ? 'Liquidating...' : 'Liquidate (ZK)'}
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
