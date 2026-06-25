import { Link } from 'react-router-dom'

/**
 * Static “how it works” page — no animations, no marketing claims beyond what the chain enforces.
 * Diagram sources: Aegis-contracts/architecture/*.dot — render PNGs locally with `npm run architecture:render` in contracts; not bundled under public/.
 */
export default function HowItWorks() {
  return (
    <div className="space-y-10 max-w-4xl">
      <header className="space-y-3">
        <p className="text-sm uppercase tracking-[0.2em] text-terminal-text-dim">Read the system</p>
        <h1 className="text-3xl md:text-4xl font-semibold text-terminal-text leading-tight">How it works</h1>
        <p className="text-terminal-text-dim leading-relaxed max-w-3xl">
          Five boxes, one direction. The website does not hold your keys. The wallet does not store the canonical ledger.
          Sonic validators execute what you signed; contracts define the rules. Anything else (translation widgets, RPC
          branding, this very sentence) is not consensus. For <strong className="text-terminal-text">how we speak about
          money</strong> across lending, insurance, pools, and the rest, see the repository file{' '}
          <code className="text-terminal-accent">docs/DAO_TRUST_CONTRACT.md</code>, the phased program in{' '}
          <code className="text-terminal-accent">docs/AEGIS_HIDDEN_FORT_EXECUTION_PLAN.md</code>, and the in-app{' '}
          <Link to="/principles" className="text-terminal-accent underline">
            Principles
          </Link>{' '}
          page. For the recommended shield / commitment rail, open{' '}
          <Link to="/wallet" className="text-terminal-accent underline">
            Wallet
          </Link>
          .
        </p>
      </header>

      <div className="card border-terminal-border/80 bg-terminal-surface/40 p-4 space-y-2">
        <h2 className="text-sm font-semibold text-terminal-text uppercase tracking-[0.18em]">Client flow (no bundled figure)</h2>
        <p className="text-sm text-terminal-text-dim leading-relaxed">
          This app ships <strong className="text-terminal-text">without architecture PNGs</strong> under{' '}
          <code className="text-terminal-accent">public/</code>. The canonical diagram sources are Graphviz{' '}
          <code className="text-terminal-accent">.dot</code> files in <code className="text-terminal-accent">Aegis-contracts/architecture/</code>.
          Run <code className="text-terminal-accent">npm run architecture:render</code> there to produce PNGs for docs or your own static host.
        </p>
        <p className="text-xs text-terminal-text-dim leading-relaxed">
          Flow in one line: <strong className="text-terminal-text">static UI → wallet → JSON-RPC → Sonic → contracts</strong>
          (validators execute; the UI never holds your key).
        </p>
      </div>

      <section className="card space-y-4 border-terminal-border/80">
        <h2 className="text-lg font-semibold text-terminal-text">Step by step</h2>
        <ol className="list-decimal pl-5 space-y-3 text-sm text-terminal-text-dim leading-relaxed">
          <li>
            <strong className="text-terminal-text">Static UI.</strong> You download HTML/JS/CSS (often from Arweave or IPFS). It can lie; you verify by
            checking contract addresses and reading code, or by using a mirror you trust.
          </li>
          <li>
            <strong className="text-terminal-text">Wallet.</strong> The browser asks your wallet to sign transactions or to authorize{' '}
            <code className="text-terminal-accent">eth_call</code> reads. The UI never receives your private key.
          </li>
          <li>
            <strong className="text-terminal-text">JSON-RPC.</strong> Signed traffic goes to an endpoint: your own node, a DAO URL, or a public RPC.
            The endpoint sees what you send; choose accordingly.
          </li>
          <li>
            <strong className="text-terminal-text">Sonic.</strong> Validators order and execute EVM transactions on chain ID{' '}
            <strong className="text-terminal-text">146</strong> (mainnet) or <strong className="text-terminal-text">14601</strong> (testnet), per your build.
            Native gas is denoted <strong className="text-terminal-text">S</strong> in Sonic documentation.
          </li>
          <li>
            <strong className="text-terminal-text">Contracts.</strong> Aegis modules (token, governance, pools, …) are plain Solidity. The DAO upgrades parameters through on-chain votes and timelocks where encoded. ZK verifies only the statements the deployed verifiers were built for — the UI defaults to proof-backed paths when you choose them; public rails stay labeled honestly.
          </li>
        </ol>
      </section>

      <section className="card space-y-3 border-terminal-border/80">
        <h2 className="text-lg font-semibold text-terminal-text">Full architecture diagrams</h2>
        <p className="text-sm text-terminal-text-dim leading-relaxed">
          System overview, contract interactions, ZK layout, data flow, deployment, and security maps live in the repository as Graphviz{' '}
          <code className="text-terminal-accent">.dot</code> sources under <code className="text-terminal-accent">Aegis-contracts/architecture/</code>.
          PNG exports are optional outputs of that script for docs or mirrors; they are not stored under{' '}
          <code className="text-terminal-accent">frontend/public/</code> in this repository.
        </p>
      </section>

      <div className="flex flex-wrap gap-3">
        <Link to="/wallet" className="btn-secondary">
          Wallet
        </Link>
        <Link to="/principles" className="btn-secondary">
          Principles
        </Link>
        <Link to="/" className="btn-secondary">
          Home
        </Link>
        <Link to="/explorer" className="btn-secondary">
          Explorer
        </Link>
        <Link to="/dex-roadmap" className="btn-secondary">
          DEX roadmap
        </Link>
      </div>
    </div>
  )
}
