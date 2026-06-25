import { Link } from 'react-router-dom'
import { DEX_MILESTONES, milestoneStatusLabel, type MilestoneStatus } from '@/config/dexRoadmap'

function statusBadgeClass(s: MilestoneStatus): string {
  switch (s) {
    case 'shipped':
      return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
    case 'in_progress':
      return 'bg-terminal-accent/15 text-terminal-accent border-terminal-accent/40'
    case 'planned':
      return 'bg-terminal-muted/30 text-terminal-text-dim border-terminal-border/50'
  }
}

export default function DexRoadmap() {
  return (
    <div className="space-y-10 max-w-4xl">
      <header className="space-y-3">
        <p className="text-sm uppercase tracking-[0.2em] text-terminal-text-dim">Trading stack</p>
        <h1 className="text-3xl md:text-4xl font-semibold text-terminal-text leading-tight">
          DEX &amp; private trading roadmap
        </h1>
        <p className="text-terminal-text-dim leading-relaxed max-w-3xl">
          This page mirrors the repository roadmap: how Aegis grows from <strong className="text-terminal-text">AMM liquidity</strong> toward{' '}
          <strong className="text-terminal-text">limits, routing, RFQ, and long-horizon private order flow</strong> — without claiming cryptography we
          have not deployed. Milestone chips below are updated in{' '}
          <code className="text-terminal-accent">frontend/src/config/dexRoadmap.ts</code>. The canonical write-up is at the{' '}
          <strong className="text-terminal-text">monorepo root</strong>{' '}
          <code className="text-terminal-accent">docs/DEX_AND_PRIVATE_TRADING_ROADMAP.md</code> (sibling of <code className="text-terminal-accent">Aegis-contracts/</code>); a pointer file also exists at{' '}
          <code className="text-terminal-accent">Aegis-contracts/docs/DEX_AND_PRIVATE_TRADING_ROADMAP.md</code>. For the cross-cutting privacy program (token
          flags, disclosure budget, war-room checklist), see root <code className="text-terminal-accent">docs/AEGIS_HIDDEN_FORT_EXECUTION_PLAN.md</code> and the per-journey table{' '}
          <code className="text-terminal-accent">Aegis-contracts/docs/DISCLOSURE_BUDGET_MATRIX.md</code> — and use{' '}
          <Link to="/wallet" className="text-terminal-accent underline">Wallet</Link> for the recommended shield / commitment rail when your deployment
          exposes it.
        </p>
      </header>

      <section className="card border-terminal-accent/25 bg-terminal-accent/5 space-y-4">
        <h2 className="text-lg font-semibold text-terminal-accent">Milestone tracker</h2>
        <ul className="space-y-3">
          {DEX_MILESTONES.map((m) => (
            <li
              key={m.id}
              className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 border border-terminal-border/40 rounded-lg p-3 bg-terminal-bg"
            >
              <div>
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <span className="font-mono text-terminal-accent">{m.id}</span>
                  <span className="font-medium text-terminal-text">{m.title}</span>
                </div>
                <p className="text-sm text-terminal-text-dim leading-relaxed">{m.summary}</p>
              </div>
              <span
                className={`shrink-0 self-start text-xs font-medium px-2 py-1 rounded border ${statusBadgeClass(m.status)}`}
              >
                {milestoneStatusLabel(m.status)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="card space-y-3 border-terminal-border/80">
        <h2 className="text-lg font-semibold text-terminal-text">Layers (architecture)</h2>
        <dl className="text-sm text-terminal-text-dim space-y-3 leading-relaxed">
          <div>
            <dt className="text-terminal-text font-medium">Layer A — AMM</dt>
            <dd>Public depth + optional private AMM for proof-backed swaps; governance over fees, pauses, incentives.</dd>
          </div>
          <div>
            <dt className="text-terminal-text font-medium">Layer B — Execution quality</dt>
            <dd>Limits, TWAP slices, hooks, aggregation — can ship transparently first, then ZK-wrap where justified.</dd>
          </div>
          <div>
            <dt className="text-terminal-text font-medium">Layer C — RFQ / solvers</dt>
            <dd>Signed intents, bonded solvers or allowlists, fee splits — MEV-aware professional flow.</dd>
          </div>
          <div>
            <dt className="text-terminal-text font-medium">Layer D — Private order flow / CLOB-class</dt>
            <dd>Research horizon: hybrid discovery + private execution, FHE/MPC, or dedicated rollups — not a single contract toggle.</dd>
          </div>
        </dl>
      </section>

      <section className="card space-y-3 border-terminal-border/80">
        <h2 className="text-lg font-semibold text-terminal-text">Risks (always disclose)</h2>
        <ul className="list-disc pl-5 text-sm text-terminal-text-dim space-y-2 leading-relaxed">
          <li>Public pools leak intentions; private paths reduce some vectors, not all (builders, timing, prover).</li>
          <li>Oracle-linked triggers need governance parameters and monitoring.</li>
          <li>More venues fragment liquidity unless routing and incentives are co-designed.</li>
          <li>Every new trading circuit needs ceremony + manifest discipline like token proofs.</li>
        </ul>
      </section>

      <section className="card space-y-3 border-terminal-border/80">
        <h2 className="text-lg font-semibold text-terminal-text">Code starting points</h2>
        <ul className="list-disc pl-5 text-sm text-terminal-text-dim space-y-1.5 font-mono">
          <li>Aegis-contracts/contracts/PrivateAMMContract.sol</li>
          <li>Aegis-contracts/contracts/VerifierFactory.sol</li>
          <li>Aegis-contracts/contracts/PrivateTokenContract.sol</li>
          <li>Aegis-contracts/contracts/dex/README.md</li>
          <li>frontend/src/pages/Swap.tsx</li>
        </ul>
      </section>

      <div className="flex flex-wrap gap-3">
        <Link to="/swap" className="btn-primary">
          Open Swap
        </Link>
        <Link to="/wallet" className="btn-secondary">
          Wallet
        </Link>
        <Link to="/liquidity" className="btn-secondary">
          Liquidity
        </Link>
        <Link to="/governance" className="btn-secondary">
          Governance
        </Link>
        <Link to="/principles" className="btn-secondary">
          Principles
        </Link>
      </div>
    </div>
  )
}
