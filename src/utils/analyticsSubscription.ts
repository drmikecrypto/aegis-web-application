import { Contract, type Provider } from 'ethers'

import { ZERO_ADDRESS } from '@/config/contracts'

const ROUTER_READ_ABI = [
  'function hasAnalyticsSubscription(address user) view returns (bool)',
  'function analyticsAccessUntil(address user) view returns (uint256)',
  'function analyticsMinPriceWei() view returns (uint256)',
] as const

export async function readAnalyticsSubscription(
  provider: Provider,
  routerAddress: string,
  walletAddress: string
): Promise<{ active: boolean; until: bigint; minPriceWei: bigint }> {
  if (!routerAddress || routerAddress === ZERO_ADDRESS || !walletAddress) {
    return { active: false, until: 0n, minPriceWei: 0n }
  }
  const c = new Contract(routerAddress, ROUTER_READ_ABI, provider)
  const [active, until, minPriceWei] = await Promise.all([
    c.hasAnalyticsSubscription!(walletAddress),
    c.analyticsAccessUntil!(walletAddress),
    c.analyticsMinPriceWei!(),
  ])
  return { active: Boolean(active), until: BigInt(until), minPriceWei: BigInt(minPriceWei) }
}
