import { isLlamaSkipped, PACKET_STAGES } from '../types/board'
import type { BoardState, LlamaVerdict, Packet, PacketStage } from '../types/board'

// Every value below is hardcoded. No Date.now(), no Math.random(), so component
// snapshots and assertions stay stable across runs and across CI.

const MOCK_PACKETS: readonly Packet[] = [
  {
    id: 'pkt-0001',
    stage: 'ingest',
    receivedAt: '2026-09-21T10:00:00.000Z',
    summary: { service: 'checkout', operation: 'POST /cart/items', durationMs: 42, statusCode: 200 },
  },
  {
    id: 'pkt-0002',
    stage: 'ingest',
    receivedAt: '2026-09-21T10:00:01.000Z',
    summary: { service: 'inventory', operation: 'GET /stock/{sku}', durationMs: 18, statusCode: 200 },
  },
  {
    id: 'pkt-0003',
    stage: 'jev',
    receivedAt: '2026-09-21T10:00:02.000Z',
    summary: { service: 'payments', operation: 'POST /charge', durationMs: 1840, statusCode: 502 },
    jev: { normal: 0.12, latency_spike: 0.63, upstream_error: 0.25 },
    // Scored but not yet judged, so only System One has a decision time.
    jevLatencyMs: 14,
  },
  {
    id: 'pkt-0004',
    stage: 'llama',
    receivedAt: '2026-09-21T10:00:03.000Z',
    summary: { service: 'auth', operation: 'POST /token', durationMs: 95, statusCode: 401 },
    jev: { normal: 0.4, auth_failure: 0.55, latency_spike: 0.05 },
  },
  {
    id: 'pkt-0005',
    stage: 'verdict',
    receivedAt: '2026-09-21T10:00:04.000Z',
    summary: { service: 'search', operation: 'GET /search', durationMs: 3210, statusCode: 200 },
    jev: { normal: 0.05, latency_spike: 0.9, upstream_error: 0.05 },
    llama: {
      label: 'flag',
      rationale:
        'Search latency is more than ten times the service p95 while the status is still 200. ' +
        'Jev puts 90% on a latency spike, which matches a slow downstream index rather than an outage.',
      actions: ['Check index shard health', 'Compare with the last deploy timestamp'],
    },
    // The demo's headline packet: both stages report, and the two-orders-of-
    // magnitude gap between them is the point of showing the timings at all.
    jevLatencyMs: 9,
    llamaLatencyMs: 842,
  },
  {
    // Left without either latency on purpose: a Judge build that predates the
    // timing fields still has to render as a complete packet.
    id: 'pkt-0006',
    stage: 'verdict',
    receivedAt: '2026-09-21T10:00:05.000Z',
    summary: { service: 'checkout', operation: 'GET /cart', durationMs: 31, statusCode: 200 },
    jev: { normal: 0.97, latency_spike: 0.02, upstream_error: 0.01 },
    llama: {
      label: 'pass',
      rationale: 'Fast, successful and Jev is confident it is normal traffic. Nothing to do.',
      actions: [],
    },
  },
  {
    id: 'pkt-0007',
    stage: 'verdict',
    receivedAt: '2026-09-21T10:00:06.000Z',
    summary: { service: 'payments', operation: 'POST /refund', durationMs: 5120, statusCode: 500 },
    jev: { normal: 0.02, latency_spike: 0.3, upstream_error: 0.68 },
    llama: {
      label: 'escalate',
      rationale:
        'A refund returned 500 after five seconds and Jev leans upstream error. ' +
        'Money movement failures need a human before the retry queue drains.',
      actions: ['Page the payments on-call', 'Pause the refund retry worker', 'Open an incident'],
    },
    jevLatencyMs: 11,
    llamaLatencyMs: 1503,
  },
  {
    // Jev was unavailable for this packet, so Judge skipped Llama and it
    // settles here: it is finished, not queued behind the llama stage.
    id: 'pkt-0008',
    stage: 'jev',
    receivedAt: '2026-09-21T10:00:07.000Z',
    summary: { service: 'notifications', operation: 'POST /email', durationMs: 64, statusCode: 200 },
    jevUnavailable: true,
  },
]

/**
 * A deterministic, fully populated board with at least one packet in every
 * stage. Returns fresh objects on every call so callers may mutate their copy
 * without affecting later calls.
 */
export function mockBoardState(): BoardState {
  return {
    packets: MOCK_PACKETS.map(clonePacket),
    producer: { scenario: 'mixed-traffic', ratePerSec: 2, paused: false },
    updatedAt: '2026-09-21T10:00:07.000Z',
  }
}

/**
 * Returns a new BoardState with every packet moved one stage forward. Packets
 * already at `verdict` stay where they are, and so do packets whose Llama step
 * was skipped: those are finished, and walking them into the llama stage would
 * show the board waiting on a step that is never going to run. The input is
 * never mutated, which matches the immutable update the agent adapter performs.
 *
 * A packet that arrives at `verdict` without a judgement is given one here, in
 * the same snapshot as the stage change. The board files a settled packet under
 * Llama's label, so a tick that delivered a packet to `verdict` and nothing to
 * file it under would count it off the board instead: the mock stream owes the
 * board a verdict for every packet it settles. A verdict already on the packet
 * is never rewritten, and a Jev-skipped packet never acquires one, because Jev
 * failing is exactly the case where System Two never ran.
 */
export function advanceMockBoard(state: BoardState): BoardState {
  return {
    ...state,
    packets: state.packets.map(advancePacket),
    producer: { ...state.producer },
  }
}

function advancePacket(packet: Packet): Packet {
  const next = clonePacket(packet)
  if (isLlamaSkipped(packet)) return next
  next.stage = nextStage(packet.stage)
  if (next.stage === 'verdict' && next.llama === undefined) next.llama = verdictFor(packet)
  return next
}

// Thresholds the mock judgement reads the summary against. They are the demo's
// own rules of thumb rather than anything Judge publishes, which is why they
// live here with the fixture instead of in the shared board contract.
const SERVER_ERROR_STATUS = 500
const CLIENT_ERROR_STATUS = 400
const SLOW_REQUEST_MS = 1000

/**
 * The verdict the fixture hands a packet as it settles, derived from the
 * packet's own summary so it is the same verdict on every run and on every
 * machine. Nothing is sampled and nothing is read from the clock: the demo
 * asserts that two calls of the fixture are equal, and a judgement that varied
 * between ticks would break the board's story as well as those assertions.
 */
function verdictFor(packet: Packet): LlamaVerdict {
  const { service, operation, durationMs, statusCode } = packet.summary
  if (statusCode >= SERVER_ERROR_STATUS) {
    return {
      label: 'escalate',
      rationale:
        `${service} answered ${operation} with ${statusCode}. ` +
        'A request the service could not complete on its own side needs a human before the failure repeats.',
      actions: [`Page the ${service} on-call`, 'Open an incident'],
    }
  }
  if (statusCode >= CLIENT_ERROR_STATUS) {
    return {
      label: 'flag',
      rationale:
        `${service} rejected ${operation} with ${statusCode}. ` +
        'One refusal is the service working as designed, so this is worth watching rather than waking anyone.',
      actions: [`Check the ${service} rejection rate against the last hour`],
    }
  }
  if (durationMs >= SLOW_REQUEST_MS) {
    return {
      label: 'flag',
      rationale:
        `${operation} took ${durationMs} ms on ${service}, far longer than this path usually costs. ` +
        'It succeeded, so the packet is a warning about a slow dependency rather than an outage.',
      actions: ['Compare with the last deploy timestamp'],
    }
  }
  return {
    label: 'pass',
    rationale: `${operation} returned ${statusCode} in ${durationMs} ms on ${service}. Ordinary traffic, nothing to do.`,
    actions: [],
  }
}

function nextStage(stage: PacketStage): PacketStage {
  const index = PACKET_STAGES.indexOf(stage)
  const last = PACKET_STAGES.length - 1
  return PACKET_STAGES[Math.min(index + 1, last)] ?? stage
}

function clonePacket(packet: Packet): Packet {
  return {
    ...packet,
    summary: { ...packet.summary },
    ...(packet.jev ? { jev: { ...packet.jev } } : {}),
    ...(packet.llama ? { llama: { ...packet.llama, actions: [...packet.llama.actions] } } : {}),
  }
}
