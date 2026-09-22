import { isLlamaSkipped } from '../types/board'
import type { Packet } from '../types/board'

export interface PacketChipProps {
  packet: Packet
  /** Whether this chip is the board's current selection. */
  selected: boolean
  /** Called with the packet id on every activation, selected or not. */
  onSelect: (id: string) => void
}

/** The badge word itself, kept short so it fits a chip at any column width. */
export const SKIPPED_BADGE_TEXT = 'skipped'

/** What that word means, for the chip's accessible name. */
export const SKIPPED_BADGE_LABEL = 'Llama skipped'

/**
 * One packet on the board. It is a real button so focus, Enter and Space
 * activation come from the platform rather than hand-rolled key handlers.
 *
 * The visible label is service, operation and duration: the triple that makes
 * a packet identifiable at a glance. The accessible name adds the stage so a
 * screen-reader user hears where the packet sits without walking up to the
 * column heading. Clicking an already selected chip still calls onSelect;
 * deselect semantics belong to the parent.
 *
 * The packet id is exposed as a data attribute so the board can find this
 * chip again after it re-mounts in a new column and hand focus back to it.
 *
 * A packet that settled without a verdict carries a badge, because a chip
 * resting in the jev column is otherwise read as still moving. The accessible
 * name spells the badge out rather than leaving the word on its own.
 */
export function PacketChip({ packet, selected, onSelect }: PacketChipProps) {
  const { service, operation, durationMs } = packet.summary
  const skipped = isLlamaSkipped(packet)
  const name = `${service} ${operation} ${durationMs} ms, ${packet.stage} stage`
  return (
    <button
      type="button"
      className="packet-chip"
      data-stage={packet.stage}
      data-packet-id={packet.id}
      data-skipped={skipped ? 'true' : undefined}
      aria-pressed={selected}
      aria-label={skipped ? `${name}, ${SKIPPED_BADGE_LABEL}` : name}
      title={`${service} ${operation}`}
      onClick={() => onSelect(packet.id)}
    >
      <span className="packet-chip__service">{service}</span>
      <span className="packet-chip__operation">{operation}</span>
      <span className="packet-chip__duration">{durationMs} ms</span>
      {skipped && <span className="packet-chip__badge">{SKIPPED_BADGE_TEXT}</span>}
    </button>
  )
}
