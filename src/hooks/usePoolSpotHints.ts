import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { formatUnits, parseUnits } from 'ethers'

import { useWalletStore } from '@/store/walletStore'
import { getPublicPoolConfigs } from '@/config/liquidity'
import { getPublicLiquidityPoolContract, getErc20Contract } from '@/utils/contracts'

export type PoolSpotHint = {
  poolId: string
  /** Short label, e.g. USDC, wS */
  label: string
  /** AGS received for exactly 1.0 quote token (human units), from on-chain `quoteSwap`. */
  agsForOneQuote: string | null
  /** Quote received for exactly 1.0 AGS (18 decimals). */
  quoteForOneAgs: string | null
}

/**
 * Live mid-ish prices from each deployed public pool (same path as swaps: `quoteSwap`).
 * Refreshes on an interval so UI stays aligned with pool state without a separate oracle.
 */
export function usePoolSpotHints() {
  const { provider } = useWalletStore()
  const pools = useMemo(() => getPublicPoolConfigs(), [])

  return useQuery({
    queryKey: ['pool-spot-hints', pools.map((p) => p.poolAddress).join('|')],
    queryFn: async (): Promise<PoolSpotHint[]> => {
      if (!provider || pools.length === 0) return []

      const out: PoolSpotHint[] = []
      for (const p of pools) {
        const pool = getPublicLiquidityPoolContract(p.poolAddress, provider)
        let quoteDecimals = 18
        if (!p.useNative && p.tokenAddress) {
          const erc = getErc20Contract(p.tokenAddress, provider)
          quoteDecimals = Number(await erc.decimals().catch(() => 18))
        }

        const label = (p.tokenSymbol || p.id).replace(/\s+/g, ' ').trim()

        let agsForOneQuote: string | null = null
        let quoteForOneAgs: string | null = null
        try {
          const oneQuote = parseUnits('1', quoteDecimals)
          const agsOut = (await pool.quoteSwap(false, oneQuote)) as bigint
          agsForOneQuote = formatUnits(agsOut, 18)

          const oneAgs = parseUnits('1', 18)
          const quoteOut = (await pool.quoteSwap(true, oneAgs)) as bigint
          quoteForOneAgs = formatUnits(quoteOut, quoteDecimals)
        } catch {
          // zero liquidity or reverts — omit row
        }

        out.push({ poolId: p.id, label, agsForOneQuote, quoteForOneAgs })
      }
      return out
    },
    enabled: !!provider && pools.length > 0,
    refetchInterval: 12_000,
    staleTime: 4_000,
  })
}
