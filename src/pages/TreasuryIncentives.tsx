import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { parseUnits, MaxUint256, isAddress } from 'ethers'
import toast from 'react-hot-toast'
import { useWalletStore } from '@/store/walletStore'
import {
  getErc20Contract,
  getLiquidityMiningGaugeContract,
  getTreasuryBondAuctionContract,
} from '@/utils/contracts'
import { CONTRACT_ADDRESSES, ZERO_ADDRESS } from '@/config/contracts'
import { waitAndParseTransaction } from '@/utils/transactionHelper'
import { formatBalance } from '@/utils/format'
import DaoModuleNotice from '@/components/DaoModuleNotice'

function extractErrorMessage(error: unknown): string {
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    const err = error as { shortMessage?: string; message?: string }
    return err.shortMessage ?? err.message ?? 'Transaction failed'
  }
  return 'Transaction failed'
}

const NOTE_SCAN_WINDOW = 48n

export default function TreasuryIncentives() {
  const { provider, signer, address, isConnected } = useWalletStore()

  const gaugeAddr = CONTRACT_ADDRESSES.LIQUIDITY_MINING_GAUGE
  const auctionAddr = CONTRACT_ADDRESSES.TREASURY_BOND_AUCTION
  const gaugeConfigured = gaugeAddr !== ZERO_ADDRESS
  const auctionConfigured = auctionAddr !== ZERO_ADDRESS

  const [stakeAmt, setStakeAmt] = useState('')
  const [withdrawAmt, setWithdrawAmt] = useState('')
  const [rewardRecipient, setRewardRecipient] = useState('')
  const [withdrawRecipient, setWithdrawRecipient] = useState('')
  const [exitStakeTo, setExitStakeTo] = useState('')
  const [exitRewardTo, setExitRewardTo] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const [quoteMax, setQuoteMax] = useState('')
  const [minAgsFace, setMinAgsFace] = useState('0')
  const [noteHolder, setNoteHolder] = useState('')
  const [redeemNoteId, setRedeemNoteId] = useState('')

  const { data: gaugeTokens } = useQuery({
    queryKey: ['gauge-tokens', gaugeAddr, provider],
    queryFn: async () => {
      if (!provider || !gaugeConfigured) return null
      const g = getLiquidityMiningGaugeContract(provider)
      if (!g) return null
      const [stake, reward] = await Promise.all([g.STAKE_TOKEN(), g.REWARD_TOKEN()])
      const stakeErc = getErc20Contract(stake, provider)
      const rewardErc = getErc20Contract(reward, provider)
      const [stakeSym, stakeDec, rewardSym, rewardDec] = await Promise.all([
        stakeErc.symbol().catch(() => 'LP'),
        stakeErc.decimals().catch(() => 18),
        rewardErc.symbol().catch(() => 'AGS'),
        rewardErc.decimals().catch(() => 18),
      ])
      return {
        stakeToken: stake as string,
        rewardToken: reward as string,
        stakeSymbol: String(stakeSym),
        rewardSymbol: String(rewardSym),
        stakeDecimals: Number(stakeDec),
        rewardDecimals: Number(rewardDec),
      }
    },
    enabled: !!provider && gaugeConfigured,
    staleTime: 60000,
  })

  const { data: gaugeState, refetch: refetchGauge } = useQuery({
    queryKey: ['gauge-state', gaugeAddr, address, provider],
    queryFn: async () => {
      if (!provider || !gaugeConfigured || !address) return null
      const g = getLiquidityMiningGaugeContract(provider)
      if (!g) return null
      const [staked, earned, paused, total, periodFinish, rewardRate] = await Promise.all([
        g.balanceOf(address),
        g.earned(address),
        g.paused(),
        g.totalSupply(),
        g.periodFinish(),
        g.rewardRate(),
      ])
      return {
        staked: staked as bigint,
        earned: earned as bigint,
        paused: Boolean(paused),
        totalSupply: total as bigint,
        periodFinish: periodFinish as bigint,
        rewardRate: rewardRate as bigint,
      }
    },
    enabled: !!provider && gaugeConfigured && !!address,
    refetchInterval: 12000,
  })

  const { data: auctionMeta, refetch: refetchAuction } = useQuery({
    queryKey: ['auction-meta', auctionAddr, provider],
    queryFn: async () => {
      if (!provider || !auctionConfigured) return null
      const a = getTreasuryBondAuctionContract(provider)
      if (!a) return null
      const [ags, quote, id, completed, cap, sold, start, end, mat, nextId] = await Promise.all([
        a.AGS(),
        a.QUOTE_TOKEN(),
        a.auctionId(),
        a.auctionCompleted(),
        a.agsCapacity(),
        a.agsSold(),
        a.auctionStart(),
        a.auctionEnd(),
        a.maturity(),
        a.nextNoteId(),
      ])
      const quoteErc = getErc20Contract(quote, provider)
      const [quoteSym, quoteDec] = await Promise.all([
        quoteErc.symbol().catch(() => 'QUOTE'),
        quoteErc.decimals().catch(() => 18),
      ])
      let priceWad = 0n
      try {
        priceWad = (await a.spotPriceQuotePerAgsWad()) as bigint
      } catch {
        priceWad = 0n
      }
      return {
        ags: ags as string,
        quote: quote as string,
        auctionId: id as bigint,
        completed: Boolean(completed),
        capacity: cap as bigint,
        sold: sold as bigint,
        auctionStart: start as bigint,
        auctionEnd: end as bigint,
        maturity: mat as bigint,
        nextNoteId: nextId as bigint,
        quoteSymbol: String(quoteSym),
        quoteDecimals: Number(quoteDec),
        spotPriceWad: priceWad,
      }
    },
    enabled: !!provider && auctionConfigured,
    refetchInterval: 10000,
  })

  const { data: myNotes, refetch: refetchNotes } = useQuery({
    queryKey: ['my-bond-notes', auctionAddr, address, auctionMeta?.nextNoteId, provider],
    queryFn: async () => {
      if (!provider || !auctionConfigured || !address || !auctionMeta) return []
      const a = getTreasuryBondAuctionContract(provider)
      if (!a) return []
      const next = auctionMeta.nextNoteId
      if (next === 0n) return []
      const out: { id: bigint; agsFace: bigint; maturity: bigint; redeemed: boolean }[] = []
      const start = next - 1n
      const lo = start >= NOTE_SCAN_WINDOW ? start - (NOTE_SCAN_WINDOW - 1n) : 0n
      for (let i = start; i >= lo; i--) {
        const owner = (await a.noteOwner(i)) as string
        if (owner.toLowerCase() !== address.toLowerCase()) continue
        const n = await a.notes(i)
        const agsFace = n[0] as bigint
        const maturity = n[1] as bigint
        const redeemed = n[2] as boolean
        out.push({ id: i, agsFace, maturity, redeemed })
      }
      return out
    },
    enabled: !!provider && auctionConfigured && !!address && !!auctionMeta && auctionMeta.nextNoteId > 0n,
    refetchInterval: 15000,
  })

  const { data: chainNow } = useQuery({
    queryKey: ['block-now', provider],
    queryFn: async () => {
      if (!provider) return 0n
      const b = await provider.getBlock('latest')
      return BigInt(b?.timestamp ?? 0)
    },
    enabled: !!provider && auctionConfigured,
    refetchInterval: 15000,
  })

  async function ensureAllowance(token: string, owner: string, spender: string, amount: bigint) {
    if (!signer) return
    const t = getErc20Contract(token, signer)
    const allowance = (await t.allowance(owner, spender)) as bigint
    if (allowance >= amount) return
    const tx = await t.approve(spender, MaxUint256)
    toast.loading('Approving…', { id: 'ap' })
    await tx.wait()
    toast.success('Approved', { id: 'ap' })
  }

  async function handleStake() {
    if (!signer || !address || !gaugeConfigured || !gaugeTokens || !gaugeState) return
    if (gaugeState.paused) {
      toast.error('Gauge is paused.')
      return
    }
    const w = parseUnits(stakeAmt || '0', gaugeTokens.stakeDecimals)
    if (w <= 0n) {
      toast.error('Enter a stake amount.')
      return
    }
    const g = getLiquidityMiningGaugeContract(signer)
    if (!g) return
    try {
      setBusy('stake')
      await ensureAllowance(gaugeTokens.stakeToken, address, gaugeAddr, w)
      const tx = await g.stake(w)
      toast.loading('Staking…', { id: 'st' })
      await waitAndParseTransaction(tx, address, provider!)
      toast.success('Staked', { id: 'st' })
      setStakeAmt('')
      refetchGauge()
    } catch (e: unknown) {
      toast.error(extractErrorMessage(e), { id: 'st' })
    } finally {
      setBusy(null)
    }
  }

  async function handleWithdraw() {
    if (!signer || !address || !gaugeConfigured || !gaugeTokens) return
    const w = parseUnits(withdrawAmt || '0', gaugeTokens.stakeDecimals)
    if (w <= 0n) {
      toast.error('Enter withdraw amount.')
      return
    }
    const g = getLiquidityMiningGaugeContract(signer)
    if (!g) return
    const rec = withdrawRecipient.trim()
    try {
      setBusy('wd')
      const tx =
        rec && isAddress(rec)
          ? await g.withdrawTo(rec, w)
          : await g.withdraw(w)
      toast.loading('Withdrawing LP…', { id: 'wd' })
      await waitAndParseTransaction(tx, address, provider!)
      toast.success('Withdrawn', { id: 'wd' })
      setWithdrawAmt('')
      setWithdrawRecipient('')
      refetchGauge()
    } catch (e: unknown) {
      toast.error(extractErrorMessage(e), { id: 'wd' })
    } finally {
      setBusy(null)
    }
  }

  async function handleClaimReward() {
    if (!signer || !address || !gaugeConfigured) return
    const g = getLiquidityMiningGaugeContract(signer)
    if (!g) return
    const rec = rewardRecipient.trim()
    try {
      setBusy('rw')
      const tx =
        rec && isAddress(rec) ? await g.getRewardTo(rec) : await g.getReward()
      toast.loading('Claiming rewards…', { id: 'rw' })
      await waitAndParseTransaction(tx, address, provider!)
      toast.success('Rewards claimed', { id: 'rw' })
      setRewardRecipient('')
      refetchGauge()
    } catch (e: unknown) {
      toast.error(extractErrorMessage(e), { id: 'rw' })
    } finally {
      setBusy(null)
    }
  }

  async function handleExit() {
    if (!signer || !address || !gaugeConfigured) return
    const g = getLiquidityMiningGaugeContract(signer)
    if (!g) return
    const rs = exitStakeTo.trim()
    const rr = exitRewardTo.trim()
    try {
      setBusy('ex')
      const tx =
        rs && rr && isAddress(rs) && isAddress(rr)
          ? await g.exitTo(rs, rr)
          : await g.exit()
      toast.loading('Exiting…', { id: 'ex' })
      await waitAndParseTransaction(tx, address, provider!)
      toast.success('Exited', { id: 'ex' })
      setExitStakeTo('')
      setExitRewardTo('')
      refetchGauge()
    } catch (e: unknown) {
      toast.error(extractErrorMessage(e), { id: 'ex' })
    } finally {
      setBusy(null)
    }
  }

  async function handlePurchase() {
    if (!signer || !address || !auctionConfigured || !auctionMeta) return
    const qm = parseUnits(quoteMax || '0', auctionMeta.quoteDecimals)
    const minAgs = parseUnits(minAgsFace || '0', 18)
    if (qm <= 0n) {
      toast.error('Enter max quote to spend.')
      return
    }
    const a = getTreasuryBondAuctionContract(signer)
    if (!a) return
    const holder = noteHolder.trim()
    try {
      setBusy('buy')
      await ensureAllowance(auctionMeta.quote, address, auctionAddr, qm)
      const tx =
        holder && isAddress(holder)
          ? await a.purchaseTo(holder, qm, minAgs)
          : await a.purchase(qm, minAgs)
      toast.loading('Purchasing note…', { id: 'buy' })
      await waitAndParseTransaction(tx, address, provider!)
      toast.success('Note purchased', { id: 'buy' })
      setQuoteMax('')
      setNoteHolder('')
      refetchAuction()
      refetchNotes()
    } catch (e: unknown) {
      toast.error(extractErrorMessage(e), { id: 'buy' })
    } finally {
      setBusy(null)
    }
  }

  async function handleRedeem(idStr: string) {
    if (!signer || !address || !auctionConfigured) return
    const id = BigInt(idStr)
    const a = getTreasuryBondAuctionContract(signer)
    if (!a) return
    try {
      setBusy(`redeem-${idStr}`)
      const tx = await a.redeem(id)
      toast.loading('Redeeming…', { id: 'rd' })
      await waitAndParseTransaction(tx, address, provider!)
      toast.success('Redeemed', { id: 'rd' })
      refetchAuction()
      refetchNotes()
    } catch (e: unknown) {
      toast.error(extractErrorMessage(e), { id: 'rd' })
    } finally {
      setBusy(null)
    }
  }

  const auctionLive = useMemo(() => {
    if (!auctionMeta || auctionMeta.auctionId === 0n) return false
    const now = BigInt(Math.floor(Date.now() / 1000))
    return (
      !auctionMeta.completed &&
      now >= auctionMeta.auctionStart &&
      now <= auctionMeta.auctionEnd
    )
  }, [auctionMeta])

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <p className="text-xs uppercase tracking-[0.3em] text-terminal-text-dim">DAO treasury & incentives</p>
        <h1 className="text-3xl md:text-4xl font-semibold text-terminal-text">Treasury bonds & LP mining</h1>
        <p className="text-terminal-text-dim max-w-3xl">
          Stake canonical LP in the liquidity mining gauge and participate in Dutch-style AGS note auctions when
          deployed. Optional <strong className="text-terminal-text">recipient routing</strong> lets you separate the
          transacting wallet from where LP or rewards land — this improves wallet hygiene but does{' '}
          <strong className="text-terminal-text">not</strong> hide amounts or timing from the chain.
        </p>
        <DaoModuleNotice>
          <p>
            Configure <code className="text-terminal-accent">VITE_LIQUIDITY_MINING_GAUGE_ADDRESS</code> and{' '}
            <code className="text-terminal-accent">VITE_TREASURY_BOND_AUCTION_ADDRESS</code> after deploy (
            <code className="text-terminal-accent">npm run gen:frontend-env</code> in Aegis-contracts). See{' '}
            <code className="text-terminal-text">docs/AGS_MAXIMUM_STEALTH_MASTER_PLAN.md</code> for the full privacy
            roadmap.
          </p>
        </DaoModuleNotice>
      </header>

      <div className="grid gap-8 xl:grid-cols-2">
        {/* Gauge */}
        <section className="card border border-terminal-border/60 bg-terminal-surface/50 space-y-5">
          <h2 className="text-lg font-semibold text-terminal-text">Liquidity mining gauge</h2>
          {!gaugeConfigured ? (
            <p className="text-sm text-terminal-text-dim">Gauge address not set in this build.</p>
          ) : !isConnected ? (
            <p className="text-sm text-terminal-warning">Connect a wallet to stake or claim.</p>
          ) : (
            <>
              {gaugeTokens && (
                <p className="text-sm text-terminal-text-dim">
                  Stake <span className="text-terminal-text">{gaugeTokens.stakeSymbol}</span> → earn{' '}
                  <span className="text-terminal-text">{gaugeTokens.rewardSymbol}</span>
                </p>
              )}
              {gaugeState?.paused && (
                <p className="text-sm text-terminal-warning">Gauge is paused; staking is disabled.</p>
              )}
              <div className="grid gap-3 sm:grid-cols-2 text-sm">
                <div className="rounded border border-terminal-border/40 p-3 bg-terminal-bg">
                  <div className="text-terminal-text-dim">Your stake</div>
                  <div className="font-mono text-terminal-accent">
                    {gaugeTokens
                      ? formatBalance(gaugeState?.staked ?? 0n, gaugeTokens.stakeDecimals)
                      : '—'}{' '}
                    {gaugeTokens?.stakeSymbol}
                  </div>
                </div>
                <div className="rounded border border-terminal-border/40 p-3 bg-terminal-bg">
                  <div className="text-terminal-text-dim">Claimable rewards</div>
                  <div className="font-mono text-terminal-accent">
                    {gaugeTokens
                      ? formatBalance(gaugeState?.earned ?? 0n, gaugeTokens.rewardDecimals)
                      : '—'}{' '}
                    {gaugeTokens?.rewardSymbol}
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <label className="block text-xs font-medium text-terminal-text-dim">Stake amount</label>
                <div className="flex gap-2">
                  <input
                    className="input-field flex-1"
                    value={stakeAmt}
                    onChange={(e) => setStakeAmt(e.target.value)}
                    placeholder="0.0"
                    disabled={gaugeState?.paused}
                  />
                  <button
                    type="button"
                    className="btn-primary px-4"
                    disabled={!stakeAmt || busy === 'stake' || gaugeState?.paused}
                    onClick={handleStake}
                  >
                    Stake
                  </button>
                </div>
              </div>

              <div className="space-y-3 border-t border-terminal-border/40 pt-4">
                <p className="text-xs uppercase tracking-wider text-terminal-text-dim">Withdraw LP (optional recipient)</p>
                <input
                  className="input-field w-full text-sm"
                  value={withdrawRecipient}
                  onChange={(e) => setWithdrawRecipient(e.target.value)}
                  placeholder="LP recipient (blank = your wallet)"
                />
                <div className="flex gap-2">
                  <input
                    className="input-field flex-1"
                    value={withdrawAmt}
                    onChange={(e) => setWithdrawAmt(e.target.value)}
                    placeholder="LP amount"
                  />
                  <button
                    type="button"
                    className="btn-primary px-4"
                    disabled={!withdrawAmt || busy === 'wd'}
                    onClick={handleWithdraw}
                  >
                    Withdraw
                  </button>
                </div>
              </div>

              <div className="space-y-3 border-t border-terminal-border/40 pt-4">
                <p className="text-xs uppercase tracking-wider text-terminal-text-dim">Claim rewards (optional recipient)</p>
                <input
                  className="input-field w-full text-sm"
                  value={rewardRecipient}
                  onChange={(e) => setRewardRecipient(e.target.value)}
                  placeholder="AGS recipient (blank = your wallet)"
                />
                <button
                  type="button"
                  className="btn-primary w-full"
                  disabled={busy === 'rw' || !gaugeState?.earned}
                  onClick={handleClaimReward}
                >
                  Claim rewards
                </button>
              </div>

              <div className="space-y-3 border-t border-terminal-border/40 pt-4">
                <p className="text-xs uppercase tracking-wider text-terminal-text-dim">Exit all (optional split recipients)</p>
                <input
                  className="input-field w-full text-sm"
                  value={exitStakeTo}
                  onChange={(e) => setExitStakeTo(e.target.value)}
                  placeholder="LP recipient (blank = wallet)"
                />
                <input
                  className="input-field w-full text-sm"
                  value={exitRewardTo}
                  onChange={(e) => setExitRewardTo(e.target.value)}
                  placeholder="Reward recipient (blank = wallet)"
                />
                <p className="text-xs text-terminal-text-dim">
                  If both addresses are set and valid, <code className="text-terminal-accent">exitTo</code> is used;
                  otherwise a normal <code className="text-terminal-accent">exit</code>.
                </p>
                <button
                  type="button"
                  className="btn-primary w-full border-terminal-warning/40"
                  disabled={busy === 'ex'}
                  onClick={handleExit}
                >
                  Exit all
                </button>
              </div>
            </>
          )}
        </section>

        {/* Bond auction */}
        <section className="card border border-terminal-border/60 bg-terminal-surface/50 space-y-5">
          <h2 className="text-lg font-semibold text-terminal-text">Treasury bond auction</h2>
          {!auctionConfigured ? (
            <p className="text-sm text-terminal-text-dim">Auction address not set in this build.</p>
          ) : !auctionMeta ? (
            <p className="text-sm text-terminal-text-dim">Loading auction…</p>
          ) : (
            <>
              <div className="grid gap-2 text-sm font-mono bg-terminal-bg rounded p-3 border border-terminal-border/30">
                <div className="flex justify-between">
                  <span className="text-terminal-text-dim">Auction id</span>
                  <span>{auctionMeta.auctionId.toString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-terminal-text-dim">Spot (quote / AGS, WAD)</span>
                  <span>{formatBalance(auctionMeta.spotPriceWad, 18)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-terminal-text-dim">Capacity / sold</span>
                  <span>
                    {formatBalance(auctionMeta.sold, 18)} / {formatBalance(auctionMeta.capacity, 18)} AGS
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-terminal-text-dim">Filled</span>
                  <span>{auctionMeta.completed ? 'yes' : 'no'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-terminal-text-dim">Window</span>
                  <span className="text-right text-xs">
                    {Number(auctionMeta.auctionStart)} → {Number(auctionMeta.auctionEnd)}
                  </span>
                </div>
              </div>

              {!isConnected ? (
                <p className="text-sm text-terminal-warning">Connect a wallet to purchase or redeem.</p>
              ) : (
                <>
                  {!auctionLive && auctionMeta.auctionId > 0n && (
                    <p className="text-xs text-terminal-text-dim">
                      Auction window closed or not started (chain time). Purchase will revert until active.
                    </p>
                  )}
                  <div className="space-y-2">
                    <label className="text-xs text-terminal-text-dim">Max quote to spend ({auctionMeta.quoteSymbol})</label>
                    <input
                      className="input-field w-full"
                      value={quoteMax}
                      onChange={(e) => setQuoteMax(e.target.value)}
                      placeholder="0.0"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs text-terminal-text-dim">Min AGS face (slippage, 18 decimals)</label>
                    <input className="input-field w-full" value={minAgsFace} onChange={(e) => setMinAgsFace(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs text-terminal-text-dim">Note holder (optional — cold / vault)</label>
                    <input
                      className="input-field w-full"
                      value={noteHolder}
                      onChange={(e) => setNoteHolder(e.target.value)}
                      placeholder="0x… blank = your wallet"
                    />
                  </div>
                  <button
                    type="button"
                    className="btn-primary w-full"
                    disabled={busy === 'buy' || !quoteMax}
                    onClick={handlePurchase}
                  >
                    Purchase note
                  </button>

                  <div className="border-t border-terminal-border/40 pt-4 space-y-2">
                    <p className="text-xs uppercase text-terminal-text-dim">Your notes (recent {NOTE_SCAN_WINDOW.toString()})</p>
                    {myNotes && myNotes.length === 0 && (
                      <p className="text-xs text-terminal-text-dim">No notes found in scan window for this wallet.</p>
                    )}
                    <ul className="space-y-2 text-sm">
                      {myNotes?.map((n) => (
                        <li
                          key={n.id.toString()}
                          className="flex flex-wrap items-center justify-between gap-2 rounded border border-terminal-border/40 px-3 py-2 bg-terminal-bg"
                        >
                          <span className="font-mono text-terminal-text-dim">#{n.id.toString()}</span>
                          <span>
                            {formatBalance(n.agsFace, 18)} AGS — {n.redeemed ? 'redeemed' : 'active'}
                          </span>
                          {!n.redeemed && (
                            <button
                              type="button"
                              className="text-xs btn-primary px-2 py-1"
                              disabled={
                                busy === `redeem-${n.id}` ||
                                (chainNow != null && chainNow < n.maturity)
                              }
                              title={
                                chainNow != null && chainNow < n.maturity
                                  ? 'Not yet at note maturity'
                                  : undefined
                              }
                              onClick={() => handleRedeem(n.id.toString())}
                            >
                              {chainNow != null && chainNow < n.maturity ? 'Locked' : 'Redeem'}
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="space-y-2 border-t border-terminal-border/40 pt-4">
                    <label className="text-xs text-terminal-text-dim">Redeem by note id (manual)</label>
                    <div className="flex gap-2">
                      <input
                        className="input-field flex-1 font-mono"
                        value={redeemNoteId}
                        onChange={(e) => setRedeemNoteId(e.target.value)}
                        placeholder="id"
                      />
                      <button
                        type="button"
                        className="btn-primary px-3"
                        disabled={!redeemNoteId || busy?.startsWith('redeem-')}
                        onClick={() => handleRedeem(redeemNoteId)}
                      >
                        Redeem
                      </button>
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  )
}
