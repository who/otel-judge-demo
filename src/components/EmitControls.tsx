import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { readEnv } from '../lib/env'
import type { AppEnv } from '../lib/env'
import { DEFAULT_SCENARIO, SCENARIOS, emitPackets, fetchScenarios } from '../lib/firehose'
import type { FirehoseResult, ScenarioOption } from '../lib/firehose'
import { resetBoard } from '../lib/judge'
import type { JudgeResult } from '../lib/judge'

/**
 * Packets requested per emit press. Enough to visibly populate the ingest
 * column, small enough that a repeated click never floods the board.
 */
export const EMIT_COUNT = 5

/**
 * The choice the dropdown offers until the producer's own listing arrives.
 * Built from the client's static vocabulary so an unreachable producer, or one
 * too old to serve a listing, still leaves a usable set of scenarios.
 */
const FALLBACK_SCENARIOS: readonly ScenarioOption[] = SCENARIOS.map((id) => ({ id }))

/**
 * What the status line says when a reviewer picks a scenario. The producer
 * holds no scenario of its own, so the only honest thing to report is that the
 * choice is waiting for the next press rather than that anything changed.
 */
export function scenarioSelectedText(scenario: string): string {
  return `Next emit sends ${scenario}`
}

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
 * chosen scenario.
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

/**
 * Header controls that drive the otel-judge-firehose producer: pick a
 * scenario, emit a burst of it, clear the board. Every action goes through the
 * firehose client; nothing here builds a request or generates a packet, and
 * the Agent is never asked to invent telemetry.
 *
 * The producer keeps no running stream, so the scenario is a local choice that
 * rides along with the next emit rather than a setting posted ahead of it.
 * Nothing but the emit itself can fail, and the controls say so: picking a
 * scenario never claims the producer changed underneath.
 *
 * Emit and reset share one in-flight flag, so a double click produces exactly
 * one request. The status line beneath the controls is a polite live region: a
 * success confirmation clears itself, an error stays until the next request
 * replaces it, and a missing firehose base leaves the controls disabled with
 * an explanation rather than removing them from the page.
 */
export function EmitControls({ env: envProp, onClearBoard }: EmitControlsProps) {
  const [env] = useState<AppEnv>(() => envProp ?? readEnv())

  // Configured is state rather than derived from env alone: a client call that
  // comes back disabled also flips it off, so the two signals never disagree.
  const [configured, setConfigured] = useState(env.firehoseBase !== undefined)
  // The controls open on demo_mix, so a reviewer who presses Emit without
  // touching anything gets packets across the failure classes rather than one
  // bucket's worth. A listing without it moves the selection; see below.
  const [scenario, setScenarioState] = useState<string>(DEFAULT_SCENARIO)
  const [scenarios, setScenarios] = useState<readonly ScenarioOption[]>(FALLBACK_SCENARIOS)
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
   * The producer's own listing is the real vocabulary; the static list is only
   * the opening guess. A listing that cannot be had leaves that guess in
   * place, so the dropdown is never empty, the status line is never troubled
   * by it, and an emit is never waiting on it. A chosen scenario the listing
   * does not carry falls back to the first one it does.
   */
  useEffect(() => {
    if (env.firehoseBase === undefined) return
    let cancelled = false
    void fetchScenarios({ env }).then((listed) => {
      if (cancelled || !mountedRef.current || listed === null) return
      const [first] = listed
      if (first === undefined) return
      setScenarios(listed)
      setScenarioState((current) =>
        listed.some((option) => option.id === current) ? current : first.id,
      )
    })
    return () => {
      cancelled = true
    }
  }, [env])

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
   * onto the status line. A call that settles after unmount is dropped where
   * it lands, before any of the three outcomes can touch state.
   */
  const run = useCallback(
    async (request: () => Promise<ClientResult>, successText: string): Promise<void> => {
      cancelClearTimer()
      setInFlight(true)
      const result = await request()
      if (!mountedRef.current) return
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
    },
    [announceOk, cancelClearTimer],
  )

  const handleEmit = useCallback(() => {
    void run(
      () => emitPackets(scenario, EMIT_COUNT, { env }),
      `Emitted ${EMIT_COUNT} ${scenario} packets via firehose`,
    )
  }, [env, run, scenario])

  // Choosing a scenario reaches nothing: the producer has no scenario to set,
  // and the emit above carries the choice with it. The status line confirms
  // the control was heard without claiming a request was made or succeeded.
  const handleScenarioChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      const next = event.target.value
      setScenarioState(next)
      announceOk(scenarioSelectedText(next))
    },
    [announceOk],
  )

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
          {/*
            The producer's description rides along as the option's title, so a
            reviewer hovering an unfamiliar id learns what it generates without
            the row growing wide enough to print all six.
          */}
          <select value={scenario} onChange={handleScenarioChange} disabled={disabled}>
            {scenarios.map(({ id, description }) => (
              <option key={id} value={id} title={description}>
                {id}
              </option>
            ))}
          </select>
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
