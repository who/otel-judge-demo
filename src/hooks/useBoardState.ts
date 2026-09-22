import { useCallback, useEffect, useRef, useState } from 'react'
import { useAgent } from 'agents/react'
import { AGENT_INSTANCE, AGENT_NAME, readEnv } from '../lib/env'
import type { AppEnv } from '../lib/env'
import { advanceMockBoard, mockBoardState } from '../mock/boardFixture'
import { PACKET_STAGES } from '../types/board'
import type { BoardState, JevDistribution, LlamaVerdict, Packet, PacketStage } from '../types/board'

/**
 * How often the mock board advances while no Worker is configured. The live
 * connection replaces this interval wholesale: in live mode nothing ticks and
 * every board change comes from an Agent state push.
 */
export const MOCK_ADVANCE_MS = 2000

/**
 * Where the board's data is coming from right now. This is an explicit union
 * rather than a nullable socket so the connection badge renders a state
 * instead of inferring one.
 *
 * - `mock`: no Worker URL is configured; the fixture advances on a timer.
 * - `connecting`: a Worker URL is configured and the socket has not yet
 *   delivered a usable state, either because it is still opening or because
 *   it closed and is reconnecting.
 * - `live`: the last Agent payload adapted cleanly and is what the board shows.
 * - `degraded`: the connection could not be built, closed terminally, or the
 *   last payload failed validation. The board keeps showing its last good
 *   state, which is the fixture until a first valid payload arrives.
 */
export type ConnectionStatus = 'connecting' | 'live' | 'degraded' | 'mock'

export interface BoardStateResult {
  board: BoardState
  status: ConnectionStatus
}

export interface UseBoardStateOptions {
  /** Validated public config. Defaults to reading import.meta.env once on mount. */
  env?: AppEnv
}

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStage(value: unknown): value is PacketStage {
  return typeof value === 'string' && (PACKET_STAGES as readonly string[]).includes(value)
}

/** Jev's distribution is an open record of label to number; any other shape is dropped. */
function isJevDistribution(value: unknown): value is JevDistribution {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === 'number')
}

const VERDICT_LABELS: readonly string[] = ['pass', 'flag', 'escalate']

/**
 * The inspector renders label, rationale and actions directly, so a verdict
 * that lacks any of them is omitted rather than passed through to crash it.
 */
function isLlamaVerdict(value: unknown): value is LlamaVerdict {
  return (
    isRecord(value) &&
    typeof value.label === 'string' &&
    VERDICT_LABELS.includes(value.label) &&
    typeof value.rationale === 'string' &&
    Array.isArray(value.actions) &&
    value.actions.every((action) => typeof action === 'string')
  )
}

/**
 * Validate one packet from an untrusted payload. Only the two fields the board
 * needs to place a chip are enforced: a string id and a known stage. The
 * summary is defaulted rather than required so a Worker that omits it still
 * places the packet in its column. The optional `jev` and `llama` fields pass
 * through untouched when they match the contract and are omitted otherwise,
 * so the inspector renders whatever sound data arrived and never a shape it
 * cannot read.
 */
function adaptPacket(value: unknown): Packet | null {
  if (!isRecord(value)) return null
  const { id, stage, receivedAt, summary, jev, llama, jevUnavailable } = value
  if (typeof id !== 'string' || id === '') return null
  if (!isStage(stage)) return null

  const summaryRecord = isRecord(summary) ? summary : {}
  const packet: Packet = {
    id,
    stage,
    receivedAt: typeof receivedAt === 'string' ? receivedAt : '',
    summary: {
      service: typeof summaryRecord.service === 'string' ? summaryRecord.service : '',
      operation: typeof summaryRecord.operation === 'string' ? summaryRecord.operation : '',
      durationMs: typeof summaryRecord.durationMs === 'number' ? summaryRecord.durationMs : 0,
      statusCode: typeof summaryRecord.statusCode === 'number' ? summaryRecord.statusCode : 0,
    },
  }
  if (isJevDistribution(jev)) packet.jev = jev
  if (isLlamaVerdict(llama)) packet.llama = llama
  // Only a literal true marks the skip. Any other value is treated as absent,
  // so a malformed payload cannot report a live packet as finished.
  if (jevUnavailable === true) packet.jevUnavailable = true
  return packet
}

/**
 * Convert an untrusted Agent state payload into the local BoardState contract.
 *
 * The Worker deploys independently of this repo, so nothing about the payload
 * is assumed. A non-object payload or one without a `packets` array is
 * unusable and yields null. Individual packets that fail validation are
 * dropped while the sound ones are kept, so a partially malformed push
 * degrades to what can be shown rather than blanking a live demo board.
 *
 * Returns null when nothing usable survives so the caller can hold on to its
 * last good state. A payload whose `packets` array is legitimately empty is
 * an idle board, not garbage, and adapts to an empty BoardState.
 */
export function adaptAgentState(payload: unknown): BoardState | null {
  if (!isRecord(payload)) return null
  const { packets, producer, updatedAt } = payload
  if (!Array.isArray(packets)) return null

  const adapted = packets.map(adaptPacket).filter((packet): packet is Packet => packet !== null)
  if (adapted.length === 0 && packets.length > 0) return null

  const producerRecord = isRecord(producer) ? producer : {}
  return {
    packets: adapted,
    producer: {
      scenario: typeof producerRecord.scenario === 'string' ? producerRecord.scenario : '',
      ratePerSec: typeof producerRecord.ratePerSec === 'number' ? producerRecord.ratePerSec : 0,
      paused: producerRecord.paused === true,
    },
    updatedAt: typeof updatedAt === 'string' ? updatedAt : '',
  }
}

/**
 * Which inner hook a mount runs. Decided once from the build-time env and
 * never revisited, so React's hook order is identical on every render of a
 * given mount even though the two branches call different hooks.
 */
type BoardSource = { kind: 'mock' } | { kind: 'live'; host: string } | { kind: 'unreachable' }

/**
 * Synchronous pre-flight for the socket layer. The socket constructor runs
 * inside the connection hook's own state initializer, where a throw cannot be
 * caught without corrupting hook order, so its input rules are checked here
 * first: the host must be an http(s) origin the socket layer can rewrite to
 * ws(s). Anything else is a construction failure and the board stays on the
 * fixture, reported as degraded.
 */
function resolveSource(env: AppEnv): BoardSource {
  if (env.mode !== 'live' || env.apiBase === undefined) return { kind: 'mock' }
  try {
    const url = new URL(env.apiBase)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`unsupported protocol ${url.protocol}`)
    return { kind: 'live', host: env.apiBase }
  } catch (error) {
    console.error('[useBoardState] Cannot open the Agent connection; showing the mock fixture.', error)
    return { kind: 'unreachable' }
  }
}

/**
 * Board state for the App. Reads the public env once on mount and either
 * advances the mock fixture locally or subscribes to the Judge Worker's Agent.
 *
 * The mode comes from a build-time env value, so it cannot change while the
 * page is open. That is what makes the branch below safe: the same inner hook
 * runs on every render of a given mount, so React's hook order never shifts.
 */
export function useBoardState(options: UseBoardStateOptions = {}): BoardStateResult {
  const [source] = useState(() => resolveSource(options.env ?? readEnv()))
  switch (source.kind) {
    case 'live':
      // eslint-disable-next-line react-hooks/rules-of-hooks -- branch is fixed for the mount lifetime, see above
      return useLiveBoard(source.host)
    case 'unreachable':
      // eslint-disable-next-line react-hooks/rules-of-hooks -- branch is fixed for the mount lifetime, see above
      return useStaticFixture('degraded')
    case 'mock':
      // eslint-disable-next-line react-hooks/rules-of-hooks -- branch is fixed for the mount lifetime, see above
      return useMockBoard()
  }
}

/** A board that never changes, for the path where no connection can be built. */
function useStaticFixture(status: ConnectionStatus): BoardStateResult {
  const [board] = useState(mockBoardState)
  return { board, status }
}

function useMockBoard(): BoardStateResult {
  const [board, setBoard] = useState(mockBoardState)

  useEffect(() => {
    const timer = setInterval(() => setBoard(advanceMockBoard), MOCK_ADVANCE_MS)
    return () => clearInterval(timer)
  }, [])

  return { board, status: 'mock' }
}

function useLiveBoard(host: string): BoardStateResult {
  // The fixture is the initial board so the page is never blank while the
  // socket opens, and it stays if the connection never delivers anything.
  const [board, setBoard] = useState(mockBoardState)
  const [status, setStatus] = useState<ConnectionStatus>('connecting')

  // Socket callbacks can fire after unmount while the socket tears down.
  // Guarding on a ref keeps a late payload from touching an unmounted tree.
  const mountedRef = useRef(false)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const handleStateUpdate = useCallback((payload: unknown) => {
    if (!mountedRef.current) return
    const next = adaptAgentState(payload)
    if (next === null) {
      // Keep the last good board on screen; only the badge reports trouble.
      setStatus('degraded')
      return
    }
    // State is replaced wholesale, never appended, so a socket that closes and
    // reopens cannot duplicate packets.
    setBoard(next)
    setStatus('live')
  }, [])

  const handleConnectionError = useCallback(() => {
    if (mountedRef.current) setStatus('degraded')
  }, [])

  const handleClose = useCallback(() => {
    // A terminal close has already moved us to degraded through
    // onConnectionError, which useAgent invokes first. Anything else is a
    // reconnect in progress.
    if (mountedRef.current) setStatus((current) => (current === 'degraded' ? current : 'connecting'))
  }, [])

  // The host was pre-flighted by resolveSource, so construction here cannot
  // throw for our inputs. Runtime failures, including a CORS rejection of the
  // handshake, arrive through onClose and onConnectionError instead.
  useAgent({
    host,
    agent: AGENT_NAME,
    name: AGENT_INSTANCE,
    onStateUpdate: handleStateUpdate,
    onConnectionError: handleConnectionError,
    onClose: handleClose,
  })

  return { board, status }
}
