import { JevBars } from './JevBars'
import { VerdictPanel } from './VerdictPanel'
import { isLlamaSkipped } from '../types/board'
import type { Packet } from '../types/board'

export interface InspectorProps {
  /** The selected packet, or null when nothing is selected or the selection left the board. */
  packet: Packet | null
}

/** The first thing a reviewer reads on load, before any packet is picked. */
export const NO_SELECTION_TEXT = 'Select a packet to inspect it.'

/**
 * Read-only detail rail for the selected packet: the compact span summary,
 * Jev's probability bars, then Llama's verdict. Selection is owned by the
 * parent; this component only renders what it is handed, so a packet that is
 * selected and then removed from state arrives here as null and falls back
 * to the pick-a-packet instruction.
 */
export function Inspector({ packet }: InspectorProps) {
  if (packet === null) {
    return (
      <div className="inspector inspector--empty">
        <p className="inspector__instruction">{NO_SELECTION_TEXT}</p>
      </div>
    )
  }

  const { service, operation, durationMs, statusCode } = packet.summary

  return (
    <div className="inspector" data-packet-id={packet.id}>
      <section className="inspector__section" aria-labelledby="inspector-summary-heading">
        <h2 id="inspector-summary-heading" className="inspector__heading">
          Packet
        </h2>
        <dl className="inspector__summary">
          <div className="inspector__field">
            <dt>Service</dt>
            <dd>{service}</dd>
          </div>
          <div className="inspector__field">
            <dt>Operation</dt>
            <dd className="inspector__mono">{operation}</dd>
          </div>
          <div className="inspector__field">
            <dt>Duration</dt>
            <dd>{durationMs} ms</dd>
          </div>
          <div className="inspector__field">
            <dt>Status</dt>
            <dd>{statusCode}</dd>
          </div>
        </dl>
      </section>

      <section className="inspector__section" aria-labelledby="inspector-jev-heading">
        <h2 id="inspector-jev-heading" className="inspector__heading">
          Jev
        </h2>
        <JevBars distribution={packet.jev} />
      </section>

      <section className="inspector__section" aria-labelledby="inspector-llama-heading">
        <h2 id="inspector-llama-heading" className="inspector__heading">
          Llama verdict
        </h2>
        <VerdictPanel verdict={packet.llama} skipped={isLlamaSkipped(packet)} />
      </section>
    </div>
  )
}
