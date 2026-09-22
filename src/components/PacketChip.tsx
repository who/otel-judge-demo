import { columnForPacket, isLlamaSkipped, VERDICT_COLUMNS } from '../types/board'
import type { JevDistribution, Packet } from '../types/board'

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

/** How the Jev badge introduces its label in the chip's accessible name. */
export const JEV_BADGE_PREFIX = 'Jev'

/**
 * Jev's leading label: the key carrying the most mass, or undefined when there
 * is no distribution to read. This is the one number System One is really
 * asserting, so it is the one worth putting on a chip.
 *
 * Ties break on the lexicographically smaller key rather than on whichever
 * entry came first, so an evenly split distribution names the same label on
 * every render instead of following the order the Worker happened to serialise.
 * A non-finite mass is skipped rather than compared: NaN loses every
 * comparison, so an unguarded scan would hand the badge to the key that
 * happened to be next in line instead of to the label Jev leaned on.
 */
export function topJevLabel(distribution: JevDistribution | undefined): string | undefined {
  let top: string | undefined
  let topMass = 0
  for (const [label, mass] of Object.entries(distribution ?? {})) {
    if (!Number.isFinite(mass)) continue
    if (top === undefined || mass > topMass || (mass === topMass && label < top)) {
      top = label
      topMass = mass
    }
  }
  return top
}

/** True for the three outcome buckets, which are the only chips that show Jev's label. */
function isVerdictColumn(packet: Packet): boolean {
  const column = columnForPacket(packet)
  return column !== null && (VERDICT_COLUMNS as readonly string[]).includes(column)
}

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
 * Two badges can sit below those rows, and both spell themselves out in the
 * accessible name rather than leaving a bare word for a screen reader. A packet
 * that settled without a verdict carries the skipped badge, because a chip
 * resting in the jev column is otherwise read as still moving. A packet that
 * settled into one of the outcome buckets carries Jev's leading label, so a
 * reviewer can see what System One thought without opening the inspector; an
 * in-flight chip never shows it, because a distribution that is still being
 * revised is not yet a claim about the packet. A settled packet whose
 * distribution never arrived shows no badge at all rather than a guessed label.
 */
export function PacketChip({ packet, selected, onSelect }: PacketChipProps) {
  const { service, operation, durationMs } = packet.summary
  const skipped = isLlamaSkipped(packet)
  const jevTop = isVerdictColumn(packet) ? topJevLabel(packet.jev) : undefined
  const name = `${service} ${operation} ${durationMs} ms, ${packet.stage} stage`
  const spoken = [
    name,
    ...(jevTop === undefined ? [] : [`${JEV_BADGE_PREFIX} ${jevTop}`]),
    ...(skipped ? [SKIPPED_BADGE_LABEL] : []),
  ]
  return (
    <button
      type="button"
      className="packet-chip"
      data-stage={packet.stage}
      data-packet-id={packet.id}
      data-skipped={skipped ? 'true' : undefined}
      aria-pressed={selected}
      aria-label={spoken.join(', ')}
      title={`${service} ${operation}`}
      onClick={() => onSelect(packet.id)}
    >
      <span className="packet-chip__service">{service}</span>
      <span className="packet-chip__operation">{operation}</span>
      <span className="packet-chip__duration">{durationMs} ms</span>
      {(jevTop !== undefined || skipped) && (
        <span className="packet-chip__badges">
          {jevTop !== undefined && (
            // The title carries the label in full: a long key is clipped to the
            // chip's width, and the badge is the only place it is shown.
            <span className="packet-chip__badge packet-chip__badge--jev" data-jev-top={jevTop} title={jevTop}>
              {jevTop}
            </span>
          )}
          {skipped && <span className="packet-chip__badge">{SKIPPED_BADGE_TEXT}</span>}
        </span>
      )}
    </button>
  )
}
