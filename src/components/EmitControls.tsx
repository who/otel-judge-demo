import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { readEnv } from '../lib/env'
import type { AppEnv } from '../lib/env'
import { SCENARIOS, emitPackets, setPaused, setScenario } from '../lib/firehose'
import type { FirehoseResult, Scenario } from '../lib/firehose'
import { resetBoard } from '../lib/judge'
import type { JudgeResult } from '../lib/judge'

/**
 * Packets requested per emit press. Enough to visibly populate the ingest
 * column, small enough that a repeated click never floods the board.
 */
export const EMIT_COUNT = 5

/** Inclusive bounds on the producer rate a reviewer may request. */
export const RATE_MIN = 1
export const RATE_MAX = 50

/** Producer rate the controls start at before the reviewer touches them. */
export const DEFAULT_RATE = 2

/** How long a success confirmation stays on screen. Errors never auto-clear. */
export const STATUS_CLEAR_MS = 4000

/**
 * The button names the path on purpose. The PRD forbids an emit control that
 * reads as asking the Agent to invent telemetry; every packet comes from the
 * firehose producer and the label says so.
 */
export const EMIT_LABEL = 'Emit via firehose'

/** Shown in place of a result whenever no firehose base is configured. */
export const NOT_CONFIGURED_TEXT = 'Firehose not configured'

/**
 * The reset control is deliberately plain-spoken: it drops every packet the
 * board is holding, which during a demo is a thing you only want to do on
 * purpose. The name says "board" so it cannot be misread as resetting the
 * producer's scenario or rate.
 */
export const RESET_LABEL = 'Reset board'

/** Copy of the native confirm that guards the reset. */
export const RESET_CONFIRM_TEXT =
  'Reset the board? Every packet on it is dropped and this cannot be undone.'

/** Confirmation shown once the Judge accepts a reset. */
export const RESET_LIVE_TEXT = 'Board reset requested from the Judge'

/** Confirmation shown once the local mock board is cleared. */
export const RESET_MOCK_TEXT = 'Mock board cleared'

export type StatusTone = 'ok' | 'error' | 'disabled'

export interface StatusMessage {
  readonly tone: StatusTone
  readonly text: string
}

export interface EmitControlsProps {
  /**
   * Validated public config, shared with the board hook so the controls and
   * the badge agree on which producer the page is pointed at. Defaults to
   * reading import.meta.env once on mount.
   */
  env?: AppEnv
  /**
   * Empties the board the hook is holding. Only called in mock mode, where
   * the board on screen is a local fixture and there is no Worker to ask;
   * a live reset goes to the Judge and arrives back as a state push.
   */
  onClearBoard?: () => void
}

/** Either client's result. The two shapes match so one status line renders both. */
type ClientResult = FirehoseResult | JudgeResult

/** Clamp a requested rate into the producer's accepted range. */
export function clampRate(value: number): number {
  return Math.min(RATE_MAX, Math.max(RATE_MIN, Math.round(value)))
}

function isScenario(value: string): value is Scenario {
  return (SCENARIOS as readonly string[]).includes(value)
}

/**
 * Header controls that drive the otel-judge-firehose producer: emit a burst,
 * pick a scenario, set a rate, pause the stream. Every action goes through the
 * firehose client; nothing here builds a request or generates a packet, and
 * the Agent is never asked to invent telemetry.
 *
 * All four controls share one in-flight flag, so a double click produces
 * exactly one request and a scenario change cannot race an emit. The status
 * line beneath the controls is a polite live region: a success confirmation
 * clears itself, an error stays until the next request replaces it, and a
 * missing firehose base leaves the controls disabled with an explanation
 * rather than removing them from the page.
 */
export function EmitControls({ env: envProp, onClearBoard }: EmitControlsProps) {
  const [env] = useState<AppEnv>(() => envProp ?? readEnv())

  // Configured is state rather than derived from env alone: a client call that
  // comes back disabled also flips it off, so the two signals never disagree.
  const [configured, setConfigured] = useState(env.firehoseBase !== undefined)
  const [scenario, setScenarioState] = useState<Scenario>(SCENARIOS[0])
  const [rate, setRate] = useState(DEFAULT_RATE)
  const [paused, setPausedState] = useState(false)
  const [inFlight, setInFlight] = useState(false)
  const [status, setStatus] = useState<StatusMessage | null>(() =>
    env.firehoseBase === undefined ? { tone: 'disabled', text: NOT_CONFIGURED_TEXT } : null,
  )

  // Both refs guard against a settled request touching state after the
  // component is gone, and against an older success timer wiping a newer
  // error: the timer is cancelled whenever a request starts or on unmount.
  const mountedRef = useRef(true)
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cancelClearTimer = useCallback(() => {
    if (clearTimerRef.current !== null) {
      clearTimeout(clearTimerRef.current)
      clearTimerRef.current = null
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      cancelClearTimer()
    }
  }, [cancelClearTimer])

  /**
   * Put a success on the status line and schedule its own removal. Shared by
   * the request path and by the mock reset, which has no request to await but
   * should read the same way to a reviewer.
   */
  const announceOk = useCallback(
    (text: string) => {
      cancelClearTimer()
      setStatus({ tone: 'ok', text })
      clearTimerRef.current = setTimeout(() => {
        clearTimerRef.current = null
        if (mountedRef.current) setStatus(null)
      }, STATUS_CLEAR_MS)
    },
    [cancelClearTimer],
  )

  /**
   * Run one client call with the shared in-flight guard and map its result
   * onto the status line. Returns the result so the caller can decide whether
   * to commit optimistic local state, which is how the pause toggle stays
   * inert when the producer did not actually change.
   */
  const run = useCallback(
    async (request: () => Promise<ClientResult>, successText: string): Promise<ClientResult | null> => {
      cancelClearTimer()
      setInFlight(true)
      const result = await request()
      if (!mountedRef.current) return null
      setInFlight(false)

      switch (result.kind) {
        case 'ok':
          announceOk(successText)
          break
        case 'error':
          setStatus({ tone: 'error', text: result.message })
          break
        case 'disabled':
          setConfigured(false)
          setStatus({ tone: 'disabled', text: NOT_CONFIGURED_TEXT })
          break
      }
      return result
    },
    [announceOk, cancelClearTimer],
  )

  const handleEmit = useCallback(() => {
    void run(
      () => emitPackets(scenario, EMIT_COUNT, { env }),
      `Emitted ${EMIT_COUNT} ${scenario} packets via firehose`,
    )
  }, [env, run, scenario])

  // Scenario and rate post immediately on change. The local value is committed
  // first so the control reflects what the reviewer chose even if the producer
  // rejects it; the error line tells them it did not take.
  const handleScenarioChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      const next = event.target.value
      if (!isScenario(next)) return
      setScenarioState(next)
      void run(() => setScenario(next, rate, { env }), `Scenario set to ${next} at ${rate}/s`)
    },
    [env, rate, run],
  )

  const handleRateChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const parsed = Number(event.target.value)
      if (event.target.value.trim() === '' || !Number.isFinite(parsed)) return
      const next = clampRate(parsed)
      setRate(next)
      void run(() => setScenario(scenario, next, { env }), `Scenario set to ${scenario} at ${next}/s`)
    },
    [env, run, scenario],
  )

  // The paused flag only flips once the producer confirms, so an error or a
  // disabled client leaves the switch exactly where it was.
  const handlePauseToggle = useCallback(() => {
    const next = !paused
    void run(() => setPaused(next, { env }), next ? 'Producer paused' : 'Producer resumed').then(
      (result) => {
        if (result?.kind === 'ok') setPausedState(next)
      },
    )
  }, [env, paused, run])

  /**
   * Reset is the one control that survives a missing firehose: clearing the
   * board has nothing to do with the producer. It is unavailable only while
   * another request is settling, or when the page claims to be live without a
   * Worker to send the reset to.
   */
  const resettable = env.mode !== 'live' || env.apiBase !== undefined
  const resetDisabled = !resettable || inFlight

  /**
   * The confirm is native and blocking on purpose: a reviewer mid-demo gets
   * one unmissable question, and Cancel leaves both the Judge and the board
   * untouched. Mock mode never reaches the network, because the packets on
   * screen were never on a Worker to begin with.
   */
  const handleReset = useCallback(() => {
    if (resetDisabled) return
    if (!window.confirm(RESET_CONFIRM_TEXT)) return
    if (env.mode !== 'live') {
      onClearBoard?.()
      announceOk(RESET_MOCK_TEXT)
      return
    }
    // A live reset cannot come back disabled: the button is already inert
    // without an apiBase, which is the only case the client refuses.
    void run(() => resetBoard({ env }), RESET_LIVE_TEXT)
  }, [announceOk, env, onClearBoard, resetDisabled, run])

  const disabled = !configured || inFlight

  return (
    <div className="emit-controls" data-configured={configured ? 'true' : 'false'}>
      <div className="emit-controls__row">
        <button
          type="button"
          className="emit-controls__emit"
          onClick={handleEmit}
          disabled={disabled}
          aria-busy={inFlight ? 'true' : undefined}
        >
          {EMIT_LABEL}
        </button>

        <label className="emit-controls__field">
          <span className="emit-controls__label">Scenario</span>
          <select value={scenario} onChange={handleScenarioChange} disabled={disabled}>
            {SCENARIOS.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>

        <label className="emit-controls__field">
          <span className="emit-controls__label">Rate /s</span>
          <input
            type="number"
            inputMode="numeric"
            min={RATE_MIN}
            max={RATE_MAX}
            step={1}
            value={rate}
            onChange={handleRateChange}
            disabled={disabled}
          />
        </label>

        <label className="emit-controls__field emit-controls__switch">
          <input
            type="checkbox"
            role="switch"
            checked={paused}
            onChange={handlePauseToggle}
            disabled={disabled}
          />
          <span className="emit-controls__label">Pause producer</span>
        </label>

        <button
          type="button"
          className="emit-controls__reset"
          onClick={handleReset}
          disabled={resetDisabled}
          aria-busy={inFlight ? 'true' : undefined}
        >
          {RESET_LABEL}
        </button>
      </div>

      <p
        className="emit-controls__status"
        role="status"
        aria-live="polite"
        data-tone={status?.tone}
      >
        {status?.text ?? ''}
      </p>
    </div>
  )
}
