// Derivation of the pipeline console's lines from board snapshots. Judge sends
// no event stream, so the narration is reconstructed here by comparing the
// board as it was with the board as it is. Everything below is a pure function
// of two BoardState values: no React, no timers, no clock, so the same pair of
// snapshots always produces the same lines in the same order.

import { isLlamaSkipped, PACKET_STAGES } from '../types/board'
import type { BoardState, Packet, PacketStage } from '../types/board'

/**
 * What a line reports. The console renders `text` verbatim; the kind is there
 * so the UI can tint a failure differently from an ordinary step without
 * parsing the copy back out of the string.
 */
export type ConsoleEventKind =
  | 'waiting-for-jev'
  | 'jev-finished'
  | 'waiting-for-llama'
  | 'llama-finished'
  | 'jev-failed'
  | 'board-cleared'

export interface ConsoleEvent {
  kind: ConsoleEventKind
  /** The packet the line is about. Absent on board-wide lines. */
  packetId?: string
  /** The line as the console shows it, packet id included. */
  text: string
}

// Line copy. Exported so tests and callers assert against the same strings the
// console prints rather than a second copy that can drift from it.
export const WAITING_FOR_JEV_TEXT = 'waiting for Jev'
export const JEV_FINISHED_TEXT = 'Jev finished'
export const WAITING_FOR_LLAMA_TEXT = 'waiting for Llama'
export const LLAMA_FINISHED_TEXT = 'Llama finished'
export const JEV_FAILED_TEXT = 'Jev failed — Llama skipped'
export const BOARD_CLEARED_TEXT = 'board cleared'

const SEPARATOR = ' — '

/**
 * The lines to append for a board update, in the order they should be read.
 *
 * `previous` is null for the first snapshot a mount sees, which is a baseline
 * rather than news: a page that opens onto a board mid-flight, or a socket that
 * reconnects and replays everything, would otherwise print a line per packet
 * for work that happened before anyone was watching. Nothing is emitted for it.
 *
 * Packets are matched by id, so a state push that replaces the array wholesale
 * still reads as movement rather than as a board full of new packets. A packet
 * that has not moved produces nothing, which is what keeps an idle board — or a
 * re-render of an identical snapshot — silent.
 */
export function diffBoardConsoleEvents(previous: BoardState | null, next: BoardState): ConsoleEvent[] {
  if (previous === null) return []

  // A board that has just been emptied is one event, not one per departed
  // packet: the reset is the news, and the packets are all gone for the same
  // reason. Packets leaving individually are not reported at all, because a
  // live board evicts them as it ages and that is not a pipeline step.
  if (next.packets.length === 0) {
    return previous.packets.length === 0 ? [] : [{ kind: 'board-cleared', text: BOARD_CLEARED_TEXT }]
  }

  const before = new Map(previous.packets.map((packet) => [packet.id, packet]))
  const events: ConsoleEvent[] = []
  for (const packet of next.packets) {
    const seen = before.get(packet.id)
    events.push(...(seen === undefined ? firstSighting(packet) : moved(seen, packet)))
  }
  return events
}

/**
 * The lines for a packet the console has never seen before.
 *
 * Only where the packet is now is announced, never the steps it took to get
 * there: a packet that appears already judged is history, and replaying its
 * whole journey would read as if it had just run through the pipeline.
 */
function firstSighting(packet: Packet): ConsoleEvent[] {
  if (isLlamaSkipped(packet)) return [jevFailed(packet)]
  switch (packet.stage) {
    // A packet at ingest is waiting for Jev just as surely as one already in
    // the jev stage; both are announced once, here, and the crossing into jev
    // stays silent so the same news is not printed twice for one packet.
    case 'ingest':
    case 'jev':
      return [line('waiting-for-jev', WAITING_FOR_JEV_TEXT, packet)]
    case 'llama':
      return [line('waiting-for-llama', WAITING_FOR_LLAMA_TEXT, packet)]
    case 'verdict':
      return [llamaFinished(packet)]
    default:
      return []
  }
}

/**
 * The lines for a packet that was already on the board.
 *
 * Every stage boundary between the two snapshots is reported, so a packet that
 * crosses two stages in one update still narrates both. A packet that has not
 * moved reports only a Jev failure that has just been flagged; a stage that
 * moved backwards, which Judge never does, reports nothing.
 */
function moved(before: Packet, after: Packet): ConsoleEvent[] {
  const from = stageIndex(before.stage)
  const to = stageIndex(after.stage)
  if (from === undefined || to === undefined) return []

  const events: ConsoleEvent[] = []
  for (let index = from + 1; index <= to; index += 1) {
    const stage = PACKET_STAGES[index]
    if (stage !== undefined) events.push(...crossingInto(stage, after))
  }
  // The skip is the last word on a packet: Jev could not score it, so System
  // Two never runs and the packet settles where it stands.
  if (isLlamaSkipped(after) && !isLlamaSkipped(before)) events.push(jevFailed(after))
  return events
}

/** The lines for one stage boundary a packet has just crossed. */
function crossingInto(stage: PacketStage, packet: Packet): ConsoleEvent[] {
  switch (stage) {
    case 'llama':
      return [line('jev-finished', JEV_FINISHED_TEXT, packet), line('waiting-for-llama', WAITING_FOR_LLAMA_TEXT, packet)]
    case 'verdict':
      return [llamaFinished(packet)]
    // Reaching jev is not news: the wait for Jev was announced when the packet
    // was first seen, and ingest is never crossed into.
    default:
      return []
  }
}

/**
 * The settled line for a packet at the verdict stage, carrying Llama's label
 * when there is one. A verdict that has not arrived with the stage change
 * leaves the label off rather than guessing at it.
 */
function llamaFinished(packet: Packet): ConsoleEvent {
  const label = packet.llama === undefined ? '' : SEPARATOR + packet.llama.label.toUpperCase()
  return { kind: 'llama-finished', packetId: packet.id, text: LLAMA_FINISHED_TEXT + SEPARATOR + packet.id + label }
}

function jevFailed(packet: Packet): ConsoleEvent {
  return line('jev-failed', JEV_FAILED_TEXT, packet)
}

function line(kind: ConsoleEventKind, phrase: string, packet: Packet): ConsoleEvent {
  return { kind, packetId: packet.id, text: phrase + SEPARATOR + packet.id }
}

/** A stage's position in the pipeline, or undefined for a stage this build does not know. */
function stageIndex(stage: PacketStage): number | undefined {
  const index = PACKET_STAGES.indexOf(stage)
  return index === -1 ? undefined : index
}
