import type { JevDistribution } from '../types/board'

export interface JevBarsProps {
  /** Jev's label-to-probability map, or undefined for a packet not yet scored. */
  distribution: JevDistribution | undefined
}

/** Shown when Jev has not scored the packet yet, so "not yet" reads differently from "nothing". */
export const AWAITING_JEV_TEXT = 'Awaiting Jev evaluation'

/**
 * Clamp a probability into the 0 to 100 range for bar width only. The numeric
 * label shows the raw value so a misbehaving model is visible, not hidden.
 */
function widthPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, value * 100))
}

/** Format a probability as a percentage to one decimal place, e.g. 0.004 renders as 0.4%. */
export function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return '—'
  return `${(value * 100).toFixed(1)}%`
}

/**
 * One proportional bar per Jev label, sorted by descending probability so the
 * modal outcome is always the first row. Bars are plain elements sized with a
 * CSS width; there are only a handful of labels, so a charting dependency
 * would outweigh what it adds.
 *
 * Each bar is a meter with the raw probability as its value, so the
 * distribution is announced to assistive technology rather than being a
 * visual-only encoding. Values are rendered as given and never normalised:
 * misreporting a model output would be worse than an odd-looking chart.
 */
export function JevBars({ distribution }: JevBarsProps) {
  const entries = distribution ? Object.entries(distribution) : []
  if (entries.length === 0) {
    return (
      <p className="inspector__pending" data-pending="jev">
        {AWAITING_JEV_TEXT}
      </p>
    )
  }

  const sorted = [...entries].sort(([, a], [, b]) => b - a)

  return (
    <ul className="jev-bars" aria-label="Jev probability distribution">
      {sorted.map(([label, value]) => (
        <li key={label} className="jev-bars__row">
          <span className="jev-bars__label">{label}</span>
          <div
            className="jev-bars__track"
            role="meter"
            aria-label={label}
            aria-valuenow={value}
            aria-valuemin={0}
            aria-valuemax={1}
            aria-valuetext={formatPercent(value)}
          >
            <div className="jev-bars__fill" style={{ width: `${widthPercent(value)}%` }} />
          </div>
          <span className="jev-bars__value">{formatPercent(value)}</span>
        </li>
      ))}
    </ul>
  )
}
