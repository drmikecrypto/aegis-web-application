/**
 * Milestone status for the in-app DEX / trading roadmap.
 * Update when deployments or features ship — keep honest vs marketing.
 * Canonical narrative: monorepo root `docs/DEX_AND_PRIVATE_TRADING_ROADMAP.md`
 * (pointer: `Aegis-contracts/docs/DEX_AND_PRIVATE_TRADING_ROADMAP.md`).
 */
export type MilestoneStatus = 'shipped' | 'in_progress' | 'planned'

export type DexMilestone = {
  id: string
  title: string
  status: MilestoneStatus
  summary: string
}

export const DEX_MILESTONES: DexMilestone[] = [
  {
    id: 'M0',
    title: 'Mainnet AMM + honest copy',
    status: 'in_progress',
    summary:
      'Public pool swaps and LP flows exist in-app when pools are configured and deployed; verify addresses on SonicScan before size.',
  },
  {
    id: 'M1',
    title: 'Production PrivateAMM path',
    status: 'in_progress',
    summary:
      'Proof-backed PrivateAMM UI + wiring — ceremony + verifiers + prover infra. Messaging: public pool depth stays on-chain visible; `private-amm` proves policy/layout (see `Aegis-contracts/docs/liquidity/PUBLIC_VS_PRIVATE_AMM.md`).',
  },
  {
    id: 'M2',
    title: 'Governed routing',
    status: 'in_progress',
    summary:
      '`AegisPublicPoolRouter` in Aegis-contracts: governance allowlist + `bestQuote` / `swapExactInputOnBest`. Swap uses it when `VITE_PUBLIC_POOL_ROUTER_ADDRESS` is set and the pair matches the selected pool. TWAP / oracle guardrails still open.',
  },
  {
    id: 'M3',
    title: 'Limit orders (transparent settlement)',
    status: 'shipped',
    summary:
      '`TransparentEscrowOrders` (AGS fixed sells) + `SignedLimitOrderRegistry` (EIP-712 ERC20 limits, escrow) in Aegis-contracts. Full matcher / hybrid relayer still planned.',
  },
  {
    id: 'M4',
    title: 'RFQ / intent v1',
    status: 'shipped',
    summary:
      '`RFQIntentSettlement` (EIP-712 one-shot atomic RFQ) shipped; solver registry, bonds, and monitoring still planned. Operator doc: `docs/RFQ_V1_OPERATOR_GUIDE.md`.',
  },
  {
    id: 'M5',
    title: 'ZK-wrapped advanced execution',
    status: 'planned',
    summary: 'Per-feature circuits where proof latency and audit budget justify confidentiality.',
  },
  {
    id: 'M6',
    title: 'Private order-flow / CLOB-class R&D',
    status: 'planned',
    summary: 'Research program only — hybrid discovery + private execution, FHE/MPC, or app-chain; not an L1 config toggle.',
  },
]

export function milestoneStatusLabel(s: MilestoneStatus): string {
  switch (s) {
    case 'shipped':
      return 'Shipped'
    case 'in_progress':
      return 'In progress'
    case 'planned':
      return 'Planned'
  }
}
