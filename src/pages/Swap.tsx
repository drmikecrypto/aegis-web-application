import { useMemo, useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { formatBalance } from '@/utils/format'
import { formatUnits, parseUnits, MaxUint256, solidityPackedKeccak256, randomBytes } from 'ethers'
import type { Contract, ContractTransactionResponse, Provider, Signer } from 'ethers'
import toast from 'react-hot-toast'
import { useWalletStore } from '@/store/walletStore'
import { getErc20Contract, getPublicLiquidityPoolContract, getPrivateAmmContract, getPublicPoolRouterContract } from '@/utils/contracts'
import { CONTRACT_ADDRESSES } from '@/config/contracts'
import { getPublicPoolConfigs, type PublicPoolConfig } from '@/config/liquidity'
import { proveSwap } from '@/utils/prover'
import { waitAndParseTransaction } from '@/utils/transactionHelper'
import PoolSpotStrip from '@/components/PoolSpotStrip'
import { ZkModeCaption } from '@/components/DaoModuleNotice'
import { consumeBridgeSwapIntentIfNew, resolvePoolIdFromBridgeContext } from '@/utils/bridgeSwapIntent'
import { odosAssemble, odosQuoteV3 } from '@/utils/odosSor'

type SwapDirection = 'AGS_TO_QUOTE' | 'QUOTE_TO_AGS'
type ExecutionBackend = 'aegis' | 'odos'

const AGS_DECIMALS = 18
const DEFAULT_SLIPPAGE_BPS = 50n // 0.5%

function applySlippage(amount: bigint, slippageBps: bigint): bigint {
  const basis = 10_000n
  return (amount * (basis - slippageBps)) / basis
}

function extractErrorMessage(error: unknown): string {
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    const err = error as { shortMessage?: string; data?: { message?: string }; message?: string }
    return err.shortMessage ?? err.data?.message ?? err.message ?? 'Transaction failed'
  }
  return 'Transaction failed'
}

/** When a deployed `AegisPublicPoolRouter` matches the selected pool's pair, return its best quote. */
async function publicPoolRouterQuoteIfEligible(
  router: Contract,
  selectedPool: PublicPoolConfig,
  direction: SwapDirection,
  parsedAmount: bigint
): Promise<{ bestOut: bigint; winningPool: string } | null> {
  try {
    const [agsTok, qTok, qNat, nPools] = await Promise.all([
      router.agsToken(),
      router.quoteToken(),
      router.quoteIsNative(),
      router.poolCount(),
    ])
    if (nPools === 0n) return null
    if (String(agsTok).toLowerCase() !== CONTRACT_ADDRESSES.TOKEN.toLowerCase()) return null
    const agsToQuote = direction === 'AGS_TO_QUOTE'
    if (!agsToQuote) {
      if (selectedPool.useNative !== Boolean(qNat)) return null
      if (
        !qNat &&
        (!selectedPool.tokenAddress ||
          String(qTok).toLowerCase() !== selectedPool.tokenAddress.toLowerCase())
      ) {
        return null
      }
    }
    const [winningPool, bestOut] = await router.bestQuote(agsToQuote, parsedAmount)
    return { bestOut: BigInt(bestOut as bigint), winningPool: String(winningPool) }
  } catch {
    return null
  }
}

type AegisPoolQuote = {
  amountOutRaw: bigint
  amountOutFormatted: string
  outputDecimals: number
  quoteVia: 'router' | 'pool'
  winningPool?: string
}

/** Quote via Aegis public pool router (if eligible) or direct pool — not Odos. */
async function quoteAegisPoolSwap(
  provider: Provider,
  selectedPool: PublicPoolConfig,
  direction: SwapDirection,
  parsedAmount: bigint,
  outputDecimals: number
): Promise<AegisPoolQuote | null> {
  const router = getPublicPoolRouterContract(provider)
  if (router) {
    const routed = await publicPoolRouterQuoteIfEligible(router, selectedPool, direction, parsedAmount)
    if (routed) {
      return {
        amountOutRaw: routed.bestOut,
        amountOutFormatted: formatUnits(routed.bestOut, outputDecimals),
        outputDecimals,
        quoteVia: 'router',
        winningPool: routed.winningPool,
      }
    }
  }

  const poolContract = getPublicLiquidityPoolContract(selectedPool.poolAddress, provider)
  const amountOutRaw = (await poolContract.quoteSwap(direction === 'AGS_TO_QUOTE', parsedAmount)) as bigint
  if (!amountOutRaw || amountOutRaw <= 0n) return null
  return {
    amountOutRaw,
    amountOutFormatted: formatUnits(amountOutRaw, outputDecimals),
    outputDecimals,
    quoteVia: 'pool',
  }
}

/** Execute swap on Aegis public pool router or direct pool. */
async function executeAegisPoolSwap(
  signer: Signer,
  address: string,
  provider: Provider,
  selectedPool: PublicPoolConfig,
  poolMeta: { quoteSymbol: string },
  direction: SwapDirection,
  parsedAmountIn: bigint,
  minOut: bigint,
  quoteVia: 'router' | 'pool'
): Promise<boolean> {
  const runConfirmedSwap = async (tx: ContractTransactionResponse, loadingMsg: string) => {
    toast.loading(loadingMsg, { id: 'pool-swap' })
    const receipt = await waitAndParseTransaction(tx, address, provider)
    if (receipt && receipt.status === 1) {
      toast.success('Swap confirmed on Sonic.', { id: 'pool-swap' })
      return true
    }
    toast.error('Swap transaction reverted.', { id: 'pool-swap' })
    return false
  }

  const router = getPublicPoolRouterContract(signer)
  const useRouter = quoteVia === 'router' && router !== null

  if (useRouter && router) {
    const routerAddr = await router.getAddress()
    if (direction === 'AGS_TO_QUOTE') {
      const token = getErc20Contract(CONTRACT_ADDRESSES.TOKEN, signer)
      const allowance = (await token.allowance(address, routerAddr)) as bigint
      if (allowance < parsedAmountIn) {
        const tx = await token.approve(routerAddr, MaxUint256)
        toast.loading('Approving token spend...', { id: 'approval' })
        await waitAndParseTransaction(tx, address, provider)
        toast.success('Allowance updated', { id: 'approval' })
      }
      const tx = await router.swapExactInputOnBest(true, parsedAmountIn, minOut, address)
      return runConfirmedSwap(tx, 'Swapping AGS via router…')
    }
    if (selectedPool.useNative) {
      const tx = await router.swapExactInputOnBest(false, parsedAmountIn, minOut, address, {
        value: parsedAmountIn,
      })
      return runConfirmedSwap(tx, 'Swapping S for AGS (routed)…')
    }
    if (selectedPool.tokenAddress) {
      const token = getErc20Contract(selectedPool.tokenAddress, signer)
      const allowance = (await token.allowance(address, routerAddr)) as bigint
      if (allowance < parsedAmountIn) {
        const tx = await token.approve(routerAddr, MaxUint256)
        toast.loading('Approving token spend...', { id: 'approval' })
        await waitAndParseTransaction(tx, address, provider)
        toast.success('Allowance updated', { id: 'approval' })
      }
      const tx = await router.swapExactInputOnBest(false, parsedAmountIn, minOut, address)
      return runConfirmedSwap(tx, `Swapping ${poolMeta.quoteSymbol} for AGS (routed)…`)
    }
    toast.error('Pool token address missing.')
    return false
  }

  const poolContract = getPublicLiquidityPoolContract(selectedPool.poolAddress, signer)
  if (direction === 'AGS_TO_QUOTE') {
    const token = getErc20Contract(CONTRACT_ADDRESSES.TOKEN, signer)
    const allowance = (await token.allowance(address, selectedPool.poolAddress)) as bigint
    if (allowance < parsedAmountIn) {
      const tx = await token.approve(selectedPool.poolAddress, MaxUint256)
      toast.loading('Approving token spend...', { id: 'approval' })
      await waitAndParseTransaction(tx, address, provider)
      toast.success('Allowance updated', { id: 'approval' })
    }
    const tx = await poolContract.swapExactInput(true, parsedAmountIn, minOut, address)
    return runConfirmedSwap(tx, 'Swapping AGS for liquidity token…')
  }
  if (selectedPool.useNative) {
    const tx = await poolContract.swapExactInput(false, parsedAmountIn, minOut, address, {
      value: parsedAmountIn,
    })
    return runConfirmedSwap(tx, 'Swapping S for AGS…')
  }
  if (selectedPool.tokenAddress) {
    const token = getErc20Contract(selectedPool.tokenAddress, signer)
    const allowance = (await token.allowance(address, selectedPool.poolAddress)) as bigint
    if (allowance < parsedAmountIn) {
      const tx = await token.approve(selectedPool.poolAddress, MaxUint256)
      toast.loading('Approving token spend...', { id: 'approval' })
      await waitAndParseTransaction(tx, address, provider)
      toast.success('Allowance updated', { id: 'approval' })
    }
    const tx = await poolContract.swapExactInput(false, parsedAmountIn, minOut, address)
    return runConfirmedSwap(tx, `Swapping ${poolMeta.quoteSymbol} for AGS…`)
  }
  toast.error('Pool token address missing.')
  return false
}

export default function Swap() {
  const { provider, signer, address, isConnected } = useWalletStore()
  const pools = useMemo(() => getPublicPoolConfigs(), [])
  const [searchParams] = useSearchParams()
  const [selectedPoolId, setSelectedPoolId] = useState(pools[0]?.id ?? '')
  const [direction, setDirection] = useState<SwapDirection>('QUOTE_TO_AGS')
  const [amountIn, setAmountIn] = useState('')
  const [isExecutingPoolSwap, setIsExecutingPoolSwap] = useState(false)
  const [mode, setMode] = useState<'legacy' | 'zk'>('zk')
  const [executionBackend, setExecutionBackend] = useState<ExecutionBackend>('aegis')

  useEffect(() => {
    if (!pools.length) return

    const urlPool = searchParams.get('pool')
    const urlDir = searchParams.get('direction')
    const urlAmount = searchParams.get('amount')

    const intent = consumeBridgeSwapIntentIfNew()

    const poolFromUrl = urlPool && pools.some((p) => p.id === urlPool) ? urlPool : undefined
    const poolFromIntent =
      intent &&
      resolvePoolIdFromBridgeContext(pools, {
        poolId: intent.poolId,
        tokenSymbol: intent.tokenSymbol,
        tokenAddress: intent.tokenAddress ?? undefined,
      })
    const chosenPool = poolFromUrl ?? poolFromIntent ?? undefined
    if (chosenPool) {
      setSelectedPoolId(chosenPool)
    }

    const dirFromUrl = urlDir === 'AGS_TO_QUOTE' || urlDir === 'QUOTE_TO_AGS' ? urlDir : undefined
    const dirFromIntent =
      intent?.direction === 'AGS_TO_QUOTE' || intent?.direction === 'QUOTE_TO_AGS'
        ? intent.direction
        : undefined
    const chosenDir = dirFromUrl ?? dirFromIntent
    if (chosenDir) {
      setDirection(chosenDir)
    }

    const amountFromUrl =
      urlAmount && !Number.isNaN(Number(urlAmount)) && Number(urlAmount) > 0 ? urlAmount : undefined
    const amountFromIntent =
      intent?.amount && !Number.isNaN(Number(intent.amount)) && Number(intent.amount) > 0
        ? intent.amount
        : undefined
    const chosenAmount = amountFromUrl ?? amountFromIntent
    if (chosenAmount) {
      setAmountIn(chosenAmount)
    }
  }, [searchParams, pools])

  const selectedPool = pools.find((pool) => pool.id === selectedPoolId)
  const odosEligible =
    !!selectedPool && !selectedPool.useNative && !!selectedPool.tokenAddress

  const { data: poolMeta } = useQuery({
    queryKey: ['pool-meta', selectedPool?.poolAddress, selectedPool?.tokenAddress],
    queryFn: async () => {
      if (!provider || !selectedPool) return null
      if (selectedPool.useNative) {
        return {
          quoteSymbol: selectedPool.tokenSymbol || 'S',
          quoteDecimals: 18,
          lpSymbol: selectedPool.lpSymbol,
        }
      }

      if (!selectedPool.tokenAddress) return null
      const token = getErc20Contract(selectedPool.tokenAddress, provider)
      const [symbol, decimals] = await Promise.all([
        token.symbol().catch(() => selectedPool.tokenSymbol ?? 'TOKEN'),
        token.decimals().catch(() => 18),
      ])

      return {
        quoteSymbol: symbol as string,
        quoteDecimals: Number(decimals),
        lpSymbol: selectedPool.lpSymbol,
      }
    },
    enabled: !!provider && !!selectedPool,
    staleTime: 60000,
  })

  const { data: poolBalances } = useQuery({
    queryKey: ['pool-balances', selectedPool?.poolAddress],
    queryFn: async () => {
      if (!provider || !selectedPool) return null
      const contract = getPublicLiquidityPoolContract(selectedPool.poolAddress, provider)
      const [reserves, feeBps] = await Promise.all([
        contract.getReserves(),
        contract.feeBps(),
      ])
      return {
        reserveAgs: reserves[0] as bigint,
        reserveQuote: reserves[1] as bigint,
        feeBps: feeBps as bigint,
      }
    },
    enabled: !!provider && !!selectedPool,
    refetchInterval: 12_000,
  })

  const { data: quotePreview, isFetching: quoteLoading } = useQuery<{
    amountOutRaw: bigint
    amountOutFormatted: string
    outputDecimals: number
    quoteVia: 'router' | 'pool' | 'odos'
    winningPool?: string
    odosPathId?: string
    odosUnavailable?: boolean
  } | null>({
    queryKey: [
      'pool-quote',
      selectedPool?.poolAddress,
      CONTRACT_ADDRESSES.PUBLIC_POOL_ROUTER,
      direction,
      amountIn,
      executionBackend,
      address,
    ],
    queryFn: async () => {
      if (!provider || !selectedPool || !amountIn || Number(amountIn) <= 0) return null
      const meta = poolMeta
      if (!meta) return null

      const inputDecimals = direction === 'AGS_TO_QUOTE' ? AGS_DECIMALS : meta.quoteDecimals
      const outputDecimals = direction === 'AGS_TO_QUOTE' ? meta.quoteDecimals : AGS_DECIMALS

      const parsedAmount = parseUnits(amountIn, inputDecimals)
      if (parsedAmount <= 0n) return null

      if (executionBackend === 'odos') {
        try {
          if (!selectedPool.tokenAddress || selectedPool.useNative) return null
          const net = await provider.getNetwork()
          const chainId = Number(net.chainId)

          const slippageLimitPercent = Number(DEFAULT_SLIPPAGE_BPS) / 100

          const inputTokenAddress = direction === 'AGS_TO_QUOTE' ? CONTRACT_ADDRESSES.TOKEN : selectedPool.tokenAddress
          const outputTokenAddress = direction === 'AGS_TO_QUOTE' ? selectedPool.tokenAddress : CONTRACT_ADDRESSES.TOKEN

          const quote = await odosQuoteV3({
            chainId,
            userAddr: address ?? undefined,
            inputTokenAddress,
            inputAmount: parsedAmount.toString(),
            outputTokenAddress,
            slippageLimitPercent,
          })

          const outRaw = BigInt(quote.outAmounts[0] ?? '0')
          if (!outRaw || outRaw <= 0n) return null

          return {
            amountOutRaw: outRaw,
            amountOutFormatted: formatUnits(outRaw, outputDecimals),
            outputDecimals,
            quoteVia: 'odos' as const,
            odosPathId: quote.pathId,
          }
        } catch {
          const fallback = await quoteAegisPoolSwap(provider, selectedPool, direction, parsedAmount, outputDecimals)
          if (!fallback) return null
          return { ...fallback, odosUnavailable: true }
        }
      }

      const aegis = await quoteAegisPoolSwap(provider, selectedPool, direction, parsedAmount, outputDecimals)
      return aegis
    },
    enabled: !!provider && !!selectedPool && !!poolMeta && !!amountIn && Number(amountIn) > 0,
    refetchInterval: 12_000,
    staleTime: 3_000,
  })

  async function ensureAllowance(
    tokenAddress: string,
    owner: string,
    spender: string,
    amount: bigint
  ) {
    const token = getErc20Contract(tokenAddress, signer!)
    const allowance = (await token.allowance(owner, spender)) as bigint
    if (allowance >= amount) return

    const tx = await token.approve(spender, MaxUint256)
    toast.loading('Approving token spend...', { id: 'approval' })
    await waitAndParseTransaction(tx, address!, provider!)
    toast.success('Allowance updated', { id: 'approval' })
  }

  async function handlePoolSwap() {
    if (!signer || !address) {
      toast.error('Connect your wallet to access the liquidity pools.')
      return
    }
    if (!selectedPool || !poolMeta) {
      toast.error('No liquidity pool selected.')
      return
    }
    if (!amountIn || Number(amountIn) <= 0) {
      toast.error('Enter an amount to swap.')
      return
    }

    try {
      setIsExecutingPoolSwap(true)

      const inputDecimals = direction === 'AGS_TO_QUOTE' ? AGS_DECIMALS : poolMeta.quoteDecimals
      const parsedAmountIn = parseUnits(amountIn, inputDecimals)
      if (parsedAmountIn <= 0n) {
        toast.error('Invalid amount specified.')
        return
      }

      const amountOutRaw = quotePreview?.amountOutRaw
      if (!amountOutRaw || amountOutRaw <= 0n) {
        toast.error('Unable to quote output. Check pool liquidity.')
        return
      }

      const minOut = applySlippage(amountOutRaw, DEFAULT_SLIPPAGE_BPS)

      const runAegisFromQuote = async (aegisQuote: AegisPoolQuote) => {
        const aegisMinOut = applySlippage(aegisQuote.amountOutRaw, DEFAULT_SLIPPAGE_BPS)
        const ok = await executeAegisPoolSwap(
          signer,
          address,
          provider!,
          selectedPool,
          poolMeta,
          direction,
          parsedAmountIn,
          aegisMinOut,
          aegisQuote.quoteVia
        )
        if (ok) setAmountIn('')
      }

      if (executionBackend === 'odos') {
        if (!selectedPool.tokenAddress || selectedPool.useNative) {
          toast.error('Odos mode currently requires ERC-20 pool tokens only.')
          return
        }

        if (quotePreview?.odosUnavailable) {
          const outputDecimals = direction === 'AGS_TO_QUOTE' ? poolMeta.quoteDecimals : AGS_DECIMALS
          const aegisQuote = await quoteAegisPoolSwap(
            provider!,
            selectedPool,
            direction,
            parsedAmountIn,
            outputDecimals
          )
          if (!aegisQuote) {
            toast.error('Aegis quote unavailable.')
            return
          }
          await runAegisFromQuote(aegisQuote)
          return
        }

        try {
          const net = await provider!.getNetwork()
          const chainId = Number(net.chainId)
          const slippageLimitPercent = Number(DEFAULT_SLIPPAGE_BPS) / 100

          const inputTokenAddress = direction === 'AGS_TO_QUOTE' ? CONTRACT_ADDRESSES.TOKEN : selectedPool.tokenAddress
          const outputTokenAddress = direction === 'AGS_TO_QUOTE' ? selectedPool.tokenAddress : CONTRACT_ADDRESSES.TOKEN

          toast.loading('Routing via Odos SOR…', { id: 'odos-quote' })
          const quote = await odosQuoteV3({
            chainId,
            userAddr: address!,
            inputTokenAddress,
            inputAmount: parsedAmountIn.toString(),
            outputTokenAddress,
            slippageLimitPercent,
          })

          toast.loading('Assembling Odos execution…', { id: 'odos-assemble' })
          const assembled = await odosAssemble({
            userAddr: address!,
            pathId: quote.pathId,
          })

          const txObj = assembled.transaction

          await ensureAllowance(inputTokenAddress, address!, txObj.to, parsedAmountIn)

          toast.loading('Executing Odos swap…', { id: 'odos-swap' })
          const value = BigInt(txObj.value ?? '0')
          const txResponse = await signer!.sendTransaction({
            to: txObj.to,
            data: txObj.data,
            value,
            gasLimit: txObj.gas ? BigInt(txObj.gas) : undefined,
            gasPrice: txObj.gasPrice ? BigInt(txObj.gasPrice) : undefined,
          })

          const receipt = await waitAndParseTransaction(
            txResponse as unknown as ContractTransactionResponse,
            address!,
            provider!
          )
          if (receipt && receipt.status === 1) {
            toast.success('Swap confirmed on Sonic (Odos SOR).', { id: 'odos-swap' })
            setAmountIn('')
          } else {
            toast.error('Swap transaction reverted.', { id: 'odos-swap' })
          }
          return
        } catch (e) {
          toast(`Odos unavailable — using Aegis pools. (${extractErrorMessage(e)})`, {
            id: 'odos-fallback',
          })
          const outputDecimals = direction === 'AGS_TO_QUOTE' ? poolMeta.quoteDecimals : AGS_DECIMALS
          const aegisQuote = await quoteAegisPoolSwap(
            provider!,
            selectedPool,
            direction,
            parsedAmountIn,
            outputDecimals
          )
          if (!aegisQuote) {
            toast.error('Odos and Aegis quotes both failed.', { id: 'odos-swap' })
            return
          }
          await runAegisFromQuote(aegisQuote)
          return
        }
      }

      const quoteVia: 'router' | 'pool' = quotePreview?.quoteVia === 'router' ? 'router' : 'pool'
      const ok = await executeAegisPoolSwap(
        signer,
        address,
        provider!,
        selectedPool,
        poolMeta,
        direction,
        parsedAmountIn,
        minOut,
        quoteVia
      )
      if (ok) setAmountIn('')
    } catch (error: unknown) {
      toast.error(extractErrorMessage(error), { id: 'pool-swap' })
    } finally {
      setIsExecutingPoolSwap(false)
    }
  }

  function renderQuote(selected: PublicPoolConfig | undefined) {
    if (!selected || !poolMeta) {
      return <span className="text-terminal-text-dim text-sm">Pick a pool.</span>
    }
    if (quoteLoading) {
      return <span className="text-terminal-text-dim text-sm">…</span>
    }
    if (!quotePreview) {
      return <span className="text-terminal-text-dim text-sm">Enter an amount.</span>
    }

    const feeLabel =
      quotePreview.quoteVia === 'router'
        ? 'routed'
        : quotePreview.quoteVia === 'odos'
          ? 'SOR'
          : `${(Number(poolBalances?.feeBps ?? 0n) / 100).toFixed(2)}%`

    return (
      <div className="space-y-1 text-sm">
        <div className="flex justify-between gap-3">
          <span className="text-terminal-text-dim">You receive</span>
          <span className="font-semibold text-terminal-accent text-right">
            {Number(quotePreview.amountOutFormatted).toLocaleString(undefined, { maximumFractionDigits: 6 })}{' '}
            {direction === 'AGS_TO_QUOTE' ? poolMeta.quoteSymbol : 'AGS'}
          </span>
        </div>
        <div className="flex justify-between text-xs text-terminal-text-dim">
          <span>Pool fee</span>
          <span>{feeLabel}</span>
        </div>
        <div className="text-xs text-terminal-text-dim">
          Min. after slip (~0.5%):{' '}
          {formatUnits(
            applySlippage(quotePreview.amountOutRaw, DEFAULT_SLIPPAGE_BPS),
            quotePreview.outputDecimals
          )}
        </div>
        {quotePreview.odosUnavailable && (
          <div className="text-xs text-amber-400/90">
            Odos quote unavailable — showing Aegis pool quote instead.
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header className="space-y-3">
        <div>
          <h1 className="text-2xl font-semibold text-terminal-text md:text-3xl">Swap</h1>
          <p className="mt-1 text-sm text-terminal-text-dim">
            Prices follow the selected liquidity path on Sonic. Confirm in your wallet.
          </p>
        </div>
        <PoolSpotStrip />
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-terminal-text-dim">Mode</span>
            <button
              type="button"
              onClick={() => setMode('zk')}
              className={`rounded-full border px-3 py-1 ${
                mode === 'zk'
                  ? 'border-terminal-accent bg-terminal-accent/10 text-terminal-accent'
                  : 'border-terminal-border text-terminal-text-dim hover:text-terminal-text'
              }`}
            >
              PrivateAMM
            </button>
            <button
              type="button"
              onClick={() => setMode('legacy')}
              className={`rounded-full border px-3 py-1 ${
                mode === 'legacy'
                  ? 'border-terminal-accent bg-terminal-accent/10 text-terminal-accent'
                  : 'border-terminal-border text-terminal-text-dim hover:text-terminal-text'
              }`}
            >
              Public pool
            </button>
            {mode === 'zk' && (
              <>
                <ZkModeCaption />
                <p className="text-[11px] text-terminal-text-dim max-w-xl leading-snug mt-1.5 rounded-md border border-terminal-border/40 bg-terminal-bg px-2 py-1.5">
                  <strong className="text-terminal-text">AMM honesty:</strong> public pool reserves stay visible on Sonic. This path adds a{' '}
                  <strong className="text-terminal-text">Groth16</strong> proof for the deployed{' '}
                  <code className="text-terminal-accent">private-amm</code> statement (policy / layout bounds) — not hidden liquidity.
                  Canonical copy:{' '}
                  <code className="text-terminal-accent">Aegis-contracts/docs/liquidity/PUBLIC_VS_PRIVATE_AMM.md</code>.
                </p>
              </>
            )}
          </div>
        </div>
      </header>

      {mode === 'legacy' && (
      <section className="grid gap-6 xl:grid-cols-3">
        <div className="card xl:col-span-2 space-y-6 border border-terminal-border/60 bg-terminal-surface/60 backdrop-blur">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-terminal-text">Pools</h2>
              <p className="text-sm text-terminal-text-dim">Pick a pair, enter an amount, swap.</p>
            </div>
            <div className="flex gap-2 text-xs">
              <button
                onClick={() => setDirection('QUOTE_TO_AGS')}
                className={`px-3 py-1 rounded-full border ${
                  direction === 'QUOTE_TO_AGS'
                    ? 'border-terminal-accent text-terminal-accent bg-terminal-accent/10'
                    : 'border-terminal-border text-terminal-text-dim hover:text-terminal-text'
                }`}
              >
                Quote {'->'} AGS
              </button>
              <button
                onClick={() => setDirection('AGS_TO_QUOTE')}
                className={`px-3 py-1 rounded-full border ${
                  direction === 'AGS_TO_QUOTE'
                    ? 'border-terminal-accent text-terminal-accent bg-terminal-accent/10'
                    : 'border-terminal-border text-terminal-text-dim hover:text-terminal-text'
                }`}
              >
                AGS {'->'} Quote
              </button>
            </div>
          </div>

          {pools.length === 0 ? (
            <div className="rounded-lg border border-terminal-warning/30 bg-terminal-warning/10 p-4 text-terminal-warning text-sm">
              Liquidity pools are not published yet. Once governance seeds liquidity, the pools will appear automatically.
            </div>
          ) : (
            <div className="grid md:grid-cols-2 gap-5">
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-terminal-text mb-2">Select pool</label>
                  <select
                    value={selectedPoolId}
                    onChange={(event) => setSelectedPoolId(event.target.value)}
                    className="input-field w-full"
                  >
                    {pools.map((pool) => (
                      <option key={pool.id} value={pool.id}>
                        {direction === 'AGS_TO_QUOTE' ? `AGS -> ${pool.tokenSymbol}` : `${pool.tokenSymbol} -> AGS`}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-terminal-text mb-2">
                    Amount in ({direction === 'AGS_TO_QUOTE' ? 'AGS' : poolMeta?.quoteSymbol ?? 'Token'})
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={amountIn}
                    onChange={(event) => setAmountIn(event.target.value)}
                    className="input-field w-full"
                    placeholder="0.00"
                  />
                  <p className="text-[11px] text-terminal-text-dim mt-1">
                    {direction === 'QUOTE_TO_AGS'
                      ? selectedPool?.useNative
                        ? 'Pay with native S (Sonic). Transaction value auto-filled.'
                        : 'ERC-20 spend requires a one-time approval.'
                      : 'Swapping AGS requires an allowance for the pool.'}
                  </p>
                </div>

                <div className="rounded-lg border border-terminal-border/50 bg-terminal-bg p-4">
                  <h3 className="text-sm font-semibold text-terminal-text mb-2">Quote</h3>
                  {renderQuote(selectedPool)}
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-terminal-text-dim">Execution</span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setExecutionBackend('aegis')}
                      className={`rounded-full border px-3 py-1 text-xs ${
                        executionBackend === 'aegis'
                          ? 'border-terminal-accent bg-terminal-accent/10 text-terminal-accent'
                          : 'border-terminal-border text-terminal-text-dim hover:text-terminal-text'
                      }`}
                    >
                      Aegis router
                    </button>
                    <button
                      type="button"
                      onClick={() => setExecutionBackend('odos')}
                      disabled={!odosEligible}
                      className={`rounded-full border px-3 py-1 text-xs ${
                        executionBackend === 'odos'
                          ? 'border-terminal-accent bg-terminal-accent/10 text-terminal-accent'
                          : 'border-terminal-border text-terminal-text-dim hover:text-terminal-text'
                      } ${!odosEligible ? 'opacity-50 cursor-not-allowed' : ''}`}
                      title={!odosEligible ? 'Odos mode requires an ERC-20 (non-native) pool token.' : 'Route through Odos SOR'}
                    >
                      Odos SOR
                    </button>
                  </div>
                </div>
                {executionBackend === 'odos' && (
                  <p className="text-[11px] text-terminal-text-dim">
                    Odos is a router over public Sonic DEX liquidity (e.g. Uniswap v3) — you do not deposit liquidity
                    into Odos. AGS depth comes from venues Odos indexes; post-auction Uniswap seeding is handled by{' '}
                    <code className="text-[10px]">AutomatedLiquidityDeployer</code>. If Odos fails, execution falls back
                    to Aegis pools automatically.
                  </p>
                )}
                <div className="rounded-lg border border-terminal-border/40 bg-terminal-bg p-4 text-sm space-y-2">
                  <div className="flex justify-between">
                    <span className="text-terminal-text-dim">Pool reserves</span>
                    <span className="font-semibold text-terminal-text">
                      {poolBalances
                        ? `${formatBalance(poolBalances.reserveAgs)} AGS / ${formatBalance(poolBalances.reserveQuote)} ${poolMeta?.quoteSymbol ?? ''}`
                        : '--'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-terminal-text-dim">LP token</span>
                    <span className="text-terminal-text">{poolMeta?.lpSymbol ?? 'LP token pending'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-terminal-text-dim">Fee</span>
                    <span className="text-terminal-text">
                      {(Number(poolBalances?.feeBps ?? 0n) / 100).toFixed(2)}%
                    </span>
                  </div>
                </div>

                <button
                  onClick={handlePoolSwap}
                  className="btn-primary w-full"
                  disabled={
                    !isConnected ||
                    !selectedPool ||
                    isExecutingPoolSwap ||
                    !amountIn ||
                    Number(amountIn) <= 0 ||
                    !quotePreview
                  }
                >
                  {isExecutingPoolSwap
                    ? 'Swapping...'
                    : direction === 'AGS_TO_QUOTE'
                      ? `Swap AGS -> ${poolMeta?.quoteSymbol ?? 'Token'}`
                      : `Swap ${selectedPool?.tokenSymbol ?? 'Token'} -> AGS`}
                </button>

                {!isConnected && <p className="text-xs text-terminal-text-dim">Connect your wallet to swap.</p>}
              </div>
            </div>
          )}
        </div>
        <aside className="space-y-5">
          <div className="card border border-terminal-accent/40 bg-terminal-accent/10 space-y-3">
            <h3 className="text-terminal-accent font-semibold text-base">PrivateAMM (proof-backed)</h3>
            <p className="text-sm text-terminal-text-dim">Prove in browser, then submit. Pool depth remains public on-chain.</p>
            <button
              className="btn-secondary w-full"
              disabled={!isConnected || !selectedPool || !poolMeta || !amountIn || Number(amountIn) <= 0}
              onClick={async () => {
                try {
                  if (!signer || !selectedPool || !poolMeta) return
                  const amm = getPrivateAmmContract(signer)
                  const tokenA = CONTRACT_ADDRESSES.TOKEN
                  const tokenB = selectedPool.tokenAddress ?? '0x0000000000000000000000000000000000000000'
                  const poolId = solidityPackedKeccak256(['address', 'address'], [tokenA, tokenB])

                  const inputDecimals = direction === 'AGS_TO_QUOTE' ? AGS_DECIMALS : poolMeta.quoteDecimals
                  const parsedAmountIn = parseUnits(amountIn, inputDecimals)
                  if (parsedAmountIn <= 0n) throw new Error('Invalid amount')

                  const minOut = applySlippage(quotePreview?.amountOutRaw ?? 0n, DEFAULT_SLIPPAGE_BPS)
                  const deadline = Math.floor(Date.now() / 1000) + 600
                  const isAToB = direction === 'AGS_TO_QUOTE'

                  const inputNullifier = '0x' + Buffer.from(randomBytes(32)).toString('hex')
                  const outputCommitment = '0x' + Buffer.from(randomBytes(32)).toString('hex')

                  const witness = {
                    poolId,
                    inputNullifier,
                    outputCommitment,
                    amountIn: parsedAmountIn.toString(),
                    minAmountOut: minOut.toString(),
                    isAToB: isAToB ? 1 : 0,
                    deadline,
                  }

                  const { proof, publicInputs } = await proveSwap(witness)
                  const tx = await amm.swap(poolId, proof, publicInputs)
                  toast.loading('Submitting PrivateAMM swap...', { id: 'private-swap' })
                  const rc = await waitAndParseTransaction(tx, address!, provider!)
                  if (rc && rc.status === 1) {
                    toast.success('PrivateAMM swap confirmed', { id: 'private-swap' })
                  } else {
                    toast.error('PrivateAMM swap reverted', { id: 'private-swap' })
                  }
                } catch (e) {
                  toast.error(extractErrorMessage(e))
                }
              }}
            >
              Execute PrivateAMM swap
            </button>
          </div>
          <div className="card border border-terminal-accent/40 bg-terminal-accent/10 space-y-3">
            <h3 className="text-terminal-accent font-semibold text-base">Sale</h3>
            <p className="text-sm text-terminal-text-dim">Public sale portal.</p>
            <a
              href="https://aegiscoin.sonic"
              target="_blank"
              rel="noreferrer"
              className="btn-secondary w-full text-center"
            >
              Open sale
            </a>
          </div>
        </aside>
      </section>
      )}

      {mode === 'zk' && (
      <section className="grid gap-6">
        <div className="card space-y-4 border border-terminal-accent/40 bg-terminal-accent/10">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1 min-w-0">
              <h2 className="text-xl font-semibold text-terminal-accent">PrivateAMM</h2>
              <p className="text-sm text-terminal-text-dim leading-relaxed max-w-2xl">
                Groth16 policy proof for the deployed <code className="text-terminal-accent">private-amm</code> circuit —{' '}
                <strong className="text-terminal-text">pool reserves stay public</strong> on Sonic. See{' '}
                <code className="text-terminal-accent">Aegis-contracts/docs/liquidity/PUBLIC_VS_PRIVATE_AMM.md</code>.
              </p>
            </div>
            <span className="text-xs text-terminal-text-dim shrink-0">Proof then send</span>
          </div>
          <div className="grid md:grid-cols-2 gap-5">
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-terminal-text mb-2">Select pool</label>
                <select
                  value={selectedPoolId}
                  onChange={(event) => setSelectedPoolId(event.target.value)}
                  className="input-field w-full"
                >
                  {pools.map((pool) => (
                    <option key={pool.id} value={pool.id}>
                      {direction === 'AGS_TO_QUOTE' ? `AGS -> ${pool.tokenSymbol}` : `${pool.tokenSymbol} -> AGS`}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex gap-2 text-xs">
                <button
                  onClick={() => setDirection('QUOTE_TO_AGS')}
                  className={`px-3 py-1 rounded-full border ${
                    direction === 'QUOTE_TO_AGS'
                      ? 'border-terminal-accent text-terminal-accent bg-terminal-accent/10'
                      : 'border-terminal-border text-terminal-text-dim hover:text-terminal-text'
                  }`}
                >
                  Quote {'->'} AGS
                </button>
                <button
                  onClick={() => setDirection('AGS_TO_QUOTE')}
                  className={`px-3 py-1 rounded-full border ${
                    direction === 'AGS_TO_QUOTE'
                      ? 'border-terminal-accent text-terminal-accent bg-terminal-accent/10'
                      : 'border-terminal-border text-terminal-text-dim hover:text-terminal-text'
                  }`}
                >
                  AGS {'->'} Quote
                </button>
              </div>
              <div>
                <label className="block text-sm font-medium text-terminal-text mb-2">
                  Amount in ({direction === 'AGS_TO_QUOTE' ? 'AGS' : poolMeta?.quoteSymbol ?? 'Token'})
                </label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={amountIn}
                  onChange={(event) => setAmountIn(event.target.value)}
                  className="input-field w-full"
                  placeholder="0.00"
                />
              </div>
            </div>
            <div className="space-y-4">
              <div className="rounded-lg border border-terminal-border/50 bg-terminal-bg p-4 text-sm">
                <p className="text-terminal-text-dim mb-2">
                  Same proof rail as the sidebar quick action — not hidden on-chain reserves.
                </p>
                <p className="text-[11px] text-terminal-text-dim">Minimum received (0.5% slippage) and deadline are computed locally.</p>
              </div>
              <button
                className="btn-secondary w-full"
                disabled={!isConnected || !selectedPool || !poolMeta || !amountIn || Number(amountIn) <= 0}
                onClick={async () => {
                  try {
                    if (!signer || !selectedPool || !poolMeta) return
                    const amm = getPrivateAmmContract(signer)
                    const tokenA = CONTRACT_ADDRESSES.TOKEN
                    const tokenB = selectedPool.tokenAddress ?? '0x0000000000000000000000000000000000000000'
                    const poolId = solidityPackedKeccak256(['address', 'address'], [tokenA, tokenB])

                    const inputDecimals = direction === 'AGS_TO_QUOTE' ? AGS_DECIMALS : poolMeta.quoteDecimals
                    const parsedAmountIn = parseUnits(amountIn, inputDecimals)
                    if (parsedAmountIn <= 0n) throw new Error('Invalid amount')

                    const minOut = applySlippage(quotePreview?.amountOutRaw ?? 0n, DEFAULT_SLIPPAGE_BPS)
                    const deadline = Math.floor(Date.now() / 1000) + 600
                    const isAToB = direction === 'AGS_TO_QUOTE'

                    const inputNullifier = '0x' + Buffer.from(randomBytes(32)).toString('hex')
                    const outputCommitment = '0x' + Buffer.from(randomBytes(32)).toString('hex')

                    const witness = {
                      poolId,
                      inputNullifier,
                      outputCommitment,
                      amountIn: parsedAmountIn.toString(),
                      minAmountOut: minOut.toString(),
                      isAToB: isAToB ? 1 : 0,
                      deadline,
                    }

                    const { proof, publicInputs } = await proveSwap(witness)
                    const tx = await amm.swap(poolId, proof, publicInputs)
                    toast.loading('Submitting PrivateAMM swap...', { id: 'private-swap' })
                    const rc = await waitAndParseTransaction(tx, address!, provider!)
                    if (rc && rc.status === 1) {
                      toast.success('PrivateAMM swap confirmed', { id: 'private-swap' })
                    } else {
                      toast.error('PrivateAMM swap reverted', { id: 'private-swap' })
                    }
                  } catch (e) {
                    toast.error(extractErrorMessage(e))
                  }
                }}
              >
                Execute PrivateAMM swap
              </button>
            </div>
          </div>
        </div>
      </section>
      )}
    </div>
  )
}
