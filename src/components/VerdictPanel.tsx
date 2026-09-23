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

/** Heads the reason block, so the paragraph under the badge is never unlabelled. */
export const WHY_LABEL = 'Why'

/** Shown when a verdict arrived carrying neither a critique nor a rationale. */
export const NO_WHY_TEXT = 'Llama published no reason for this verdict.'

/**
 * The reason to print under the label. Both texts come from the same
 * judgement, and the critique is the closer answer to why this label and not
 * another, so it wins wherever Llama sent one; the rationale stands in for a
 * verdict from a build that publishes no critique. An empty string means
 * neither was published, which the panel says out loud rather than leaving a
 * gap under the heading.
 */
export function whyText(verdict: LlamaVerdict): string {
  const critique = verdict.critique?.trim() ?? ''
  return critique !== '' ? critique : verdict.rationale.trim()
}

/**
 * The Llama verdict: its label, why the packet was judged that way, and the
 * recommended actions. The label maps to a semantic verdict token via
 * data-verdict (pass green, flag amber, escalate red) and is always paired
 * with the verdict word in text, so colour is never the only signal.
 *
 * The reason sits directly under the badge, because a label nobody can
 * account for is the one thing a reviewer cannot act on. The rationale keeps
 * its own paragraph below only when it is saying something the reason block
 * is not: a verdict with no critique is already showing its rationale up
 * there, and printing it twice would read as two separate findings.
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

  const why = whyText(verdict)
  const rationale = verdict.rationale.trim()

  return (
    <div className="verdict-panel">
      <p className="verdict-panel__label-row">
        <span className="verdict-panel__label" data-verdict={verdict.label}>
          {verdict.label}
        </span>
      </p>
      <div className="verdict-panel__why">
        <p className="verdict-panel__why-label">{WHY_LABEL}</p>
        <p className="verdict-panel__why-text" data-why={why === '' ? 'missing' : 'present'}>
          {why === '' ? NO_WHY_TEXT : why}
        </p>
      </div>
      {rationale !== '' && rationale !== why && (
        <p className="verdict-panel__rationale">{verdict.rationale}</p>
      )}
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
