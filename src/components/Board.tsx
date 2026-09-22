import { useLayoutEffect, useRef } from 'react'
import type { FocusEvent } from 'react'
import { BOARD_COLUMNS, columnForPacket, VERDICT_COLUMNS } from '../types/board'
import type { BoardColumn, BoardState, Packet } from '../types/board'
import { PacketChip } from './PacketChip'

export interface BoardProps {
  state: BoardState
  /** Id of the selected packet, or null when nothing is selected. */
  selectedId: string | null
  onSelect: (id: string) => void
}

/**
 * The pipeline as ordered columns of packet chips: the three stages a packet
 * moves through, then the three outcome buckets it settles into.
 *
 * Columns come from BOARD_COLUMNS rather than from the data, so an idle board
 * still shows the full shape and an empty bucket keeps its column — a demo
 * whose escalate column is empty is saying something, and a column that
 * vanished would say nothing. Board holds no state of its own: selection lives
 * in the parent, which lets the live-state task swap the data source without
 * touching anything here.
 *
 * Within an in-flight column the order is the board's own array order, which
 * reads as the pipeline filling up. The outcome buckets are ordered newest
 * first, so the judgement a reviewer is waiting on is the one at the top of its
 * bucket.
 *
 * A chip that advances a stage re-mounts under a different column, which
 * would drop keyboard focus on the body. The board remembers which chip was
 * focused and hands focus back to the re-mounted chip, so a keyboard user
 * following a packet is never thrown back to the start of the page.
 */
export function Board({ state, selectedId, onSelect }: BoardProps) {
  // One pass over the packets fills every column and counts the leftovers, so
  // a packet the board cannot place is noticed rather than silently dropped.
  const columns = new Map<BoardColumn, Packet[]>()
  let unplacedCount = 0
  for (const packet of state.packets) {
    const column = columnForPacket(packet)
    if (column === null) {
      unplacedCount += 1
      continue
    }
    const existing = columns.get(column)
    if (existing === undefined) columns.set(column, [packet])
    else existing.push(packet)
  }

  const rootRef = useRef<HTMLDivElement>(null)
  const focusedIdRef = useRef<string | null>(null)
  const columnsRef = useRef<ReadonlyMap<string, BoardColumn>>(new Map())

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
    const previous = columnsRef.current
    const current = new Map<string, BoardColumn>()
    for (const [column, packets] of columns) {
      for (const packet of packets) current.set(packet.id, column)
    }
    columnsRef.current = current

    const id = focusedIdRef.current
    if (id === null) return
    const moved = previous.get(id) !== undefined && previous.get(id) !== current.get(id)
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
        {BOARD_COLUMNS.map((column) => (
          <BoardColumnSection
            key={column}
            column={column}
            packets={sortPacketsForColumn(column, columns.get(column) ?? [])}
            selectedId={selectedId}
            onSelect={onSelect}
          />
        ))}
      </div>
      {unplacedCount > 0 && (
        <p className="board__unknown" role="status">
          {unplacedCount} {unplacedCount === 1 ? 'packet' : 'packets'} the board cannot place
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

/**
 * The packets of one column in the order that column should show them.
 *
 * Only the outcome buckets are ordered. The three in-flight columns keep the
 * order Judge published them in, and every packet there leaves for the next
 * stage shortly anyway. A bucket is terminal, so it only ever grows: without an
 * order of its own the newest judgement lands wherever it happens to sit in the
 * array, which is the one chip a reviewer is actually waiting for. The sort
 * runs per bucket, so a fresh pass does not push the escalate a reviewer is
 * reading down its own column.
 */
function sortPacketsForColumn(column: BoardColumn, packets: Packet[]): Packet[] {
  if (!isVerdictColumn(column)) return packets
  return [...packets].sort(newestFirst)
}

function isVerdictColumn(column: BoardColumn): boolean {
  return (VERDICT_COLUMNS as readonly string[]).includes(column)
}

/**
 * Compare two packets so the more recent one sorts first.
 *
 * A packet whose arrival time cannot be read sorts below every dated packet:
 * an unknown timestamp is the one thing that must not be presented as the
 * latest judgement. Packets that compare equal — the same instant, or two
 * unreadable timestamps — return 0 and so keep their relative order, because
 * Array.prototype.sort is stable; a batch Judge published together therefore
 * holds its shape instead of reshuffling on the next state push.
 */
function newestFirst(a: Packet, b: Packet): number {
  const left = receivedAtMs(a)
  const right = receivedAtMs(b)
  if (left === right) return 0
  if (left === undefined) return 1
  if (right === undefined) return -1
  return right - left
}

/**
 * A packet's arrival time in milliseconds, or undefined when there is none to
 * read. The timestamp is parsed rather than compared as a string so packets
 * stamped in different UTC offsets still order by real time, and so the empty
 * string the agent adapter substitutes for a missing value is recognised as
 * absent rather than sorting as the earliest possible date.
 */
function receivedAtMs(packet: Packet): number | undefined {
  const parsed = Date.parse(packet.receivedAt)
  return Number.isNaN(parsed) ? undefined : parsed
}

interface BoardColumnSectionProps {
  column: BoardColumn
  packets: Packet[]
  selectedId: string | null
  onSelect: (id: string) => void
}

function BoardColumnSection({ column, packets, selectedId, onSelect }: BoardColumnSectionProps) {
  const headingId = `board-column-${column}`
  return (
    <section className="board-column" data-column={column} aria-labelledby={headingId}>
      <h2 id={headingId} className="board-column__header">
        <span className="board-column__name">{column}</span>
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
