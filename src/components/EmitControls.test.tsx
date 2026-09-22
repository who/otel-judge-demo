import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  EMIT_COUNT,
  EMIT_LABEL,
  EmitControls,
  NOT_CONFIGURED_TEXT,
  RATE_MAX,
  RATE_MIN,
  RESET_CONFIRM_TEXT,
  RESET_LABEL,
  RESET_MOCK_TEXT,
  STATUS_CLEAR_MS,
  clampRate,
} from './EmitControls'
import { readEnv } from '../lib/env'
import type { AppEnv } from '../lib/env'
import { SCENARIOS, emitPackets, setPaused, setScenario } from '../lib/firehose'
import type { FirehoseResult } from '../lib/firehose'
import { RESET_PATH } from '../lib/judge'

// The three request functions are mocked; the rest of the module (SCENARIOS,
// the types) stays real so the select renders the producer's true vocabulary.
vi.mock('../lib/firehose', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/firehose')>()
  return {
    ...actual,
    emitPackets: vi.fn(),
    setScenario: vi.fn(),
    setPaused: vi.fn(),
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

function rateInput() {
  return screen.getByRole('spinbutton', { name: 'Rate /s' })
}

function pauseSwitch() {
  return screen.getByRole('switch', { name: 'Pause producer' })
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
  vi.mocked(setScenario).mockResolvedValue(OK)
  vi.mocked(setPaused).mockResolvedValue(OK)
})

afterEach(() => {
  vi.mocked(emitPackets).mockReset()
  vi.mocked(setScenario).mockReset()
  vi.mocked(setPaused).mockReset()
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

  it('emits with the selected scenario: the default is the first producer scenario', async () => {
    const user = userEvent.setup()
    render(<EmitControls env={env} />)

    await user.click(emitButton())

    expect(emitPackets).toHaveBeenCalledWith(SCENARIOS[0], EMIT_COUNT, { env })
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
  it('renders not configured with every control disabled when no firehose base is set', async () => {
    const user = userEvent.setup()
    render(<EmitControls env={unconfiguredEnv} />)

    expect(statusLine()).toHaveTextContent(NOT_CONFIGURED_TEXT)
    expect(statusLine()).toHaveAttribute('data-tone', 'disabled')
    expect(emitButton()).toBeDisabled()
    expect(scenarioSelect()).toBeDisabled()
    expect(rateInput()).toBeDisabled()
    expect(pauseSwitch()).toBeDisabled()

    await user.click(emitButton())
    await user.click(pauseSwitch())
    expect(emitPackets).not.toHaveBeenCalled()
    expect(setPaused).not.toHaveBeenCalled()
    expect(pauseSwitch()).not.toBeChecked()
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
    expect(rateInput()).toBeDisabled()
    expect(pauseSwitch()).toBeDisabled()
  })
})

describe('EmitControls producer settings', () => {
  it('pause toggle calls the client with the new paused value each way', async () => {
    const user = userEvent.setup()
    render(<EmitControls env={env} />)

    await user.click(pauseSwitch())
    expect(setPaused).toHaveBeenLastCalledWith(true, { env })
    expect(pauseSwitch()).toBeChecked()

    await user.click(pauseSwitch())
    expect(setPaused).toHaveBeenLastCalledWith(false, { env })
    expect(pauseSwitch()).not.toBeChecked()
    expect(setPaused).toHaveBeenCalledTimes(2)
  })

  it('pause toggle stays inert when the producer rejects the change', async () => {
    vi.mocked(setPaused).mockResolvedValue(ERROR)
    const user = userEvent.setup()
    render(<EmitControls env={env} />)

    await user.click(pauseSwitch())

    expect(setPaused).toHaveBeenCalledWith(true, { env })
    expect(pauseSwitch()).not.toBeChecked()
    expect(statusLine()).toHaveAttribute('data-tone', 'error')
  })

  it('posts the scenario immediately on change with the current rate', async () => {
    const user = userEvent.setup()
    render(<EmitControls env={env} />)

    await user.selectOptions(scenarioSelect(), 'latency-spike')

    expect(setScenario).toHaveBeenCalledWith('latency-spike', Number(rateInput().getAttribute('value')), {
      env,
    })
  })

  it('clamps a rate outside the bounds before posting it', async () => {
    render(<EmitControls env={env} />)

    await act(async () => {
      fireEvent.change(rateInput(), { target: { value: '500' } })
    })
    expect(setScenario).toHaveBeenLastCalledWith(SCENARIOS[0], RATE_MAX, { env })
    expect(rateInput()).toHaveValue(RATE_MAX)

    await act(async () => {
      fireEvent.change(rateInput(), { target: { value: '0' } })
    })
    expect(setScenario).toHaveBeenLastCalledWith(SCENARIOS[0], RATE_MIN, { env })
    expect(rateInput()).toHaveValue(RATE_MIN)
  })

  it('clamps: the helper rounds and bounds without touching in-range values', () => {
    expect(clampRate(7)).toBe(7)
    expect(clampRate(0)).toBe(RATE_MIN)
    expect(clampRate(-3)).toBe(RATE_MIN)
    expect(clampRate(99)).toBe(RATE_MAX)
    expect(clampRate(2.6)).toBe(3)
  })

  it('renders every producer scenario as a select option', () => {
    render(<EmitControls env={env} />)
    const options = screen.getAllByRole('option').map((option) => option.textContent)
    expect(options).toEqual([...SCENARIOS])
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
