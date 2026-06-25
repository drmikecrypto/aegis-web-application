import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Log } from 'ethers'

import { useWalletStore } from '@/store/walletStore'
import {
  CONTRACT_ADDRESSES,
  CONTRACT_METADATA,
  DEFAULT_NETWORK,
  ZERO_ADDRESS,
  type ContractKey,
} from '@/config/contracts'
import { formatAddress } from '@/utils/format'
import { explorerTxUrl } from '@/utils/blockExplorer'
import DaoModuleNotice from '@/components/DaoModuleNotice'

type Row = {
  blockNumber: number
  transactionHash: string
  address: string
  topics: string[]
}

function contractSelectOptions(): { key: ContractKey; address: string; label: string }[] {
  return (Object.keys(CONTRACT_METADATA) as ContractKey[])
    .map((key) => ({
      key,
      address: CONTRACT_ADDRESSES[key],
      label: CONTRACT_METADATA[key].label,
    }))
    .filter((o) => o.address !== ZERO_ADDRESS)
}

export default function Explorer() {
  const { provider, chainId } = useWalletStore()
  const [selectedContract, setSelectedContract] = useState<string>('')
  const [fromBlock, setFromBlock] = useState('')
  const [toBlock, setToBlock] = useState('latest')

  const options = useMemo(() => contractSelectOptions(), [])

  const txLinkChainId = chainId ?? DEFAULT_NETWORK.chainId

  const { data: events, isLoading, error } = useQuery({
    queryKey: ['explorer-events', selectedContract, fromBlock, toBlock, chainId],
    queryFn: async (): Promise<Row[]> => {
      if (!selectedContract || !provider) return []

      const logs = (await provider.send('eth_getLogs', [
        {
          address: selectedContract,
          fromBlock: fromBlock || '0x0',
          toBlock: toBlock === 'latest' ? 'latest' : toBlock,
          topics: [],
        },
      ])) as Log[]
      return (logs ?? []).map((event) => {
        const blockNumber =
          typeof event.blockNumber === 'string'
            ? parseInt(event.blockNumber, 16)
            : Number(event.blockNumber ?? 0)
        return {
          blockNumber: Number.isFinite(blockNumber) ? blockNumber : 0,
          transactionHash: event.transactionHash ?? '',
          address: event.address ?? '',
          topics: [...(event.topics ?? [])],
        }
      })
    },
    enabled: !!selectedContract && !!provider,
  })

  const fetchError = error instanceof Error ? error.message : null

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-terminal-accent mb-2">Explorer</h1>
        <p className="text-terminal-text-dim max-w-3xl space-y-2">
          <span className="block">
            Read contract logs with your <strong className="text-terminal-text">wallet / app RPC</strong> via{' '}
            <code className="text-terminal-accent">eth_getLogs</code>. Range and archive depth depend on the RPC you
            chose (public endpoints may cap history). For full account history and token transfers, use your chain
            explorer (e.g.{' '}
            <a className="text-terminal-accent underline" href="https://sonicscan.org" target="_blank" rel="noreferrer">
              SonicScan
            </a>
            ).
          </span>
          <span className="block text-sm border-l-2 border-terminal-border pl-3 mt-2">
            <span className="text-terminal-text">فارسی:</span> این صفحه فقط از RPC کیف‌پول شما لاگ می‌گیرد؛ برای
            تاریخچهٔ کامل تراکنش‌ها از مرورگر بلاک‌چین استفاده کنید.
          </span>
        </p>
        <DaoModuleNotice>
          <p>
            This page only <strong className="text-terminal-text">reads</strong> chain data — it does not move funds.
            Accuracy and completeness depend on your RPC; it is a convenience viewer, not a notary.
          </p>
        </DaoModuleNotice>
      </div>

      {/* Filters */}
      <div className="card">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-terminal-text-dim mb-2">
              Contract Address
            </label>
            <select
              value={selectedContract}
              onChange={(e) => setSelectedContract(e.target.value)}
              className="input-field w-full"
            >
              <option value="">Select a contract</option>
              {options.map((o) => (
                <option key={o.key} value={o.address}>
                  {o.label} — {formatAddress(o.address)}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-terminal-text-dim mb-2">
                From Block
              </label>
              <input
                type="text"
                value={fromBlock}
                onChange={(e) => setFromBlock(e.target.value)}
                className="input-field w-full"
                placeholder="0x0 or decimal"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-terminal-text-dim mb-2">
                To Block
              </label>
              <input
                type="text"
                value={toBlock}
                onChange={(e) => setToBlock(e.target.value)}
                className="input-field w-full"
                placeholder="latest"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Events List */}
      <div className="card">
        <h2 className="text-xl font-semibold mb-4">Events</h2>
        {!provider && (
          <div className="text-center py-8 text-terminal-warning">
            Connect a wallet or choose an RPC profile so the app can call <code>eth_getLogs</code>.
          </div>
        )}
        {fetchError && (
          <div className="mb-4 rounded border border-terminal-warning/50 bg-terminal-warning/10 px-3 py-2 text-sm text-terminal-warning">
            {fetchError}
          </div>
        )}
        {isLoading ? (
          <div className="text-center py-8 text-terminal-text-dim">Loading events...</div>
        ) : !events || events.length === 0 ? (
          <div className="text-center py-8 text-terminal-text-dim">
            {selectedContract ? 'No events found' : 'Select a contract to view events'}
          </div>
        ) : (
          <div className="space-y-2">
            {events.map((event, index) => {
              const txHref = explorerTxUrl(txLinkChainId, event.transactionHash)
              return (
                <div
                  key={`${event.transactionHash}-${index}`}
                  className="bg-terminal-muted/30 rounded p-3 font-mono text-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <div className="text-terminal-accent">
                      Block: {Number.isFinite(event.blockNumber) ? event.blockNumber : '—'}
                    </div>
                    <div className="text-terminal-text-dim break-all">
                      Tx:{' '}
                      {txHref ? (
                        <a
                          href={txHref}
                          target="_blank"
                          rel="noreferrer"
                          className="text-terminal-accent underline"
                        >
                          {event.transactionHash}
                        </a>
                      ) : (
                        event.transactionHash
                      )}
                    </div>
                  </div>
                  <div className="text-terminal-text-dim mb-1">
                    Address: {formatAddress(event.address)}
                  </div>
                  <div className="text-terminal-text-dim">Topics: {event.topics.length}</div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
