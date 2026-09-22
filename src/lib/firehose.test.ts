import { afterEach, describe, expect, it, vi } from 'vitest'
import { readEnv } from './env'
import {
  EMIT_PATH,
  PAUSE_PATH,
  SCENARIO_PATH,
  SCENARIOS,
  emitPackets,
  setPaused,
  setScenario,
} from './firehose'

const BASE = 'http://localhost:8788'
const env = readEnv({ VITE_FIREHOSE_BASE: `${BASE}/` })
const mockEnv = readEnv({})

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

function stubFetch(impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  const spy = vi.fn(impl)
  vi.stubGlobal('fetch', spy)
  return spy
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('emitPackets', () => {
  it('posts an emit with the scenario and count to the firehose base', async () => {
    const fetchSpy = stubFetch(async () => jsonResponse({ accepted: 3 }))

    const result = await emitPackets('latency-spike', 3, { env })

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0]!
    expect(url).toBe(`${BASE}${EMIT_PATH}`)
    expect(init?.method).toBe('POST')
    expect(init?.credentials).toBe('omit')
    expect(JSON.parse(String(init?.body))).toEqual({ scenario: 'latency-spike', count: 3 })
    expect(result).toEqual({ kind: 'ok', status: 200, body: { accepted: 3 } })
  })

  it('treats a 2xx with a non-JSON body as ok', async () => {
    stubFetch(async () => new Response('queued', { status: 202 }))
    const result = await emitPackets('nominal', 1, { env })
    expect(result).toEqual({ kind: 'ok', status: 202, body: 'queued' })
  })

  it('rejects a zero or negative count before issuing a request', async () => {
    const fetchSpy = stubFetch(async () => jsonResponse({}))
    expect((await emitPackets('nominal', 0, { env })).kind).toBe('error')
    expect((await emitPackets('nominal', -2, { env })).kind).toBe('error')
    expect((await emitPackets('nominal', 1.5, { env })).kind).toBe('error')
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('disabled mode', () => {
  it('returns disabled without a request when no firehose base is configured', async () => {
    const fetchSpy = stubFetch(async () => jsonResponse({}))

    const emit = await emitPackets('nominal', 1, { env: mockEnv })
    const scenario = await setScenario('chaos', 2, { env: mockEnv })
    const pause = await setPaused(true, { env: mockEnv })

    expect(emit.kind).toBe('disabled')
    expect(scenario.kind).toBe('disabled')
    expect(pause.kind).toBe('disabled')
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('failure handling', () => {
  it('maps a non-2xx response to an error carrying the status and body', async () => {
    stubFetch(async () => new Response('x'.repeat(500), { status: 503 }))

    const result = await emitPackets('malformed', 2, { env })

    expect(result.kind).toBe('error')
    if (result.kind !== 'error') return
    expect(result.status).toBe(503)
    expect(result.message).toContain('503')
    expect(result.message.length).toBeLessThan(260)
  })

  it('aborts a request that exceeds the timeout and returns an error', async () => {
    const fetchSpy = stubFetch(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'))
          })
        }),
    )

    const result = await emitPackets('nominal', 1, { env, timeoutMs: 20 })

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(fetchSpy.mock.calls[0]![1]?.signal?.aborted).toBe(true)
    expect(result.kind).toBe('error')
    if (result.kind !== 'error') return
    expect(result.status).toBeUndefined()
    expect(result.message).toMatch(/timed out after 20ms/)
  })

  it('maps a network failure to an error result rather than throwing', async () => {
    stubFetch(async () => {
      throw new TypeError('Failed to fetch')
    })
    const result = await setPaused(false, { env })
    expect(result).toEqual({ kind: 'error', message: 'Firehose request failed: Failed to fetch' })
  })
})

describe('scenario and pause controls', () => {
  it('posts the scenario and rate to the scenario path', async () => {
    const fetchSpy = stubFetch(async () => jsonResponse({ ok: true }))
    await setScenario('chaos', 5, { env })
    const [url, init] = fetchSpy.mock.calls[0]!
    expect(url).toBe(`${BASE}${SCENARIO_PATH}`)
    expect(JSON.parse(String(init?.body))).toEqual({ scenario: 'chaos', ratePerSec: 5 })
  })

  it('posts the paused flag to the pause path', async () => {
    const fetchSpy = stubFetch(async () => jsonResponse({ ok: true }))
    await setPaused(true, { env })
    const [url, init] = fetchSpy.mock.calls[0]!
    expect(url).toBe(`${BASE}${PAUSE_PATH}`)
    expect(JSON.parse(String(init?.body))).toEqual({ paused: true })
  })

  it('exports the scenario vocabulary as one list', () => {
    expect(SCENARIOS).toEqual(['nominal', 'latency-spike', 'malformed', 'chaos'])
  })
})
