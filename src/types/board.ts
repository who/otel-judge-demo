// Board state contract shared by the UI, the agent adapter and the emit
// controls. This module is the wire shape this client expects from the Judge
// Worker's Agent state, so field names must stay stable once consumers exist.
// It deliberately imports nothing: no React, no browser globals, no runtime
// schema library, so it loads in components and plain unit tests alike.

/**
 * The four ordered pipeline stages a packet passes through. A packet enters at
 * `ingest`, is scored by Jev, evaluated by Llama, and settles at `verdict`.
 */
export type PacketStage = 'ingest' | 'jev' | 'llama' | 'verdict'

/** Pipeline stages in flow order. The board renders one column per entry. */
export const PACKET_STAGES: readonly PacketStage[] = ['ingest', 'jev', 'llama', 'verdict']

/**
 * Jev's label probabilities. It is an open record rather than a fixed union
 * because label sets vary by Jev model version; the inspector renders whatever
 * labels arrive. Values lie in the closed interval [0, 1] and sum to about 1.
 */
export type JevDistribution = Record<string, number>

/** The decision Llama reaches after reading the packet and Jev's distribution. */
export type LlamaVerdictLabel = 'pass' | 'flag' | 'escalate'

export interface LlamaVerdict {
  label: LlamaVerdictLabel
  /** Free-text explanation of the verdict, shown verbatim in the inspector. */
  rationale: string
  /** Recommended follow-up actions, rendered as a list. May be empty. */
  actions: string[]
}

/**
 * Compact summary of the underlying trace span. This is a fixed shape because
 * it drives the packet chip label on the board.
 */
export interface PacketSummary {
  service: string
  operation: string
  durationMs: number
  statusCode: number
}

export interface Packet {
  id: string
  stage: PacketStage
  /** ISO 8601 timestamp of when the packet entered the pipeline. */
  receivedAt: string
  summary: PacketSummary
  /** Absent until the packet has passed through the `jev` stage. */
  jev?: JevDistribution
  /** Absent until the packet has passed through the `llama` stage. */
  llama?: LlamaVerdict
  /**
   * Set by Judge when System One could not score this packet. Jev being
   * unavailable ends the evaluation there: System Two never runs, so the
   * packet settles in the `jev` stage carrying neither a distribution nor a
   * verdict. Absent on every packet that is merely still in flight.
   */
  jevUnavailable?: boolean
}

/** Producer controls mirrored from the firehose emitter. */
export interface ProducerState {
  scenario: string
  ratePerSec: number
  paused: boolean
}

export interface BoardState {
  /** Every packet currently on the board. An empty array is a fresh board. */
  packets: Packet[]
  producer: ProducerState
  /** ISO 8601 timestamp of the last state change. */
  updatedAt: string
}

/**
 * True when the packet has settled without a Llama verdict because Jev was
 * unavailable. A packet still in flight through the `jev` stage also carries
 * no distribution and no verdict, so missing data cannot tell the two apart;
 * only the explicit flag can, which is why callers branch on this predicate
 * rather than on `llama === undefined`. A verdict that did arrive always
 * wins, so a stale flag can never hide a real judgement.
 */
export function isLlamaSkipped(packet: Packet): boolean {
  return packet.jevUnavailable === true && packet.llama === undefined
}
