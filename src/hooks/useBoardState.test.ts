import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppEnv } from '../lib/env'
import { mockBoardState } from '../mock/boardFixture'
import { MOCK_ADVANCE_MS, adaptAgentState, useBoardState } from './useBoardState'

// The live path is exercised without a socket: the SDK hook is replaced by a
// stub that records the options it was called with so a test can invoke the
// callbacks the real socket would. Nothing here opens a network connection.
const captured = vi.hoisted(() => ({
  options: null as null | {
    host: string
    agent: string
    name?: string
    onStateUpdate?: (state: unknown, source: 'server' | 'client') => void
    onConnectionError?: (error: unknown) => void
    onClose?: (event: unknown) => void
  },
  calls: 0,
}))

vi.mock('agents/react', () => ({
  useAgent: (options: typeof captured.options) => {
    captured.options = options
    captured.calls += 1
    return {}
  },
}))

const MOCK_ENV: AppEnv = { apiBase: undefined, firehoseBase: undefined, mode: 'mock' }
const LIVE_ENV: AppEnv = {
  apiBase: 'https://judge.example.workers.dev',
  firehoseBase: undefined,
  mode: 'live',
}

const validPayload = {
  packets: [
    {
      id: 'live-1',
      stage: 'ingest',
      receivedAt: '2026-09-21T11:00:00.000Z',
      summary: { service: 'checkout', operation: 'POST /cart/items', durationMs: 40, statusCode: 200 },
    },
    {
      id: 'live-2',
      stage: 'verdict',
      receivedAt: '2026-09-21T11:00:01.000Z',
      summary: { service: 'payments', operation: 'POST /charge', durationMs: 900, statusCode: 502 },
      jev: { normal: 0.1, upstream_error: 0.9 },
      llama: { label: 'escalate', rationale: 'Upstream is failing.', actions: ['Page on-call'] },
    },
  ],
  producer: { scenario: 'mixed-traffic', ratePerSec: 3, paused: true },
  updatedAt: '2026-09-21T11:00:01.000Z',
}

describe('adaptAgentState', () => {
  it('adapts a valid payload preserving packet ids and stages', () => {
    const board = adaptAgentState(validPayload)
    expect(board).not.toBeNull()
    expect(board?.packets.map((packet) => [packet.id, packet.stage])).toEqual([
      ['live-1', 'ingest'],
      ['live-2', 'verdict'],
    ])
    expect(board?.packets[1]?.jev).toEqual({ normal: 0.1, upstream_error: 0.9 })
    expect(board?.packets[1]?.llama?.label).toBe('escalate')
    expect(board?.producer).toEqual({ scenario: 'mixed-traffic', ratePerSec: 3, paused: true })
    expect(board?.updatedAt).toBe('2026-09-21T11:00:01.000Z')
  })

  it('adapts a valid payload without sharing object identity with the input', () => {
    const board = adaptAgentState(validPayload)
    expect(board?.packets[0]).not.toBe(validPayload.packets[0])
    expect(board?.packets[0]?.summary).not.toBe(validPayload.packets[0]?.summary)
  })

  it('drops malformed packets while keeping the valid ones', () => {
    const board = adaptAgentState({
      packets: [
        validPayload.packets[0],
        { id: 42, stage: 'ingest' },
        { id: 'no-stage' },
        { id: 'bad-stage', stage: 'shipped' },
        null,
        'string',
        validPayload.packets[1],
      ],
    })
    expect(board?.packets.map((packet) => packet.id)).toEqual(['live-1', 'live-2'])
  })

  it('drops malformed packets but keeps a packet whose jev or llama field is unreadable', () => {
    const board = adaptAgentState({
      packets: [
        { id: 'odd-jev', stage: 'jev', jev: { normal: 'high' } },
        { id: 'odd-llama', stage: 'verdict', llama: { label: 'maybe', rationale: 1 } },
        { id: 'ok-llama', stage: 'verdict', llama: { label: 'pass', rationale: 'Fine.', actions: [] } },
      ],
    })
    expect(board?.packets.map((packet) => packet.id)).toEqual(['odd-jev', 'odd-llama', 'ok-llama'])
    expect(board?.packets[0]?.jev).toBeUndefined()
    expect(board?.packets[1]?.llama).toBeUndefined()
    expect(board?.packets[2]?.llama).toEqual({ label: 'pass', rationale: 'Fine.', actions: [] })
  })

  it('drops malformed packets but fills a missing summary with safe defaults', () => {
    const board = adaptAgentState({ packets: [{ id: 'bare', stage: 'jev' }, { id: '', stage: 'jev' }] })
    expect(board?.packets).toHaveLength(1)
    expect(board?.packets[0]).toEqual({
      id: 'bare',
      stage: 'jev',
      receivedAt: '',
      summary: { service: '', operation: '', durationMs: 0, statusCode: 0 },
    })
  })

  it('returns null for a wholly invalid payload', () => {
    expect(adaptAgentState({ packets: [{ id: 1 }, { stage: 'ingest' }, 'junk'] })).toBeNull()
    expect(adaptAgentState({ packets: 'not an array' })).toBeNull()
    expect(adaptAgentState({ items: [] })).toBeNull()
    expect(adaptAgentState([])).toBeNull()
    expect(adaptAgentState('state')).toBeNull()
  })

  it('returns null for a null or undefined payload', () => {
    expect(adaptAgentState(null)).toBeNull()
    expect(adaptAgentState(undefined)).toBeNull()
  })

  it('treats an empty packets array as an idle board rather than returning null', () => {
    const board = adaptAgentState({ packets: [] })
    expect(board).not.toBeNull()
    expect(board?.packets).toEqual([])
  })
})

describe('useBoardState', () => {
  beforeEach(() => {
    captured.options = null
    captured.calls = 0
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('mock mode yields the fixture and never opens a connection', () => {
    const { result } = renderHook(() => useBoardState({ env: MOCK_ENV }))
    expect(result.current.status).toBe('mock')
    expect(result.current.board).toEqual(mockBoardState())
    expect(captured.calls).toBe(0)
  })

  it('mock mode advances the fixture on the interval and stops on unmount', () => {
    const { result, unmount } = renderHook(() => useBoardState({ env: MOCK_ENV }))
    const first = result.current.board.packets.find((packet) => packet.id === 'pkt-0001')
    expect(first?.stage).toBe('ingest')

    act(() => {
      vi.advanceTimersByTime(MOCK_ADVANCE_MS)
    })
    const moved = result.current.board.packets.find((packet) => packet.id === 'pkt-0001')
    expect(moved?.stage).toBe('jev')

    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('mock mode is chosen whenever no Worker URL is configured, even if mode says live', () => {
    const { result } = renderHook(() => useBoardState({ env: { ...LIVE_ENV, apiBase: undefined } }))
    expect(result.current.status).toBe('mock')
    expect(captured.calls).toBe(0)
  })

  it('live mode connects to the configured host with the pinned agent identity', () => {
    const { result } = renderHook(() => useBoardState({ env: LIVE_ENV }))
    expect(result.current.status).toBe('connecting')
    expect(result.current.board).toEqual(mockBoardState())
    expect(captured.options).toMatchObject({
      host: 'https://judge.example.workers.dev',
      agent: 'judge-agent',
      name: 'board',
    })
  })

  it('live mode replaces the board wholesale on a valid update and reports live', () => {
    const { result } = renderHook(() => useBoardState({ env: LIVE_ENV }))

    act(() => {
      captured.options?.onStateUpdate?.(validPayload, 'server')
    })
    expect(result.current.status).toBe('live')
    expect(result.current.board.packets.map((packet) => packet.id)).toEqual(['live-1', 'live-2'])

    // A second push after a reconnect carries the same packets; nothing is
    // appended, so the board still holds exactly what the Worker sent.
    act(() => {
      captured.options?.onStateUpdate?.(validPayload, 'server')
    })
    expect(result.current.board.packets).toHaveLength(2)
  })

  it('live mode keeps the last good board and reports degraded on an unusable payload', () => {
    const { result } = renderHook(() => useBoardState({ env: LIVE_ENV }))
    act(() => {
      captured.options?.onStateUpdate?.(validPayload, 'server')
    })

    act(() => {
      captured.options?.onStateUpdate?.({ garbage: true }, 'server')
    })
    expect(result.current.status).toBe('degraded')
    expect(result.current.board.packets.map((packet) => packet.id)).toEqual(['live-1', 'live-2'])

    act(() => {
      captured.options?.onStateUpdate?.(validPayload, 'server')
    })
    expect(result.current.status).toBe('live')
  })

  it('live mode renders an empty packets array as a live, empty board', () => {
    const { result } = renderHook(() => useBoardState({ env: LIVE_ENV }))
    act(() => {
      captured.options?.onStateUpdate?.({ packets: [] }, 'server')
    })
    expect(result.current.status).toBe('live')
    expect(result.current.board.packets).toEqual([])
  })

  it('live mode reports connecting on a reconnecting close and degraded on a terminal error', () => {
    const { result } = renderHook(() => useBoardState({ env: LIVE_ENV }))
    act(() => {
      captured.options?.onStateUpdate?.(validPayload, 'server')
    })

    act(() => {
      captured.options?.onClose?.({})
    })
    expect(result.current.status).toBe('connecting')
    expect(result.current.board.packets).toHaveLength(2)

    // useAgent invokes onConnectionError before onClose on a terminal close.
    act(() => {
      captured.options?.onConnectionError?.(new Error('4003'))
      captured.options?.onClose?.({})
    })
    expect(result.current.status).toBe('degraded')
    expect(result.current.board.packets).toHaveLength(2)
  })

  it('live mode ignores a payload that arrives after unmount', () => {
    const { result, unmount } = renderHook(() => useBoardState({ env: LIVE_ENV }))
    unmount()
    expect(() => {
      captured.options?.onStateUpdate?.(validPayload, 'server')
    }).not.toThrow()
    expect(result.current.status).toBe('connecting')
  })

  it('live mode degrades to the fixture when the host fails the socket pre-flight', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { result } = renderHook(() => useBoardState({ env: { ...LIVE_ENV, apiBase: 'not a url' } }))
    expect(result.current.status).toBe('degraded')
    expect(result.current.board).toEqual(mockBoardState())
    expect(captured.calls).toBe(0)
    expect(error).toHaveBeenCalledOnce()
  })
})
