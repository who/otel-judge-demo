import type { LlamaVerdict } from '../types/board'

export interface VerdictPanelProps {
  /** Llama's verdict, or null/undefined for a packet that has not reached the llama stage. */
  verdict: LlamaVerdict | null | undefined
  /**
   * True when the packet has settled with no verdict because Jev was
   * unavailable. Only meaningful without a verdict; a verdict always wins.
   */
  skipped?: boolean
}

/** Shown when Llama has not judged the packet yet but still will. */
export const AWAITING_VERDICT_TEXT = 'Awaiting Llama verdict'

/** Shown when Llama never ran, so no verdict is coming for this packet. */
export const LLAMA_SKIPPED_TEXT = 'Jev unavailable — Llama skipped'

/**
 * The Llama verdict: its label, the free-text rationale, and the recommended
 * actions. The label maps to a semantic verdict token via data-verdict (pass
 * green, flag amber, escalate red) and is always paired with the verdict word
 * in text, so colour is never the only signal.
 *
 * An empty actions array renders no list at all rather than an empty bullet.
 * The panel is read-only: nothing here can be edited or executed.
 *
 * With no verdict the panel says which of the two no-verdict worlds this is:
 * one where Llama is still coming, and one where Jev was unavailable and
 * Llama was skipped, where promising a verdict would be a lie.
 */
export function VerdictPanel({ verdict, skipped = false }: VerdictPanelProps) {
  if (!verdict) {
    return (
      <p className="inspector__pending" data-pending={skipped ? 'verdict-skipped' : 'verdict'}>
        {skipped ? LLAMA_SKIPPED_TEXT : AWAITING_VERDICT_TEXT}
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
