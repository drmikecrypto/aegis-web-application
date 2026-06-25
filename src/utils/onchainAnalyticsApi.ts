/**
 * Helpers for the in-app Analytics page.
 *
 * Indexed wallet / token transfer lists are not shipped from this static app (no Etherscan
 * API key in the browser bundle). Use your wallet RPC for fee hints and a block explorer
 * for full account history.
 */
import type { Provider } from 'ethers'
import { formatUnits } from 'ethers'

export type TokenTxRow = {
  hash: string
  from: string
  to: string
  value: string
  contractAddress: string
  tokenSymbol?: string
  tokenDecimal?: string
  timeStamp: string
  blockNumber: string
}

export type RpcFeeSummary = {
  gasPriceGwei: string
  maxFeePerGasGwei: string
  maxPriorityFeePerGasGwei: string
}

export async function fetchRpcFeeSummary(provider: Provider): Promise<RpcFeeSummary | null> {
  try {
    const fd = await provider.getFeeData()
    const gwei = (n: bigint | null | undefined) =>
      n == null ? '—' : `${formatUnits(n, 'gwei')} gwei`
    return {
      gasPriceGwei: gwei(fd.gasPrice),
      maxFeePerGasGwei: gwei(fd.maxFeePerGas),
      maxPriorityFeePerGasGwei: gwei(fd.maxPriorityFeePerGas),
    }
  } catch {
    return null
  }
}

function tokenTxValueWei(row: TokenTxRow): bigint {
  try {
    return BigInt(row.value || '0')
  } catch {
    return 0n
  }
}

/** Aggregate absolute token transfer volume by address (whale-lite heuristic). */
export function aggregateTokenFlowWhales(rows: TokenTxRow[], topN = 15) {
  const scores = new Map<string, bigint>()
  for (const r of rows) {
    const v = tokenTxValueWei(r)
    if (v === 0n) continue
    const a = r.from.toLowerCase()
    const b = r.to.toLowerCase()
    scores.set(a, (scores.get(a) ?? 0n) + v)
    scores.set(b, (scores.get(b) ?? 0n) + v)
  }
  return [...scores.entries()]
    .sort((x, y) => (y[1] > x[1] ? 1 : y[1] < x[1] ? -1 : 0))
    .slice(0, topN)
    .map(([addr, vol]) => ({ address: addr, volumeWei: vol }))
}

export type TokenFlowSummary = {
  inCount: number
  outCount: number
  inVolumeWei: bigint
  outVolumeWei: bigint
  watch: string
}

export function summarizeTokenFlows(rows: TokenTxRow[], watch: string): TokenFlowSummary {
  const w = watch.toLowerCase()
  let inCount = 0
  let outCount = 0
  let inVolumeWei = 0n
  let outVolumeWei = 0n
  for (const r of rows) {
    const v = tokenTxValueWei(r)
    const to = r.to.toLowerCase()
    const from = r.from.toLowerCase()
    if (to === w) {
      inCount++
      inVolumeWei += v
    }
    if (from === w) {
      outCount++
      outVolumeWei += v
    }
  }
  return { inCount, outCount, inVolumeWei, outVolumeWei, watch }
}
