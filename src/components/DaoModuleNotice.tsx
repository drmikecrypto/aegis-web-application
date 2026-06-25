import { type ReactNode } from 'react'
import { Link } from 'react-router-dom'

type Props = {
  /** One short honest paragraph for this module (what the contracts do / do not guarantee). */
  children: ReactNode
}

/**
 * Shared trust framing for every financial module — aligns with `docs/DAO_TRUST_CONTRACT.md`.
 */
export default function DaoModuleNotice({ children }: Props) {
  return (
    <div className="rounded-lg border border-terminal-border/50 bg-terminal-bg px-4 py-3 text-sm text-terminal-text-dim leading-relaxed space-y-2">
      <div>{children}</div>
      <p className="text-xs border-t border-terminal-border/40 pt-2 text-terminal-text-dim/95">
        <Link to="/principles" className="text-terminal-accent underline-offset-2 hover:underline">
          Principles &amp; DAO trust contract
        </Link>
        : Aegis is a DAO — the same on-chain voting rules apply to every address with voting power, including launch
        allocation. This UI must not promise more than deployed bytecode; read contracts for worst-case loss, delays, and
        oracle or liquidity assumptions before sizing positions.
      </p>
    </div>
  )
}

/** Honest caption for ZK mode toggles (replaces vague “anonymity” claims). */
export function ZkModeCaption() {
  return (
    <span className="text-xs text-terminal-text-dim max-w-md text-left">
      ZK path: proves only what the deployed verifiers encode for this flow — not blanket L1 privacy.
    </span>
  )
}
