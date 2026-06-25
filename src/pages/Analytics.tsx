import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { formatUnits, isAddress, parseUnits } from 'ethers'
import toast from 'react-hot-toast'

import DaoModuleNotice from '@/components/DaoModuleNotice'
import { CONTRACT_ADDRESSES, ZERO_ADDRESS } from '@/config/contracts'
import { useWalletStore } from '@/store/walletStore'
import { readAnalyticsSubscription } from '@/utils/analyticsSubscription'
import { fetchRpcFeeSummary } from '@/utils/onchainAnalyticsApi'
import { formatAddress } from '@/utils/format'
import { getDaoRevenueRouterContract, getTokenContract } from '@/utils/contracts'

type Tab = 'wallet' | 'token' | 'whales' | 'network'

function envSubWei(): bigint {
  const raw = (import.meta.env.VITE_ANALYTICS_SUB_PRICE_WEI as string | undefined)?.trim()
  if (!raw) return parseUnits('5', 18)
  try {
    return BigInt(raw)
  } catch {
    return parseUnits('5', 18)
  }
}

function IndexedDataNotice() {
  return (
    <div className="rounded-lg border border-terminal-border/40 p-4 bg-terminal-bg text-sm text-terminal-text-dim max-w-3xl space-y-2">
      <p>
        Indexed <strong className="text-terminal-text">native</strong> and{' '}
        <strong className="text-terminal-text">ERC-20</strong> transfer lists are not shipped from this static app: we
        do not embed Etherscan (or other) API keys in the browser bundle.
      </p>
      <p>
        Use your chain explorer for full wallet history (e.g.{' '}
        <a className="text-terminal-accent underline" href="https://sonicscan.org" target="_blank" rel="noreferrer">
          SonicScan
        </a>
        ). The <strong className="text-terminal-text">Network</strong> tab still reads fee hints from your connected RPC.
      </p>
    </div>
  )
}

export default function Analytics() {
  const queryClient = useQueryClient()
  const { provider, signer, address, chainId, isConnected } = useWalletStore()
  const [tab, setTab] = useState<Tab>('network')
  const [walletInput, setWalletInput] = useState('')

  const subWei = useMemo(() => envSubWei(), [])
  const router = provider ? getDaoRevenueRouterContract(provider) : null
  const routerAddr = CONTRACT_ADDRESSES.DAO_REVENUE_ROUTER

  const watchAddr = useMemo(() => {
    const w = walletInput.trim()
    if (isAddress(w)) return w
    if (address && isAddress(address)) return address
    return ''
  }, [walletInput, address])

  const subscriptionQuery = useQuery({
    queryKey: ['analytics-onchain-sub', routerAddr, address, chainId],
    queryFn: async () => {
      if (!provider || !address || routerAddr === ZERO_ADDRESS) {
        return { active: false, until: 0n, minPriceWei: 0n }
      }
      return readAnalyticsSubscription(provider, routerAddr, address)
    },
    enabled: !!provider && !!address && routerAddr !== ZERO_ADDRESS,
    refetchInterval: 45_000,
  })

  const subscribed = subscriptionQuery.data?.active === true
  const subUntil = subscriptionQuery.data?.until ?? 0n
  const onChainMin = subscriptionQuery.data?.minPriceWei ?? 0n

  const networkQuery = useQuery({
    queryKey: ['analytics-network', !!provider, chainId],
    queryFn: async () => {
      let block: number | null = null
      let fees = null as Awaited<ReturnType<typeof fetchRpcFeeSummary>>
      if (provider) {
        block = await provider.getBlockNumber()
        fees = await fetchRpcFeeSummary(provider)
      }
      return { block, fees }
    },
    refetchInterval: 60_000,
    enabled: !!provider,
  })

  const splitQuery = useQuery({
    queryKey: ['analytics-router-split', routerAddr],
    queryFn: async () => {
      if (!router) return null
      const [g, i, e] = await router.effectiveSplitBps()
      return { g, i, e }
    },
    enabled: !!router && routerAddr !== ZERO_ADDRESS,
    staleTime: 30_000,
  })

  async function payPro() {
    if (!signer || !isConnected) {
      toast.error('Connect your wallet first.')
      return
    }
    if (!chainId) {
      toast.error('Connect to a network first.')
      return
    }
    const r = getDaoRevenueRouterContract(signer)
    if (!r) {
      toast.error('VITE_DAO_REVENUE_ROUTER_ADDRESS is not configured.')
      return
    }
    if (onChainMin > 0n && subWei < onChainMin) {
      toast.error(
        `Payment amount is below on-chain analyticsMinPriceWei (${formatUnits(onChainMin, 18)} AGS). Raise VITE_ANALYTICS_SUB_PRICE_WEI or ask governance to lower the minimum.`
      )
      return
    }
    try {
      const token = getTokenContract(signer)
      const me = await signer.getAddress()
      const cur = await token.allowance(me, await r.getAddress())
      if (cur < subWei) {
        const tx = await token.approve(await r.getAddress(), subWei)
        await tx.wait()
      }
      const tx2 = await r.payAndRoute(subWei)
      await tx2.wait()
      await queryClient.invalidateQueries({ queryKey: ['analytics-onchain-sub'] })
      toast.success('Payment confirmed — on-chain analytics access window updated.')
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Payment failed'
      toast.error(msg)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-terminal-accent mb-2">On-chain analytics</h1>
        <p className="text-terminal-text-dim max-w-3xl">
          Live reads use your <strong className="text-terminal-text">wallet RPC</strong> (block height, fee hints,
          router split). Optional <strong className="text-terminal-text">on-chain subscription</strong> on{' '}
          <code className="text-terminal-accent">DaoDynamicRevenueRouter</code> records{' '}
          <code className="text-terminal-accent">analyticsAccessUntil</code> for future gated backends — not for a
          bundled indexer in this repo.
        </p>
      </div>

      <DaoModuleNotice>
        <p>
          <strong className="text-terminal-text">Subscription:</strong> enforced on-chain via{' '}
          <code className="text-terminal-accent">analyticsAccessUntil[wallet]</code> after{' '}
          <code className="text-terminal-accent">payAndRoute</code> when amount ≥ governance-set{' '}
          <code className="text-terminal-accent">analyticsMinPriceWei</code>. The app reads this with your RPC — not
          from localStorage.
        </p>
      </DaoModuleNotice>

      <div className="flex flex-wrap gap-4 items-end border border-terminal-border/40 rounded-lg p-4 bg-terminal-bg">
        <label className="flex flex-col gap-1 text-sm flex-1 min-w-[200px]">
          <span className="text-terminal-text-dim">Wallet to inspect (for SonicScan links later)</span>
          <input
            className="bg-terminal-muted/30 border border-terminal-border rounded px-3 py-2 font-mono text-sm"
            placeholder="0x…"
            value={walletInput}
            onChange={(e) => setWalletInput(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="px-3 py-2 rounded border border-terminal-border text-sm hover:bg-terminal-muted/30"
          onClick={() => address && setWalletInput(address)}
        >
          Use connected
        </button>
      </div>

      <div className="flex flex-wrap gap-3 text-sm text-terminal-text-dim">
        {watchAddr && (
          <span>
            Selected: <strong className="text-terminal-accent font-mono">{formatAddress(watchAddr)}</strong>
          </span>
        )}
        {address && routerAddr !== ZERO_ADDRESS && (
          <span>
            On-chain subscription:{' '}
            <strong className={subscribed ? 'text-terminal-accent' : 'text-terminal-text'}>
              {subscribed ? 'active' : 'inactive'}
            </strong>
            {subscribed && subUntil > 0n && (
              <span className="ml-2">(until {new Date(Number(subUntil) * 1000).toLocaleString()})</span>
            )}
          </span>
        )}
      </div>

      {router && splitQuery.data && (
        <div className="rounded-lg border border-terminal-border/50 bg-terminal-bg p-4 text-sm">
          <p className="text-terminal-text-dim mb-2">Live revenue split (basis points) for next payment</p>
          <div className="flex flex-wrap gap-6 font-mono">
            <span>
              Gov: <strong className="text-terminal-accent">{splitQuery.data.g}</strong>
            </span>
            <span>
              Insurance: <strong className="text-terminal-accent">{splitQuery.data.i}</strong>
            </span>
            <span>
              Ecosystem: <strong className="text-terminal-accent">{splitQuery.data.e}</strong>
            </span>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {(['network', 'wallet', 'token', 'whales'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-lg text-sm border ${
              tab === t
                ? 'bg-terminal-accent/20 border-terminal-accent text-terminal-accent'
                : 'border-terminal-border/50 text-terminal-text-dim hover:bg-terminal-muted/20'
            }`}
          >
            {t === 'wallet' && 'Wallet'}
            {t === 'token' && 'Token flow'}
            {t === 'whales' && 'Whale-lite'}
            {t === 'network' && 'Network'}
          </button>
        ))}
      </div>

      {tab === 'network' && (
        <div className="space-y-3 rounded-lg border border-terminal-border/40 p-4 bg-terminal-bg">
          <h2 className="text-lg font-semibold text-terminal-text">Network</h2>
          {!provider && <p className="text-terminal-text-dim">Connect a wallet to load block height and fee data.</p>}
          {networkQuery.isLoading && <p className="text-terminal-text-dim">Loading…</p>}
          {networkQuery.error && (
            <p className="text-red-400/90">{(networkQuery.error as Error).message}</p>
          )}
          {networkQuery.data && (
            <ul className="space-y-2 text-sm font-mono">
              <li>
                Latest block (wallet RPC):{' '}
                <strong className="text-terminal-text">
                  {networkQuery.data.block != null ? networkQuery.data.block : '—'}
                </strong>
              </li>
              {networkQuery.data.fees && (
                <>
                  <li>gasPrice: {networkQuery.data.fees.gasPriceGwei}</li>
                  <li>maxFeePerGas: {networkQuery.data.fees.maxFeePerGasGwei}</li>
                  <li>maxPriorityFeePerGas: {networkQuery.data.fees.maxPriorityFeePerGasGwei}</li>
                </>
              )}
            </ul>
          )}
        </div>
      )}

      {(tab === 'wallet' || tab === 'token' || tab === 'whales') && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-terminal-text">
            {tab === 'wallet' && 'Wallet (native transfers)'}
            {tab === 'token' && 'Token flow'}
            {tab === 'whales' && 'Whale-lite'}
          </h2>
          <IndexedDataNotice />
        </div>
      )}

      <div className="rounded-lg border border-terminal-accent/30 bg-terminal-accent/5 p-4 space-y-3">
        <h2 className="text-lg font-semibold text-terminal-text">Subscribe (on-chain)</h2>
        <p className="text-sm text-terminal-text-dim max-w-2xl">
          Pay <strong className="text-terminal-text">{formatUnits(subWei, 18)}</strong> AGS via{' '}
          <code className="text-terminal-accent">payAndRoute</code> (env{' '}
          <code className="text-terminal-accent">VITE_ANALYTICS_SUB_PRICE_WEI</code>
          ). Governance must set <code className="text-terminal-accent">analyticsMinPriceWei</code> ≤ this amount and{' '}
          <code className="text-terminal-accent">analyticsSubscriptionDurationSeconds</code> or the receipt will not
          extend. Funds still split per <code className="text-terminal-accent">effectiveSplitBps()</code>.
        </p>
        <button
          type="button"
          disabled={!router || routerAddr === ZERO_ADDRESS}
          onClick={() => void payPro()}
          className="px-4 py-2 rounded-lg bg-terminal-accent text-black font-medium disabled:opacity-40"
        >
          Pay with AGS (extends on-chain access)
        </button>
        {(!router || routerAddr === ZERO_ADDRESS) && (
          <p className="text-xs text-terminal-text-dim">Deploy &amp; set VITE_DAO_REVENUE_ROUTER_ADDRESS to enable.</p>
        )}
      </div>
    </div>
  )
}
