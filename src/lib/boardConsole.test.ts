import { describe, expect, it } from 'vitest'
import {
  BOARD_CLEARED_TEXT,
  diffBoardConsoleEvents,
  JEV_FAILED_TEXT,
  JEV_FINISHED_TEXT,
  LLAMA_FINISHED_TEXT,
  WAITING_FOR_JEV_TEXT,
  WAITING_FOR_LLAMA_TEXT,
} from './boardConsole'
import type { BoardState, Packet, PacketStage } from '../types/board'

function packet(id: string, stage: PacketStage, extra: Partial<Packet> = {}): Packet {
  return {
    id,
    stage,
    receivedAt: '2026-09-21T10:00:00.000Z',
    summary: { service: 'checkout', operation: 'POST /cart/items', durationMs: 42, statusCode: 200 },
    ...extra,
  }
}

function board(...packets: Packet[]): BoardState {
  return {
    packets,
    producer: { scenario: 'nominal', ratePerSec: 2, paused: false },
    updatedAt: '2026-09-21T10:00:00.000Z',
  }
}

/** The console copy for a board update, which is what a reviewer actually reads. */
function lines(previous: BoardState | null, next: BoardState): string[] {
  return diffBoardConsoleEvents(previous, next).map((event) => event.text)
}

describe('diffBoardConsoleEvents: a packet arriving', () => {
  it('announces the wait for Jev when a packet is first seen at ingest', () => {
    expect(lines(board(), board(packet('pkt-1', 'ingest')))).toEqual([`${WAITING_FOR_JEV_TEXT} — pkt-1`])
  })

  it('announces the wait for Jev when a packet is first seen already in the jev stage', () => {
    expect(lines(board(), board(packet('pkt-1', 'jev')))).toEqual([`${WAITING_FOR_JEV_TEXT} — pkt-1`])
  })

  it('does not repeat the wait for Jev when a known packet reaches the jev stage', () => {
    const arrived = board(packet('pkt-1', 'ingest'))
    expect(lines(arrived, board(packet('pkt-1', 'jev')))).toEqual([])
  })

  it('reports where a packet already is rather than replaying how it got there', () => {
    expect(lines(board(), board(packet('pkt-1', 'llama')))).toEqual([`${WAITING_FOR_LLAMA_TEXT} — pkt-1`])
  })

  it('emits nothing for the first snapshot a mount sees, however full the board', () => {
    expect(lines(null, board(packet('pkt-1', 'ingest'), packet('pkt-2', 'verdict')))).toEqual([])
  })
})

describe('diffBoardConsoleEvents: a packet moving', () => {
  it('reports Jev finishing and the wait for Llama when a packet leaves the jev stage', () => {
    const before = board(packet('pkt-1', 'jev'))
    expect(lines(before, board(packet('pkt-1', 'llama')))).toEqual([
      `${JEV_FINISHED_TEXT} — pkt-1`,
      `${WAITING_FOR_LLAMA_TEXT} — pkt-1`,
    ])
  })

  it('reports Llama finishing when a packet settles at the verdict stage', () => {
    const before = board(packet('pkt-1', 'llama'))
    expect(lines(before, board(packet('pkt-1', 'verdict')))).toEqual([`${LLAMA_FINISHED_TEXT} — pkt-1`])
  })

  it('carries the verdict label on the settled line when one arrived with the stage change', () => {
    const before = board(packet('pkt-1', 'llama'))
    const judged = packet('pkt-1', 'verdict', {
      llama: { label: 'flag', rationale: 'Latency is ten times the p95.', actions: [] },
    })
    expect(lines(before, board(judged))).toEqual([`${LLAMA_FINISHED_TEXT} — pkt-1 — FLAG`])
  })

  it('narrates every boundary when a packet crosses more than one stage in a single update', () => {
    const before = board(packet('pkt-1', 'ingest'))
    expect(lines(before, board(packet('pkt-1', 'verdict')))).toEqual([
      `${JEV_FINISHED_TEXT} — pkt-1`,
      `${WAITING_FOR_LLAMA_TEXT} — pkt-1`,
      `${LLAMA_FINISHED_TEXT} — pkt-1`,
    ])
  })

  it('keeps each packet of a burst in its own sequence, in board order', () => {
    const before = board(packet('pkt-1', 'jev'), packet('pkt-2', 'llama'))
    const after = board(packet('pkt-1', 'llama'), packet('pkt-2', 'verdict'))
    expect(lines(before, after)).toEqual([
      `${JEV_FINISHED_TEXT} — pkt-1`,
      `${WAITING_FOR_LLAMA_TEXT} — pkt-1`,
      `${LLAMA_FINISHED_TEXT} — pkt-2`,
    ])
  })
})

describe('diffBoardConsoleEvents: a packet Jev could not score', () => {
  it('reports the skip when the flag appears on a packet already on the board', () => {
    const before = board(packet('pkt-1', 'jev'))
    const skipped = board(packet('pkt-1', 'jev', { jevUnavailable: true }))
    expect(lines(before, skipped)).toEqual([`${JEV_FAILED_TEXT} — pkt-1`])
  })

  it('reports the skip instead of a wait when the packet arrives already flagged', () => {
    const skipped = board(packet('pkt-1', 'jev', { jevUnavailable: true }))
    expect(lines(board(), skipped)).toEqual([`${JEV_FAILED_TEXT} — pkt-1`])
  })

  it('stays silent once the skip has been reported, however long the packet sits there', () => {
    const skipped = board(packet('pkt-1', 'jev', { jevUnavailable: true }))
    expect(lines(skipped, board(packet('pkt-1', 'jev', { jevUnavailable: true })))).toEqual([])
  })

  it('prefers a verdict that arrived over a stale unavailable flag', () => {
    const before = board(packet('pkt-1', 'llama', { jevUnavailable: true }))
    const judged = packet('pkt-1', 'verdict', {
      jevUnavailable: true,
      llama: { label: 'pass', rationale: 'Nothing to do.', actions: [] },
    })
    expect(lines(before, board(judged))).toEqual([`${LLAMA_FINISHED_TEXT} — pkt-1 — PASS`])
  })
})

describe('diffBoardConsoleEvents: quiet updates', () => {
  it('emits nothing when the same snapshot is handed back', () => {
    const state = board(packet('pkt-1', 'jev'), packet('pkt-2', 'verdict'))
    expect(lines(state, state)).toEqual([])
  })

  it('emits nothing for an equal snapshot rebuilt as fresh objects', () => {
    const before = board(packet('pkt-1', 'jev'), packet('pkt-2', 'verdict'))
    const after = board(packet('pkt-1', 'jev'), packet('pkt-2', 'verdict'))
    expect(lines(before, after)).toEqual([])
  })

  it('says nothing about a packet that simply leaves the board', () => {
    const before = board(packet('pkt-1', 'verdict'), packet('pkt-2', 'jev'))
    expect(lines(before, board(packet('pkt-2', 'jev')))).toEqual([])
  })

  it('reports an emptied board once rather than once per packet', () => {
    const before = board(packet('pkt-1', 'jev'), packet('pkt-2', 'verdict'))
    expect(lines(before, board())).toEqual([BOARD_CLEARED_TEXT])
  })

  it('does not report a board that was already empty', () => {
    expect(lines(board(), board())).toEqual([])
  })

  it('ignores a packet whose stage this build does not know instead of crashing', () => {
    const unknown = { ...packet('pkt-1', 'ingest'), stage: 'quarantine' as PacketStage }
    expect(lines(board(packet('pkt-1', 'ingest')), board(unknown))).toEqual([])
    expect(lines(board(unknown), board(packet('pkt-1', 'verdict')))).toEqual([])
  })
})
