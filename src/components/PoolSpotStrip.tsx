import { usePoolSpotHints } from '@/hooks/usePoolSpotHints'

type Props = {
  className?: string
}

/**
 * One-line live hints from public pools (on-chain `quoteSwap`); no external price APIs.
 */
export default function PoolSpotStrip({ className = '' }: Props) {
  const { data, isFetching } = usePoolSpotHints()

  const line = (() => {
    if (!data?.length) return null
    const parts = data
      .filter((r) => r.agsForOneQuote && Number(r.agsForOneQuote) > 0)
      .map((r) => {
        const v = Number(r.agsForOneQuote).toLocaleString(undefined, { maximumFractionDigits: 6 })
        return `1 ${r.label} ≈ ${v} AGS`
      })
    if (!parts.length) return null
    return parts.join(' · ')
  })()

  if (!line) return null

  return (
    <div className={`rounded-md border border-terminal-border/40 bg-terminal-surface/30 px-3 py-2 text-xs ${className}`}>
      <span className="text-terminal-text-muted">{isFetching ? 'Updating… ' : ''}</span>
      <span className="text-terminal-text/90">{line}</span>
    </div>
  )
}
