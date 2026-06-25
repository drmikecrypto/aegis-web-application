import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { formatUnits, parseUnits } from 'ethers'

import { useWalletStore } from '@/store/walletStore'
import { formatBalance, formatDuration } from '@/utils/format'
import DaoModuleNotice from '@/components/DaoModuleNotice'
import ZkModeToggle, { type ZkPrivacyMode } from '@/components/ZkModeToggle'
import {
  DERIVATIVE_TYPE,
  buildPricingGuidance,
  getDefaultDerivativeVolatility,
  getDefaultRiskFreeRate,
  getDefaultUnderlyingAssetId,
  getDerivativesPreviewContract,
  resolveDerivativesAddress,
  type DerivativeTypeId,
} from '@/utils/derivativePricing'
import { getDefaultReadProvider } from '@/utils/contracts'

function bpsLabel(bps: number | null): string {
  if (bps == null || !Number.isFinite(bps)) return '—'
  const sign = bps > 0 ? '+' : ''
  return `${sign}${(bps / 100).toFixed(2)}% vs fair`
}

export default function Derivatives() {
  const { provider } = useWalletStore()
  const [mode, setMode] = useState<ZkPrivacyMode>('zk')
  const readProvider = provider ?? getDefaultReadProvider()

  const [derivativeType, setDerivativeType] = useState<DerivativeTypeId>(DERIVATIVE_TYPE.CALL_OPTION)
  const [strike, setStrike] = useState('1.0')
  const [notional, setNotional] = useState('100')
  const [spotOverride, setSpotOverride] = useState('')
  const [premiumOffer, setPremiumOffer] = useState('')
  const [expiryDays, setExpiryDays] = useState('30')
  const [volPct, setVolPct] = useState(String(getDefaultDerivativeVolatility() * 100))
  const [riskFreePct, setRiskFreePct] = useState(String(getDefaultRiskFreeRate() * 100))
  const [assetId] = useState(getDefaultUnderlyingAssetId())

  const { data: derivativesAddress } = useQuery({
    queryKey: ['derivatives-address'],
    queryFn: resolveDerivativesAddress,
    staleTime: 60_000,
  })

  const { data: marketStats } = useQuery({
    queryKey: ['derivatives-market', derivativesAddress],
    queryFn: async () => {
      if (!derivativesAddress) return null
      const c = getDerivativesPreviewContract(derivativesAddress, readProvider)
      const [nextId, tvl, fees, asset] = await Promise.all([
        c.nextContractId(),
        c.totalValueLocked(),
        c.protocolFees(),
        c.getAssetPrice(assetId),
      ])
      return {
        activeContracts: Number(nextId) > 0 ? Number(nextId) - 1 : 0,
        tvl: BigInt(tvl),
        fees: BigInt(fees),
        oracleSpot: BigInt(asset?.price ?? asset?.[0] ?? 0),
        oracleTs: Number(asset?.timestamp ?? asset?.[1] ?? 0),
      }
    },
    enabled: Boolean(derivativesAddress),
    refetchInterval: 30_000,
  })

  const spotWei = useMemo(() => {
    if (spotOverride.trim()) {
      try {
        return parseUnits(spotOverride, 18)
      } catch {
        return 0n
      }
    }
    return marketStats?.oracleSpot ?? 0n
  }, [spotOverride, marketStats?.oracleSpot])

  const expiryTimestamp = useMemo(() => {
    const d = Number(expiryDays)
    if (!Number.isFinite(d) || d <= 0) return Math.floor(Date.now() / 1000)
    return Math.floor(Date.now() / 1000) + Math.round(d * 86400)
  }, [expiryDays])

  const guidanceQuery = useQuery({
    queryKey: [
      'derivatives-pricing',
      derivativesAddress,
      derivativeType,
      strike,
      notional,
      spotWei.toString(),
      expiryTimestamp,
      premiumOffer,
      volPct,
      riskFreePct,
    ],
    queryFn: async () => {
      if (!derivativesAddress || spotWei === 0n) return null
      let strikeWei = 0n
      let notionalWei = 0n
      let premiumWei = 0n
      try {
        strikeWei = parseUnits(strike, 18)
        notionalWei = parseUnits(notional, 18)
        if (premiumOffer.trim()) premiumWei = parseUnits(premiumOffer, 18)
      } catch {
        return null
      }
      const vol = Number(volPct) / 100
      const rf = Number(riskFreePct) / 100
      return buildPricingGuidance(derivativesAddress, readProvider, {
        derivativeType,
        strikeWei,
        notionalWei,
        spotWei,
        expiryTimestamp,
        userPremiumWei: premiumWei,
        volatility: Number.isFinite(vol) && vol > 0 ? vol : getDefaultDerivativeVolatility(),
        riskFreeRate: Number.isFinite(rf) && rf >= 0 ? rf : getDefaultRiskFreeRate(),
      })
    },
    enabled: Boolean(derivativesAddress) && spotWei > 0n,
  })

  const g = guidanceQuery.data

  useEffect(() => {
    if (marketStats?.oracleSpot && marketStats.oracleSpot > 0n && !spotOverride) {
      setSpotOverride(formatUnits(marketStats.oracleSpot, 18))
    }
  }, [marketStats?.oracleSpot, spotOverride])

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h1 className="text-3xl font-bold text-terminal-accent mb-2">Private derivatives</h1>
        <DaoModuleNotice>
          <p>
            Bilateral <strong className="text-terminal-text">ZK options and futures</strong> settle on Sonic via{' '}
            <code className="text-terminal-accent">PrivateDerivatives</code>. Premiums are agreed between counterparties;
            the calculator below is <strong className="text-terminal-text">off-chain Black–Scholes guidance</strong> only
            (Arweave UI). On-chain rules enforce collateral, exercise, and intrinsic payoff — not model fair value.
          </p>
        </DaoModuleNotice>
        <ZkModeToggle mode={mode} onChange={setMode} className="justify-start" />
      </div>

      {!derivativesAddress ? (
        <div className="rounded-lg border border-terminal-border/50 bg-terminal-bg p-4 text-sm text-terminal-text-dim">
          Set <code className="text-terminal-accent">VITE_DERIVATIVES_ADDRESS</code> or ship{' '}
          <code className="text-terminal-accent">config/verifier-artifact-manifest.json</code> with your deployment.
        </div>
      ) : (
        <div className="rounded-lg border border-terminal-border/40 bg-terminal-bg px-4 py-3 text-xs text-terminal-text-dim font-mono">
          Contract: {derivativesAddress}
        </div>
      )}

      {marketStats ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Recorded TVL" value={`${formatBalance(marketStats.tvl)} AGS`} />
          <StatCard label="Protocol fees" value={`${formatBalance(marketStats.fees)} AGS`} />
          <StatCard label="Contracts minted" value={String(marketStats.activeContracts)} />
          <StatCard
            label="Oracle spot (AGS)"
            value={
              marketStats.oracleSpot > 0n
                ? formatBalance(marketStats.oracleSpot, 18, 6)
                : 'No feed'
            }
            hint={
              marketStats.oracleTs > 0
                ? `updated ${new Date(marketStats.oracleTs * 1000).toLocaleString()}`
                : undefined
            }
          />
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-4 rounded-xl border border-terminal-border/50 bg-terminal-bg p-5">
          <h2 className="text-lg font-semibold text-terminal-text">Quote inputs</h2>

          <label className="block space-y-1 text-sm">
            <span className="text-terminal-text-dim">Type</span>
            <select
              className="w-full rounded border border-terminal-border/50 bg-terminal-muted/70 px-3 py-2"
              value={derivativeType}
              onChange={(e) => setDerivativeType(Number(e.target.value) as DerivativeTypeId)}
            >
              <option value={DERIVATIVE_TYPE.CALL_OPTION}>Call option</option>
              <option value={DERIVATIVE_TYPE.PUT_OPTION}>Put option</option>
            </select>
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Spot (quote / AGS)" value={spotOverride} onChange={setSpotOverride} />
            <Field label="Strike" value={strike} onChange={setStrike} />
            <Field label="Notional (AGS)" value={notional} onChange={setNotional} />
            <Field label="Your premium offer (AGS)" value={premiumOffer} onChange={setPremiumOffer} placeholder="optional" />
            <Field label="Days to expiry" value={expiryDays} onChange={setExpiryDays} />
            <Field label="Volatility %" value={volPct} onChange={setVolPct} />
            <Field label="Risk-free %" value={riskFreePct} onChange={setRiskFreePct} />
          </div>

          <p className="text-xs text-terminal-text-dim leading-relaxed">
            Volatility and risk-free rate are client-side assumptions for European Black–Scholes. They are not written
            on-chain. Settlement uses oracle spot at exercise and intrinsic math from the contract.
          </p>
        </section>

        <section className="space-y-4 rounded-xl border border-terminal-accent/30 bg-terminal-accent/5 p-5">
          <h2 className="text-lg font-semibold text-terminal-accent">Fair-value guidance</h2>

          {guidanceQuery.isLoading ? (
            <p className="text-sm text-terminal-text-dim">Computing…</p>
          ) : !g ? (
            <p className="text-sm text-terminal-text-dim">Enter valid spot, strike, and notional.</p>
          ) : (
            <div className="space-y-3 text-sm">
              <Row
                label="On-chain intrinsic (now)"
                value={`${formatBalance(g.intrinsicWei)} AGS`}
                highlight={g.inTheMoney}
              />
              <Row label="Required seller collateral" value={`${formatBalance(g.collateralWei)} AGS`} />
              <Row label="BS fair premium (total)" value={
                g.bsTotalPremiumWei != null
                  ? `${formatBalance(g.bsTotalPremiumWei)} AGS`
                  : '—'
              } />
              <Row label="Per-unit BS / intrinsic / time value" value={
                Number.isFinite(g.bsPerUnit)
                  ? `${g.bsPerUnit.toFixed(6)} / ${g.intrinsicPerUnit.toFixed(6)} / ${g.timeValuePerUnit.toFixed(6)}`
                  : '—'
              } />
              {premiumOffer.trim() ? (
                <Row
                  label="Your offer vs BS"
                  value={bpsLabel(g.premiumVsFairBps)}
                  highlight={g.premiumVsFairBps != null && Math.abs(g.premiumVsFairBps) > 1500}
                />
              ) : null}
              <Row label="Time to expiry" value={formatDuration(g.secondsToExpiry)} />
              <Row label="Assumed vol / r" value={`${volPct}% / ${riskFreePct}%`} />
            </div>
          )}

          <div className="rounded border border-terminal-border/40 bg-terminal-bg p-3 text-xs text-terminal-text-dim leading-relaxed">
            <strong className="text-terminal-text">How to use:</strong> negotiate premium near BS fair value; the chain
            only checks collateral and transfers at creation. At exercise, payoff is intrinsic — not Black–Scholes.
            ZK proof paths for create/exercise ship when the derivative circuit is in your verifier manifest.
          </div>
        </section>
      </div>
    </div>
  )
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-terminal-border/40 bg-terminal-bg p-4">
      <div className="text-xs text-terminal-text-dim">{label}</div>
      <div className="text-lg font-semibold text-terminal-text mt-1">{value}</div>
      {hint ? <div className="text-[10px] text-terminal-text-dim mt-1">{hint}</div> : null}
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="text-terminal-text-dim">{label}</span>
      <input
        className="w-full rounded border border-terminal-border/50 bg-terminal-muted/70 px-3 py-2 font-mono text-sm"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  )
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex justify-between gap-4 border-b border-terminal-border/20 pb-2">
      <span className="text-terminal-text-dim">{label}</span>
      <span className={highlight ? 'text-terminal-accent font-medium' : 'text-terminal-text font-mono'}>{value}</span>
    </div>
  )
}
