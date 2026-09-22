import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  EMIT_COUNT,
  EMIT_LABEL,
  EmitControls,
  NOT_CONFIGURED_TEXT,
  RESET_CONFIRM_TEXT,
  RESET_LABEL,
  RESET_MOCK_TEXT,
  STATUS_CLEAR_MS,
  scenarioSelectedText,
} from './EmitControls'
import { readEnv } from '../lib/env'
import type { AppEnv } from '../lib/env'
import { DEFAULT_SCENARIO, SCENARIOS, emitPackets, fetchScenarios } from '../lib/firehose'
import type { FirehoseResult } from '../lib/firehose'
import { RESET_PATH } from '../lib/judge'

// Both request functions are mocked; the rest of the module (SCENARIOS, the
// default, the types) stays real so the select falls back to the producer's
// true vocabulary whenever the listing is not the thing under test.
vi.mock('../lib/firehose', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/firehose')>()
  return {
    ...actual,
    emitPackets: vi.fn(),
    fetchScenarios: vi.fn(),
  }
})

const env = readEnv({ VITE_FIREHOSE_BASE: 'http://localhost:8788' })
const unconfiguredEnv = readEnv({})

// The reset path is the only one that talks to the Worker, so its tests run
// against a live env and the real judge client over a stubbed fetch.
const JUDGE_BASE = 'http://localhost:8787'
const liveEnv = readEnv({
  VITE_API_BASE: JUDGE_BASE,
  VITE_FIREHOSE_BASE: 'http://localhost:8788',
})

const OK: FirehoseResult = { kind: 'ok', status: 200, body: { accepted: EMIT_COUNT } }
const ERROR: FirehoseResult = { kind: 'error', status: 503, message: 'Firehose responded 503: down' }
const DISABLED: FirehoseResult = { kind: 'disabled', reason: 'VITE_FIREHOSE_BASE is not configured' }

function emitButton() {
  return screen.getByRole('button', { name: EMIT_LABEL })
}

function scenarioSelect() {
  return screen.getByRole('combobox', { name: 'Scenario' })
}

function scenarioOptions() {
  return screen.getAllByRole('option').map((option) => option.textContent)
}

function statusLine() {
  return screen.getByRole('status')
}

function resetButton() {
  return screen.getByRole('button', { name: RESET_LABEL })
}

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

/** Answer the native confirm without a real dialog, and record what it was asked. */
function stubConfirm(answer: boolean) {
  const spy = vi.fn(() => answer)
  vi.stubGlobal('confirm', spy)
  return spy
}

/** A request whose settlement the test controls. */
function deferred() {
  let resolve!: (result: FirehoseResult) => void
  const promise = new Promise<FirehoseResult>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

beforeEach(() => {
  vi.mocked(emitPackets).mockResolvedValue(OK)
  // No listing by default, which is the fallback path: a test that cares about
  // the producer's own vocabulary says so by resolving one.
  vi.mocked(fetchScenarios).mockResolvedValue(null)
})

afterEach(() => {
  vi.mocked(emitPackets).mockReset()
  vi.mocked(fetchScenarios).mockReset()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('EmitControls emit', () => {
  it('emits with the selected scenario and a fixed count', async () => {
    const user = userEvent.setup()
    render(<EmitControls env={env} />)

    await user.selectOptions(scenarioSelect(), 'chaos')
    await user.click(emitButton())

    expect(emitPackets).toHaveBeenCalledTimes(1)
    expect(emitPackets).toHaveBeenCalledWith('chaos', EMIT_COUNT, { env })
    expect(statusLine()).toHaveAttribute('data-tone', 'ok')
    expect(statusLine()).toHaveTextContent(/chaos/)
  })

  it('emits with the selected scenario: the default is the demo mix', async () => {
    const user = userEvent.setup()
    render(<EmitControls env={env} />)

    await user.click(emitButton())

    expect(emitPackets).toHaveBeenCalledWith(DEFAULT_SCENARIO, EMIT_COUNT, { env })
    expect(DEFAULT_SCENARIO).toBe('demo_mix')
  })

  it('emits with the selected scenario once per press: a double click sends one request', async () => {
    const pending = deferred()
    vi.mocked(emitPackets).mockReturnValue(pending.promise)
    const user = userEvent.setup()
    render(<EmitControls env={env} />)

    await user.dblClick(emitButton())

    expect(emitPackets).toHaveBeenCalledTimes(1)
    expect(emitButton()).toBeDisabled()
    expect(emitButton()).toHaveAttribute('aria-busy', 'true')

    await act(async () => {
      pending.resolve(OK)
      await pending.promise
    })

    expect(emitButton()).toBeEnabled()
    expect(emitButton()).not.toHaveAttribute('aria-busy')
  })

  it('clears a success confirmation after the timeout', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    render(<EmitControls env={env} />)

    await act(async () => {
      fireEvent.click(emitButton())
    })
    expect(statusLine()).toHaveAttribute('data-tone', 'ok')

    act(() => {
      vi.advanceTimersByTime(STATUS_CLEAR_MS)
    })
    expect(statusLine()).toHaveTextContent('')
    expect(statusLine()).not.toHaveAttribute('data-tone')
  })
})

describe('EmitControls failure', () => {
  it('error message persists rather than clearing on the success timer', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    vi.mocked(emitPackets).mockResolvedValue(ERROR)
    render(<EmitControls env={env} />)

    await act(async () => {
      fireEvent.click(emitButton())
    })

    expect(statusLine()).toHaveAttribute('data-tone', 'error')
    expect(statusLine()).toHaveTextContent(ERROR.kind === 'error' ? ERROR.message : '')

    act(() => {
      vi.advanceTimersByTime(STATUS_CLEAR_MS * 3)
    })
    expect(statusLine()).toHaveAttribute('data-tone', 'error')
    expect(emitButton()).toBeEnabled()
  })

  it('error message persists when an earlier success timer fires', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    vi.mocked(emitPackets).mockResolvedValueOnce(OK).mockResolvedValueOnce(ERROR)
    render(<EmitControls env={env} />)

    await act(async () => {
      fireEvent.click(emitButton())
    })
    expect(statusLine()).toHaveAttribute('data-tone', 'ok')

    act(() => {
      vi.advanceTimersByTime(STATUS_CLEAR_MS / 2)
    })
    await act(async () => {
      fireEvent.click(emitButton())
    })
    expect(statusLine()).toHaveAttribute('data-tone', 'error')

    // The first request's timer would have fired here had it not been cancelled.
    act(() => {
      vi.advanceTimersByTime(STATUS_CLEAR_MS)
    })
    expect(statusLine()).toHaveAttribute('data-tone', 'error')
  })

  it('does not set state after unmounting while a request is in flight', async () => {
    const pending = deferred()
    vi.mocked(emitPackets).mockReturnValue(pending.promise)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { unmount } = render(<EmitControls env={env} />)

    await act(async () => {
      fireEvent.click(emitButton())
    })
    unmount()
    await act(async () => {
      pending.resolve(OK)
      await pending.promise
    })

    expect(errorSpy).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})

describe('EmitControls disabled', () => {
  it('renders not configured with every producer control disabled when no base is set', async () => {
    const user = userEvent.setup()
    render(<EmitControls env={unconfiguredEnv} />)

    expect(statusLine()).toHaveTextContent(NOT_CONFIGURED_TEXT)
    expect(statusLine()).toHaveAttribute('data-tone', 'disabled')
    expect(emitButton()).toBeDisabled()
    expect(scenarioSelect()).toBeDisabled()

    await user.click(emitButton())
    expect(emitPackets).not.toHaveBeenCalled()
    // The listing is not asked for either: there is no producer to ask.
    expect(fetchScenarios).not.toHaveBeenCalled()
  })

  it('renders not configured when the client itself reports disabled', async () => {
    vi.mocked(emitPackets).mockResolvedValue(DISABLED)
    const user = userEvent.setup()
    render(<EmitControls env={env} />)

    expect(emitButton()).toBeEnabled()
    await user.click(emitButton())

    expect(statusLine()).toHaveTextContent(NOT_CONFIGURED_TEXT)
    expect(emitButton()).toBeDisabled()
    expect(scenarioSelect()).toBeDisabled()
  })
})

describe('EmitControls scenario choice', () => {
  it('chooses a scenario without reaching the producer and carries it into the next emit', async () => {
    const user = userEvent.setup()
    render(<EmitControls env={env} />)

    await user.selectOptions(scenarioSelect(), 'chaos')

    // Nothing is posted on the change: the producer holds no scenario to set,
    // so the choice is local until a press sends it.
    expect(emitPackets).not.toHaveBeenCalled()
    expect(scenarioSelect()).toHaveValue('chaos')
    expect(statusLine()).toHaveAttribute('data-tone', 'ok')
    expect(statusLine()).toHaveTextContent(scenarioSelectedText('chaos'))

    await user.click(emitButton())

    expect(emitPackets).toHaveBeenCalledWith('chaos', EMIT_COUNT, { env })
  })

  it('emits the chosen scenario even after the producer refused the last request', async () => {
    vi.mocked(emitPackets).mockResolvedValueOnce(ERROR).mockResolvedValueOnce(OK)
    const user = userEvent.setup()
    render(<EmitControls env={env} />)

    await user.click(emitButton())
    expect(statusLine()).toHaveAttribute('data-tone', 'error')

    await user.selectOptions(scenarioSelect(), 'noise_storm')
    await user.click(emitButton())

    expect(emitPackets).toHaveBeenLastCalledWith('noise_storm', EMIT_COUNT, { env })
  })

  it('renders the static vocabulary when the producer has no listing to give', async () => {
    render(<EmitControls env={env} />)
    await act(async () => {})

    expect(fetchScenarios).toHaveBeenCalledWith({ env })
    expect(scenarioOptions()).toEqual([...SCENARIOS])
    expect(scenarioSelect()).toHaveValue(DEFAULT_SCENARIO)
  })

  it('replaces the static vocabulary with the producer listing, descriptions and all', async () => {
    vi.mocked(fetchScenarios).mockResolvedValue([
      { id: 'healthy', description: 'Service inside its objective.' },
      { id: 'demo_mix' },
      { id: 'brand_new' },
    ])
    const user = userEvent.setup()
    render(<EmitControls env={env} />)
    await act(async () => {})

    expect(scenarioOptions()).toEqual(['healthy', 'demo_mix', 'brand_new'])
    expect(screen.getByRole('option', { name: 'healthy' })).toHaveAttribute(
      'title',
      'Service inside its objective.',
    )
    // A listing that still carries the default leaves the selection alone.
    expect(scenarioSelect()).toHaveValue(DEFAULT_SCENARIO)

    await user.selectOptions(scenarioSelect(), 'brand_new')
    await user.click(emitButton())

    expect(emitPackets).toHaveBeenCalledWith('brand_new', EMIT_COUNT, { env })
  })

  it('selects the first listed scenario when the producer has dropped the default', async () => {
    vi.mocked(fetchScenarios).mockResolvedValue([{ id: 'healthy' }, { id: 'chaos' }])
    const user = userEvent.setup()
    render(<EmitControls env={env} />)
    await act(async () => {})

    expect(scenarioSelect()).toHaveValue('healthy')

    await user.click(emitButton())

    expect(emitPackets).toHaveBeenCalledWith('healthy', EMIT_COUNT, { env })
  })
})

describe('EmitControls reset', () => {
  it('asks before resetting and does nothing at all when the answer is no', async () => {
    const fetchSpy = stubFetch(async () => jsonResponse({}))
    const confirmSpy = stubConfirm(false)
    const onClearBoard = vi.fn()
    const user = userEvent.setup()
    render(<EmitControls env={liveEnv} onClearBoard={onClearBoard} />)

    await user.click(resetButton())

    expect(confirmSpy).toHaveBeenCalledWith(RESET_CONFIRM_TEXT)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(onClearBoard).not.toHaveBeenCalled()
    expect(statusLine()).toHaveTextContent('')
  })

  it('asks before clearing a mock board too: no is no on either side', async () => {
    const confirmSpy = stubConfirm(false)
    const onClearBoard = vi.fn()
    const user = userEvent.setup()
    render(<EmitControls env={unconfiguredEnv} onClearBoard={onClearBoard} />)

    await user.click(resetButton())

    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(onClearBoard).not.toHaveBeenCalled()
  })

  it('posts the reset to the Worker route on the configured api base', async () => {
    const fetchSpy = stubFetch(async () => jsonResponse({ cleared: 12 }))
    stubConfirm(true)
    const onClearBoard = vi.fn()
    const user = userEvent.setup()
    render(<EmitControls env={liveEnv} onClearBoard={onClearBoard} />)

    await user.click(resetButton())

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0]!
    expect(url).toBe(`${JUDGE_BASE}${RESET_PATH}`)
    expect(init?.method).toBe('POST')
    expect(init?.credentials).toBe('omit')
    expect(statusLine()).toHaveAttribute('data-tone', 'ok')
    // The Worker's own state push empties the board; nothing is cleared here.
    expect(onClearBoard).not.toHaveBeenCalled()
  })

  it('reports a refused reset and leaves the board standing', async () => {
    stubFetch(async () => new Response('board reset is disabled', { status: 403 }))
    stubConfirm(true)
    const onClearBoard = vi.fn()
    const user = userEvent.setup()
    render(<EmitControls env={liveEnv} onClearBoard={onClearBoard} />)

    await user.click(resetButton())

    expect(statusLine()).toHaveAttribute('data-tone', 'error')
    expect(statusLine()).toHaveTextContent('403')
    expect(onClearBoard).not.toHaveBeenCalled()
  })

  it('sends one request per press even when the button is double clicked', async () => {
    let settle!: (response: Response) => void
    const pending = new Promise<Response>((resolve) => {
      settle = resolve
    })
    const fetchSpy = stubFetch(() => pending)
    stubConfirm(true)
    const user = userEvent.setup()
    render(<EmitControls env={liveEnv} onClearBoard={vi.fn()} />)

    await user.dblClick(resetButton())

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(resetButton()).toBeDisabled()

    await act(async () => {
      settle(jsonResponse({}))
      await pending
    })

    expect(resetButton()).toBeEnabled()
  })

  it('clears the mock board locally and never reaches the network', async () => {
    const fetchSpy = stubFetch(async () => jsonResponse({}))
    stubConfirm(true)
    const onClearBoard = vi.fn()
    const user = userEvent.setup()
    render(<EmitControls env={unconfiguredEnv} onClearBoard={onClearBoard} />)

    // The producer is unconfigured, so every other control is inert; reset is
    // about the board, not the producer, and stays usable.
    expect(emitButton()).toBeDisabled()
    expect(resetButton()).toBeEnabled()

    await user.click(resetButton())

    expect(onClearBoard).toHaveBeenCalledTimes(1)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(statusLine()).toHaveAttribute('data-tone', 'ok')
    expect(statusLine()).toHaveTextContent(RESET_MOCK_TEXT)
  })

  it('is inert when the page claims to be live with no Worker to ask', async () => {
    const brokenEnv: AppEnv = { apiBase: undefined, firehoseBase: undefined, mode: 'live' }
    const fetchSpy = stubFetch(async () => jsonResponse({}))
    const confirmSpy = stubConfirm(true)
    const onClearBoard = vi.fn()
    const user = userEvent.setup()
    render(<EmitControls env={brokenEnv} onClearBoard={onClearBoard} />)

    expect(resetButton()).toBeDisabled()
    await user.click(resetButton())

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(onClearBoard).not.toHaveBeenCalled()
  })
})
