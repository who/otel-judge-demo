import { afterEach, describe, expect, it, vi } from 'vitest'
import { readEnv } from './env'
import {
  DEFAULT_SCENARIO,
  EMIT_PATH,
  SCENARIOS,
  SCENARIOS_PATH,
  emitPackets,
  fetchScenarios,
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

    const result = await emitPackets('dependency_timeouts', 3, { env })

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0]!
    expect(url).toBe(`${BASE}${EMIT_PATH}`)
    expect(init?.method).toBe('POST')
    expect(init?.credentials).toBe('omit')
    expect(JSON.parse(String(init?.body))).toEqual({ scenario: 'dependency_timeouts', count: 3 })
    expect(result).toEqual({ kind: 'ok', status: 200, body: { accepted: 3 } })
  })

  it('treats a 2xx with a non-JSON body as ok', async () => {
    stubFetch(async () => new Response('queued', { status: 202 }))
    const result = await emitPackets('healthy', 1, { env })
    expect(result).toEqual({ kind: 'ok', status: 202, body: 'queued' })
  })

  it('rejects a zero or negative count before issuing a request', async () => {
    const fetchSpy = stubFetch(async () => jsonResponse({}))
    expect((await emitPackets('healthy', 0, { env })).kind).toBe('error')
    expect((await emitPackets('healthy', -2, { env })).kind).toBe('error')
    expect((await emitPackets('healthy', 1.5, { env })).kind).toBe('error')
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('disabled mode', () => {
  it('returns disabled without a request when no firehose base is configured', async () => {
    const fetchSpy = stubFetch(async () => jsonResponse({}))

    const emit = await emitPackets('healthy', 1, { env: mockEnv })
    // The listing has no disabled result of its own: a caller that cannot ask
    // and a caller that asked and got nothing usable are the same to it.
    const listed = await fetchScenarios({ env: mockEnv })

    expect(emit.kind).toBe('disabled')
    expect(listed).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('failure handling', () => {
  it('maps a non-2xx response to an error carrying the status and body', async () => {
    stubFetch(async () => new Response('x'.repeat(500), { status: 503 }))

    const result = await emitPackets('noise_storm', 2, { env })

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

    const result = await emitPackets('healthy', 1, { env, timeoutMs: 20 })

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
    const result = await emitPackets('healthy', 1, { env })
    expect(result).toEqual({ kind: 'error', message: 'Firehose request failed: Failed to fetch' })
  })
})

describe('scenario vocabulary', () => {
  it('reads the producer listing from the scenarios path', async () => {
    const fetchSpy = stubFetch(async () =>
      jsonResponse({
        scenarios: [
          { id: 'healthy', description: 'Service inside its objective.' },
          { id: 'demo_mix', description: 'Weighted blend for a demo board.' },
        ],
      }),
    )

    const listed = await fetchScenarios({ env })

    const [url, init] = fetchSpy.mock.calls[0]!
    expect(url).toBe(`${BASE}${SCENARIOS_PATH}`)
    expect(init?.method).toBe('GET')
    expect(init?.credentials).toBe('omit')
    expect(listed).toEqual([
      { id: 'healthy', description: 'Service inside its objective.' },
      { id: 'demo_mix', description: 'Weighted blend for a demo board.' },
    ])
  })

  it('keeps an entry whose description the producer omitted', async () => {
    stubFetch(async () => jsonResponse({ scenarios: [{ id: 'chaos' }] }))
    expect(await fetchScenarios({ env })).toEqual([{ id: 'chaos' }])
  })

  it('reports no listing when a producer does not serve the route', async () => {
    stubFetch(async () => new Response('not found', { status: 404 }))
    expect(await fetchScenarios({ env })).toBeNull()
  })

  it('reports no listing for a body it cannot read, including an empty one', async () => {
    stubFetch(async () => jsonResponse({ scenarios: [{ name: 'healthy' }] }))
    expect(await fetchScenarios({ env })).toBeNull()

    stubFetch(async () => jsonResponse({ scenarios: [] }))
    expect(await fetchScenarios({ env })).toBeNull()

    stubFetch(async () => jsonResponse({ ok: true }))
    expect(await fetchScenarios({ env })).toBeNull()
  })

  it('exports the fallback vocabulary with the demo default among it', () => {
    expect(SCENARIOS).toEqual([
      'healthy',
      'post_deploy_burn',
      'dependency_timeouts',
      'noise_storm',
      'chaos',
      'demo_mix',
    ])
    expect(DEFAULT_SCENARIO).toBe('demo_mix')
    expect(SCENARIOS).toContain(DEFAULT_SCENARIO)
  })
})
