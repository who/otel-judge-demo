import type { LlamaVerdict } from '../types/board'

export interface VerdictPanelProps {
  /** Llama's verdict, or null/undefined for a packet that has not reached the llama stage. */
  verdict: LlamaVerdict | null | undefined
}

/** Shown when Llama has not judged the packet yet. */
export const AWAITING_VERDICT_TEXT = 'Awaiting Llama verdict'

/**
 * The Llama verdict: its label, the free-text rationale, and the recommended
 * actions. The label maps to a semantic verdict token via data-verdict (pass
 * green, flag amber, escalate red) and is always paired with the verdict word
 * in text, so colour is never the only signal.
 *
 * An empty actions array renders no list at all rather than an empty bullet.
 * The panel is read-only: nothing here can be edited or executed.
 */
export function VerdictPanel({ verdict }: VerdictPanelProps) {
  if (!verdict) {
    return (
      <p className="inspector__pending" data-pending="verdict">
        {AWAITING_VERDICT_TEXT}
      </p>
    )
  }

  return (
    <div className="verdict-panel">
      <p className="verdict-panel__label-row">
        <span className="verdict-panel__label" data-verdict={verdict.label}>
          {verdict.label}
        </span>
      </p>
      <p className="verdict-panel__rationale">{verdict.rationale}</p>
      {verdict.actions.length > 0 && (
        <ul className="verdict-panel__actions" aria-label="Recommended actions">
          {verdict.actions.map((action, index) => (
            <li key={`${index}-${action}`}>{action}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
