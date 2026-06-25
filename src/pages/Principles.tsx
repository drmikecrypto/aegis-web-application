import { Link } from 'react-router-dom'

/**
 * In-repo counterpart to docs/FOUNDING_PRINCIPLES.md and docs/DAO_TRUST_CONTRACT.md —
 * readable inside the static dApp (Arweave) without fetching markdown.
 */
export default function Principles() {
  return (
    <div className="space-y-10 max-w-3xl">
      <header className="space-y-3">
        <p className="text-sm uppercase tracking-[0.2em] text-terminal-text-dim">Read first</p>
        <h1 className="text-3xl md:text-4xl font-semibold text-terminal-text leading-tight">
          Founding principles
        </h1>
        <p className="text-terminal-text-dim leading-relaxed">
          Aegis is <strong className="text-terminal-text">not</strong> Bitcoin. It is open-source software on Sonic. The tone here follows what worked for early{' '}
          <a href="https://bitcoin.org/" className="text-terminal-accent underline" target="_blank" rel="noreferrer">
            bitcoin.org
          </a>
          : short sentences, no hype, verify don&apos;t trust.
        </p>
      </header>

      <section className="card space-y-3 border-terminal-border/80 border-terminal-accent/30">
        <h2 className="text-lg font-semibold text-terminal-text">Aegis = shielded (native value)</h2>
        <p className="text-sm text-terminal-text-dim leading-relaxed">
          The name is the posture: <strong className="text-terminal-text">AGS and in-ecosystem flows default to commitments / ZK-backed paths</strong>, not naked-wallet habits.
          Third-party assets and venues (ETH, USDC, public AMM pools) stay <strong className="text-terminal-text">labeled external chemistry</strong>—never marketed as &quot;private Aegis.&quot; Maintainer write-up:{' '}
          <code className="text-terminal-accent">docs/AEGIS_MAXIMUM_STEALTH_LOCAL_BUILD_SPEC.md</code> §0.
        </p>
      </section>

      <section className="card space-y-3 border-terminal-border/80">
        <h2 className="text-lg font-semibold text-terminal-text">1. Root of trust</h2>
        <ul className="list-disc pl-5 space-y-2 text-sm text-terminal-text-dim leading-relaxed">
          <li>The <strong className="text-terminal-text">chain</strong> is the source of truth.</li>
          <li>The <strong className="text-terminal-text">website</strong> is optional. If you distrust a host, read the contracts yourself.</li>
          <li>
            <strong className="text-terminal-text">ZK</strong> proves only what the deployed circuit encodes—never &quot;everything is private&quot; by default.
          </li>
        </ul>
      </section>

      <section className="card space-y-3 border-terminal-border/80 border-terminal-accent/20">
        <h2 className="text-lg font-semibold text-terminal-text">2. Privacy rails &amp; DAO discipline</h2>
        <p className="text-sm text-terminal-text-dim leading-relaxed">
          The product <strong className="text-terminal-text">defaults to ZK-backed flows</strong> in the wallet and swap UI where those code paths exist.
          <strong className="text-terminal-text"> Public balances and public pools</strong> stay labeled as explorer-visible compatibility rails — not a secret layer.
          Governance (votes + timelock) controls global levers such as <code className="text-terminal-accent">publicEntryEnabled</code> on the token; the
          repository explains ceremony hygiene and lessons from earlier ZK deployments in{' '}
          <code className="text-terminal-accent">docs/ZK_DAO_GOVERNANCE_LESSONS.md</code>. The phased maximum-privacy program (living status, war-room checklist)
          lives in <code className="text-terminal-accent">docs/AEGIS_HIDDEN_FORT_EXECUTION_PLAN.md</code>.
        </p>
      </section>

      <section className="card space-y-3 border-terminal-border/80">
        <h2 className="text-lg font-semibold text-terminal-text">3. Sovereignty is hardware</h2>
        <p className="text-sm text-terminal-text-dim leading-relaxed">
          Installing MetaMask does <strong className="text-terminal-text">not</strong> make you a &quot;full node&quot;. Running your own Sonic JSON-RPC (or a URL{' '}
          <em>you</em> chose) is what reduces dependence on third-party RPC operators. Use the banner in the header when a local node is detected.
        </p>
      </section>

      <section className="card space-y-3 border-terminal-border/80">
        <h2 className="text-lg font-semibold text-terminal-text">4. Governance without theatre</h2>
        <p className="text-sm text-terminal-text-dim leading-relaxed">
          If an admin key can change behaviour, we say so. If only on-chain votes can, we point to the governance contracts. Words like &quot;autonomous&quot; must match
          bytecode, not marketing.
        </p>
      </section>

      <section className="card space-y-4 border-terminal-border/80 border-terminal-accent/25">
        <h2 className="text-lg font-semibold text-terminal-text">5. DAO trust contract (all modules)</h2>
        <p className="text-sm text-terminal-text-dim leading-relaxed">
          Aegis is a <strong className="text-terminal-text">DAO</strong>: the same on-chain governance rules apply to{' '}
          <strong className="text-terminal-text">every</strong> address that earns voting power from the token—including early allocation at launch. There is no
          parallel &quot;storybook democracy&quot;; if the contracts allow a vote, you count; if they require a threshold, everyone faces the same math.
        </p>
        <p className="text-sm text-terminal-text-dim leading-relaxed">
          Lending, insurance, liquidity, bridge, staking, yield, crowdfunding, and sale flows all share one rule:{' '}
          <strong className="text-terminal-text">UI language must not promise what the bytecode does not enforce.</strong> On-chain &quot;insurance&quot; is
          parametric coverage with caps and vault limits—not silent life insurance. Yield and loans must show worst-case and time paths, not only APY. Privacy is
          dignity (what is hidden, from whom) — not &quot;everything is secret&quot; by default.
        </p>
        <p className="text-xs text-terminal-text-dim leading-relaxed border-l-2 border-terminal-accent/40 pl-3">
          Canonical write-up for maintainers and copy: repository file <code className="text-terminal-accent">docs/DAO_TRUST_CONTRACT.md</code> (ship with your
          fork of the repo or mirror; the dApp does not fetch it at runtime).
        </p>
      </section>

      <section className="card space-y-3 border-terminal-border/80">
        <h2 className="text-lg font-semibold text-terminal-text">6. What you should do next</h2>
        <ol className="list-decimal pl-5 space-y-2 text-sm text-terminal-text-dim leading-relaxed">
          <li>
            Open <Link to="/wallet" className="text-terminal-accent underline">Wallet</Link> for the recommended shield / commitment rail when your deployment
            exposes it.
          </li>
          <li>
            Open the in-app <Link to="/dex-roadmap" className="text-terminal-accent underline">DEX &amp; private trading roadmap</Link> before sizing liquidity work.
          </li>
          <li>Read the technical whitepaper in the repository if you allocate serious funds.</li>
          <li>Run <code className="text-terminal-accent">npm run contracts:ci</code> (or read CI logs) before trusting a release.</li>
          <li>Prefer your own RPC for reads; the wallet&apos;s RPC still applies to writes.</li>
          <li>
            For Sonic mainnet operations, follow the operator checklist in the repository file{' '}
            <code className="text-terminal-accent">docs/SONIC_MAINNET_LAUNCH.md</code>.
          </li>
        </ol>
      </section>

      <p className="text-sm text-terminal-text-dim border-l-2 border-terminal-accent/50 pl-4">
        If you don&apos;t want to verify, you don&apos;t have to use the system. That is fine. The software is here for those who do.
      </p>

      <div className="flex flex-wrap gap-3">
        <Link to="/wallet" className="btn-secondary">
          Wallet
        </Link>
        <Link to="/how-it-works" className="btn-secondary">
          How it works
        </Link>
        <Link to="/" className="btn-secondary">
          Home
        </Link>
        <Link to="/explorer" className="btn-secondary">
          Explorer
        </Link>
        <Link to="/governance" className="btn-secondary">
          Governance
        </Link>
        <Link to="/dex-roadmap" className="btn-secondary">
          DEX roadmap
        </Link>
      </div>
    </div>
  )
}
