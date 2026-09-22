import { PACKET_STAGES } from '../types/board'
import type { BoardState, Packet, PacketStage } from '../types/board'
import { PacketChip } from './PacketChip'

export interface BoardProps {
  state: BoardState
  /** Id of the selected packet, or null when nothing is selected. */
  selectedId: string | null
  onSelect: (id: string) => void
}

/**
 * The four pipeline stages as ordered columns of packet chips.
 *
 * Columns come from PACKET_STAGES rather than from the stages present in the
 * data, so an idle board still shows the full pipeline shape and an empty
 * stage keeps its column. Board holds no state of its own: selection lives in
 * the parent, which lets the live-state task swap the data source without
 * touching anything here.
 */
export function Board({ state, selectedId, onSelect }: BoardProps) {
  const known = new Set<string>(PACKET_STAGES)
  const unknownCount = state.packets.filter((packet) => !known.has(packet.stage)).length

  return (
    <div className="board">
      <div className="board__columns">
        {PACKET_STAGES.map((stage) => (
          <StageColumn
            key={stage}
            stage={stage}
            packets={state.packets.filter((packet) => packet.stage === stage)}
            selectedId={selectedId}
            onSelect={onSelect}
          />
        ))}
      </div>
      {unknownCount > 0 && (
        <p className="board__unknown" role="status">
          {unknownCount} {unknownCount === 1 ? 'packet' : 'packets'} with an unknown stage
        </p>
      )}
    </div>
  )
}

interface StageColumnProps {
  stage: PacketStage
  packets: Packet[]
  selectedId: string | null
  onSelect: (id: string) => void
}

function StageColumn({ stage, packets, selectedId, onSelect }: StageColumnProps) {
  const headingId = `board-stage-${stage}`
  return (
    <section className="board-column" data-stage={stage} aria-labelledby={headingId}>
      <h2 id={headingId} className="board-column__header">
        <span className="board-column__name">{stage}</span>
        <span className="board-column__count" aria-label={`${packets.length} packets`}>
          {packets.length}
        </span>
      </h2>
      {packets.length === 0 ? (
        <p className="board-column__empty">No packets</p>
      ) : (
        <ul className="board-column__list">
          {packets.map((packet) => (
            <li key={packet.id}>
              <PacketChip packet={packet} selected={packet.id === selectedId} onSelect={onSelect} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
