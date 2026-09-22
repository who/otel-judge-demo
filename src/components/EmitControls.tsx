import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { readEnv } from '../lib/env'
import type { AppEnv } from '../lib/env'
import { SCENARIOS, emitPackets, setPaused, setScenario } from '../lib/firehose'
import type { FirehoseResult, Scenario } from '../lib/firehose'

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
}

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
export function EmitControls({ env: envProp }: EmitControlsProps) {
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
   * Run one client call with the shared in-flight guard and map its result
   * onto the status line. Returns the result so the caller can decide whether
   * to commit optimistic local state, which is how the pause toggle stays
   * inert when the producer did not actually change.
   */
  const run = useCallback(
    async (request: () => Promise<FirehoseResult>, successText: string): Promise<FirehoseResult | null> => {
      cancelClearTimer()
      setInFlight(true)
      const result = await request()
      if (!mountedRef.current) return null
      setInFlight(false)

      switch (result.kind) {
        case 'ok':
          setStatus({ tone: 'ok', text: successText })
          clearTimerRef.current = setTimeout(() => {
            clearTimerRef.current = null
            if (mountedRef.current) setStatus(null)
          }, STATUS_CLEAR_MS)
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
    [cancelClearTimer],
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
