import { ReactNode, useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useWalletStore } from '@/store/walletStore'
import WalletButton from './WalletButton'
import RpcSelector from './RpcSelector'
import IntegrityBanner from './IntegrityBanner'
import GoogleTranslate from './GoogleTranslate'
import Logo from './Logo'
import RunYourOwnNode from './RunYourOwnNode'
import CompactRpcPrivacyBar from './CompactRpcPrivacyBar'
import { isPrivacySensitiveRoute } from '@/config/privacySensitiveRoutes'
import {
  COMMITMENT_STORAGE_PRIVACY_DOC,
  hasCommitmentRelatedLocalStorage,
  isCommitmentVaultEnabled,
  isCommitmentVaultUnlocked,
} from '@/utils/commitmentStorage'

import { allowThirdPartyTranslate as operationalAllowsTranslate } from '@/utils/operationalProfile'

interface LayoutProps {
  children: ReactNode
}

const navItems = [
  { path: '/', label: 'Home', icon: '⌂' },
  { path: '/wallet', label: 'Wallet', icon: '💼' },
  { path: '/shielded-ecosystem', label: 'Shielded ecosystem', icon: '🛡️' },
  { path: '/principles', label: 'Principles', icon: '📜' },
  { path: '/how-it-works', label: 'How it works', icon: '⎈' },
  { path: '/governance', label: 'Governance', icon: '⚡' },
  { path: '/staking', label: 'Staking', icon: '🔒' },
  { path: '/lending', label: 'Lending', icon: '💰' },
  { path: '/insurance', label: 'Insurance', icon: '🛡️' },
  { path: '/crowdfunding', label: 'Crowdfunding', icon: '🚀' },
  { path: '/staged-capital', label: 'Staged capital', icon: '📈' },
  { path: '/yield-farming', label: 'Yield Farming', icon: '🌾' },
  { path: '/derivatives', label: 'Derivatives', icon: '📈' },
  { path: '/swap', label: 'Swap', icon: '💱' },
  { path: '/dex-roadmap', label: 'DEX roadmap', icon: '🗺️' },
  { path: '/liquidity', label: 'Liquidity', icon: '💧' },
  { path: '/treasury-incentives', label: 'Treasury & LP mine', icon: '🏛️' },
  { path: '/bridge', label: 'Ethereum - Sonic Bridge', icon: '🌉' },
  { path: '/explorer', label: 'Explorer', icon: '🔍' },
  { path: '/analytics', label: 'Analytics', icon: '📊' },
]

export default function Layout({ children }: LayoutProps) {
  const location = useLocation()
  const { checkConnection, address } = useWalletStore()
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  useEffect(() => {
    checkConnection()
    const interval = setInterval(checkConnection, 30000)
    return () => clearInterval(interval)
  }, [checkConnection])

  useEffect(() => {
    setMobileNavOpen(false)
  }, [location.pathname])

  const allowThirdPartyTranslate =
    operationalAllowsTranslate() && !isPrivacySensitiveRoute(location.pathname)

  return (
    <div className="page min-h-screen flex flex-col bg-terminal-bg text-terminal-text">
      {allowThirdPartyTranslate ? <GoogleTranslate /> : null}
      <IntegrityBanner />
      <CompactRpcPrivacyBar />
      {address ? (
        <div
          className="border-b border-terminal-border bg-terminal-surface px-4 py-1.5 text-center text-[11px] leading-snug text-terminal-text-dim"
          role="note"
        >
          <strong className="text-terminal-text">Device storage:</strong>{' '}
          {isCommitmentVaultEnabled(address) ? (
            isCommitmentVaultUnlocked(address) ? (
              <>
                Encrypted UX cache <strong className="text-terminal-text">unlocked</strong> in memory — blobs on disk
                are AES-GCM wrapped. EVM explorers still see your txs.{' '}
              </>
            ) : (
              <>
                Encrypted UX cache <strong className="text-terminal-text">locked</strong> — open Wallet to unlock (new
                cache writes wait).{' '}
              </>
            )
          ) : (
            <>
              this dApp may persist ZK UX rows in <code className="text-terminal-accent">localStorage</code> as{' '}
              <strong className="text-terminal-text">plaintext</strong> unless you enable the vault on Wallet.{' '}
            </>
          )}
          {hasCommitmentRelatedLocalStorage(address) ? (
            <span className="text-terminal-warning">Rows or vault blobs exist for this wallet.</span>
          ) : null}{' '}
          <span className="opacity-80">Operator: {COMMITMENT_STORAGE_PRIVACY_DOC}</span>
        </div>
      ) : null}
      <header className="sticky top-0 z-50 border-b border-terminal-border bg-gradient-to-b from-terminal-surface to-terminal-bg">
        <div className="container mx-auto max-w-[90rem] px-4 py-3">
          <div className="flex items-center justify-between gap-4">
            <Logo variant="text" size="lg" className="flex-shrink-0 min-w-0" />
            <div className="flex items-center gap-4">
              <RpcSelector />
              <WalletButton />
            </div>
          </div>
        </div>
      </header>

      <div className="md:hidden border-terminal-border border-b bg-terminal-surface z-40">
        <button
          type="button"
          className="w-full px-4 py-2.5 text-left text-sm font-medium text-terminal-text flex items-center justify-between gap-2"
          aria-expanded={mobileNavOpen}
          aria-controls="aegis-mobile-nav"
          onClick={() => setMobileNavOpen((o) => !o)}
        >
          <span>Navigation</span>
          <span className="text-terminal-text-dim shrink-0" aria-hidden>
            {mobileNavOpen ? '▴' : '▾'}
          </span>
        </button>
        {mobileNavOpen ? (
          <nav id="aegis-mobile-nav" className="px-2 pb-3 max-h-[min(70vh,28rem)] overflow-y-auto" aria-label="Site">
            <ul className="space-y-0.5">
              {navItems.map((item) => {
                const isActive = location.pathname === item.path
                return (
                  <li key={item.path}>
                    <Link
                      to={item.path}
                      onClick={() => setMobileNavOpen(false)}
                      className={`
                        flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all
                        ${
                          isActive
                            ? 'bg-terminal-accent/10 text-terminal-accent border border-terminal-accent/30'
                            : 'text-terminal-text-dim hover:text-terminal-text hover:bg-terminal-bg'
                        }
                      `}
                    >
                      <span className="text-base" aria-hidden>
                        {item.icon}
                      </span>
                      <span className="min-w-0 leading-snug">{item.label}</span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </nav>
        ) : null}
      </div>

      <div className="flex flex-1">
        <aside className="w-72 border-terminal-border border-r bg-terminal-surface hidden md:block">
          <nav className="p-4 space-y-4">
            <div className="px-4">
              <p className="text-xs uppercase tracking-[0.22em] text-terminal-text-dim font-medium">Modules</p>
            </div>
            <ul className="space-y-1">
              {navItems.map((item) => {
                const isActive = location.pathname === item.path
                return (
                  <li key={item.path}>
                    <Link
                      to={item.path}
                      className={`
                        flex items-center gap-3 px-4 py-2 rounded-lg transition-all
                        ${
                          isActive
                            ? 'bg-terminal-accent/10 text-terminal-accent border border-terminal-accent/30 font-medium'
                            : 'text-terminal-text-dim hover:text-terminal-text hover:bg-terminal-bg'
                        }
                      `}
                    >
                      <span className="text-lg">{item.icon}</span>
                      <span className="min-w-0 flex-1 leading-snug">{item.label}</span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </nav>
        </aside>

        <main className="flex-1 overflow-auto">
          <div className="container mx-auto max-w-[68rem] px-6 py-8">
            <RunYourOwnNode />
            {children}
          </div>
        </main>
      </div>

      <footer className="border-terminal-border border-t bg-terminal-surface py-6">
        <div className="container mx-auto max-w-[68rem] px-4 text-center text-sm text-terminal-text-dim space-y-3">
          <div className="flex flex-col sm:flex-row items-center justify-center gap-2 sm:gap-3 mb-2">
            <Logo variant="icon" size="md" className="opacity-90 shrink-0" />
            <p>
              Aegis is built around <strong className="text-terminal-text">Groth16 ZK</strong> where verifiers are
              deployed, <strong className="text-terminal-text">stealth-oriented flows</strong> where the contracts
              support them, and a <strong className="text-terminal-text">DAO</strong> that changes parameters through
              on-chain votes and timelocks — not through a hidden admin in this static app. Settlement:{' '}
              <strong className="text-terminal-text">Sonic</strong>. Ethereum: bridge and read paths where the protocol
              exposes them.
            </p>
          </div>
          <p className="text-xs max-w-2xl mx-auto leading-relaxed">
            <Link to="/principles" className="text-terminal-accent underline-offset-2 hover:underline">
              Principles &amp; DAO trust contract
            </Link>{' '}
            ·{' '}
            <Link to="/wallet" className="text-terminal-accent underline-offset-2 hover:underline">
              Wallet (shield rail)
            </Link>{' '}
            (lending, insurance, liquidity, bridge, and the rest share one honesty standard). Prefer your own Sonic
            JSON-RPC? Use <span className="text-terminal-text">/sovereign-node-app</span> or the RPC you trust — reads
            and writes follow the endpoint you choose. Maintainer checklist:{' '}
            <code className="text-terminal-accent text-[11px]">docs/AEGIS_HIDDEN_FORT_EXECUTION_PLAN.md</code>.
          </p>
        </div>
      </footer>
    </div>
  )
}
