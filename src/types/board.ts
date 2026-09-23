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
  /**
   * Llama's own account of why this label and not another one, published
   * alongside the verdict. Optional because Judge builds older than the
   * critique wire never send it, so an absent critique means the board is
   * talking to such a build rather than that Llama had nothing to say; the
   * inspector prefers it over the rationale and falls back when it is absent.
   */
  critique?: string
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
   * How long System One took to score this packet, in milliseconds, as
   * measured and published by Judge. Optional because older Judge builds do
   * not send it and because a stage that has not run has no timing; it is
   * never derived on this side, so an absent value means unknown rather than
   * zero.
   */
  jevLatencyMs?: number
  /** How long System Two took to reach its verdict, on the same terms as `jevLatencyMs`. */
  llamaLatencyMs?: number
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

/**
 * The terminal outcome buckets, in the order the board shows them. They are
 * exactly Llama's labels: a judged packet is filed under the decision Llama
 * reached, so the board reads as an outcome tally rather than as a single pile
 * of everything that finished.
 */
export const VERDICT_COLUMNS: readonly LlamaVerdictLabel[] = ['pass', 'flag', 'escalate']

/**
 * A column of the board. The three in-flight columns are named after the
 * pipeline stage they hold; the three terminal columns are named after the
 * verdict they hold. `verdict` is deliberately absent: it is a wire stage, not
 * a column, and a packet that reaches it is shown under its label instead.
 */
export type BoardColumn = 'ingest' | 'jev' | 'llama' | LlamaVerdictLabel

/** Board columns left to right: the pipeline, then the outcomes it feeds. */
export const BOARD_COLUMNS: readonly BoardColumn[] = ['ingest', 'jev', 'llama', ...VERDICT_COLUMNS]

const IN_FLIGHT_COLUMNS: readonly string[] = ['ingest', 'jev', 'llama']

/**
 * The column a packet belongs in, or null when the board cannot place it.
 *
 * Stage decides first, so a packet still moving through the pipeline is shown
 * where it stands even if a verdict has already been attached to it; only a
 * packet that has reached `verdict` is filed by label. That keeps the in-flight
 * columns meaning exactly what they meant before the buckets existed.
 *
 * Two packets have no column. One whose stage is not a stage this build knows
 * cannot be placed at all, and one that settled at `verdict` without a readable
 * label has no bucket to go in — filing it under a guessed outcome would put a
 * judgement on screen that Llama never made. Both are counted off the board
 * rather than hidden, and a Jev-skipped packet is neither: it settles at `jev`
 * and keeps that column.
 */
export function columnForPacket(packet: Packet): BoardColumn | null {
  if (packet.stage !== 'verdict') {
    return IN_FLIGHT_COLUMNS.includes(packet.stage) ? (packet.stage as BoardColumn) : null
  }
  const label = packet.llama?.label
  return label !== undefined && VERDICT_COLUMNS.includes(label) ? label : null
}
