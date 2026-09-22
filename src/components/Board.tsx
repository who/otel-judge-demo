import { useLayoutEffect, useRef } from 'react'
import type { FocusEvent } from 'react'
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
 *
 * A chip that advances a stage re-mounts under a different column, which
 * would drop keyboard focus on the body. The board remembers which chip was
 * focused and hands focus back to the re-mounted chip, so a keyboard user
 * following a packet is never thrown back to the start of the page.
 */
export function Board({ state, selectedId, onSelect }: BoardProps) {
  const known = new Set<string>(PACKET_STAGES)
  const unknownCount = state.packets.filter((packet) => !known.has(packet.stage)).length

  const rootRef = useRef<HTMLDivElement>(null)
  const focusedIdRef = useRef<string | null>(null)
  const stagesRef = useRef<ReadonlyMap<string, PacketStage>>(new Map())

  // Focus events bubble in React, so one pair of handlers on the root covers
  // every chip. A blur whose relatedTarget is set means focus moved somewhere
  // on purpose; a blur with no relatedTarget is either a click on empty space
  // (the chip is still in the document) or the chip being removed (it is not).
  const handleFocus = (event: FocusEvent<HTMLDivElement>) => {
    focusedIdRef.current = chipId(event.target)
  }
  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (event.relatedTarget !== null || event.target.isConnected) focusedIdRef.current = null
  }

  useLayoutEffect(() => {
    const previous = stagesRef.current
    stagesRef.current = new Map(state.packets.map((packet) => [packet.id, packet.stage]))

    const id = focusedIdRef.current
    if (id === null) return
    const moved = previous.get(id) !== undefined && previous.get(id) !== stagesRef.current.get(id)
    if (!moved) return

    const active = document.activeElement
    const focusLost = active === null || active === document.body || !active.isConnected
    if (!focusLost) return

    const chip = rootRef.current?.querySelector<HTMLElement>(`[data-packet-id="${cssEscape(id)}"]`)
    chip?.focus({ preventScroll: true })
  })

  return (
    <div className="board" ref={rootRef} onFocus={handleFocus} onBlur={handleBlur}>
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

/** The packet id of a focused chip, or null when the focused element is not a chip. */
function chipId(target: EventTarget | null): string | null {
  return target instanceof HTMLElement ? (target.dataset.packetId ?? null) : null
}

/** Escape a packet id for use inside an attribute selector; ids are opaque strings from the Worker. */
function cssEscape(value: string): string {
  return typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
    ? CSS.escape(value)
    : value.replace(/["\\]/g, '\\$&')
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
