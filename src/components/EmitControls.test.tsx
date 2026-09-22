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
  STATUS_CLEAR_MS,
  clampRate,
} from './EmitControls'
import { readEnv } from '../lib/env'
import { SCENARIOS, emitPackets, setPaused, setScenario } from '../lib/firehose'
import type { FirehoseResult } from '../lib/firehose'

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
