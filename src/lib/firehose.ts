/**
 * Typed HTTP client for the otel-judge-firehose producer.
 *
 * This module only asks the producer to emit packets or to change its
 * scenario and pause state. All packet generation, fixtures and chaos logic
 * live in otel-judge-firehose; nothing here may generate a packet locally.
 *
 * Every request is unauthenticated and sent with credentials omitted. The
 * bundle is a public static site (FR3), so no credential of any kind may be
 * read or attached here.
 */

import { readEnv, type AppEnv } from './env'

/** Scenario vocabulary the producer understands. Rendered by the controls from this one list. */
export const SCENARIOS = ['nominal', 'latency-spike', 'malformed', 'chaos'] as const

export type Scenario = (typeof SCENARIOS)[number]

/** Producer routes, each relative to the validated firehose base. */
export const EMIT_PATH = '/emit'
export const SCENARIO_PATH = '/scenario'
export const PAUSE_PATH = '/pause'

/** Upper bound on any single producer request before it is aborted. */
export const FIREHOSE_TIMEOUT_MS = 8000

/** Longest slice of a rejected response body carried back to the UI. */
const ERROR_BODY_LIMIT = 200

export type FirehoseResult =
  | {
      /** The producer accepted the request with a 2xx status. */
      readonly kind: 'ok'
      readonly status: number
      /** Parsed JSON when the producer returned JSON, otherwise the raw text. */
      readonly body: unknown
    }
  | {
      /** No firehose base is configured, so no request was issued. */
      readonly kind: 'disabled'
      readonly reason: string
    }
  | {
      /** The request was rejected, failed to reach the producer, or timed out. */
      readonly kind: 'error'
      readonly message: string
      /** HTTP status when the producer answered with a non-2xx response. */
      readonly status?: number
    }

export interface FirehoseOptions {
  /** Pre-read environment, used by tests and by callers that already hold one. */
  readonly env?: AppEnv
  /** Override of the request timeout, primarily for tests. */
  readonly timeoutMs?: number
}

export interface EmitRequest {
  readonly scenario: Scenario
  readonly count: number
}

export interface ScenarioRequest {
  readonly scenario: Scenario
  readonly ratePerSec: number
}

export interface PauseRequest {
  readonly paused: boolean
}

function truncate(text: string): string {
  return text.length > ERROR_BODY_LIMIT ? `${text.slice(0, ERROR_BODY_LIMIT)}…` : text
}

function parseBody(text: string): unknown {
  if (text === '') return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

/**
 * The abort rejection is a DOMException, which under jsdom does not inherit
 * from the realm's Error, so the signal itself is the source of truth for a
 * timeout rather than the shape of the thrown value.
 */
function describeFailure(cause: unknown, timedOut: boolean, timeoutMs: number): string {
  if (timedOut) {
    return `Firehose request timed out after ${timeoutMs}ms`
  }
  const detail = cause instanceof Error ? cause.message : String(cause)
  return `Firehose request failed: ${detail}`
}

/**
 * POST a JSON body to one producer path. Returns disabled without issuing a
 * request when no firehose base is configured, and never throws: every
 * failure mode is folded into the FirehoseResult so a demo control can render
 * a message instead of surfacing an unhandled rejection.
 */
async function postJson(
  path: string,
  payload: EmitRequest | ScenarioRequest | PauseRequest,
  options: FirehoseOptions = {},
): Promise<FirehoseResult> {
  const env = options.env ?? readEnv()
  if (env.firehoseBase === undefined) {
    return { kind: 'disabled', reason: 'VITE_FIREHOSE_BASE is not configured' }
  }

  const timeoutMs = options.timeoutMs ?? FIREHOSE_TIMEOUT_MS
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(`${env.firehoseBase}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      credentials: 'omit',
      signal: controller.signal,
    })
    const text = await response.text()
    if (!response.ok) {
      return {
        kind: 'error',
        status: response.status,
        message: `Firehose responded ${response.status}: ${truncate(text)}`,
      }
    }
    return { kind: 'ok', status: response.status, body: parseBody(text) }
  } catch (cause) {
    return { kind: 'error', message: describeFailure(cause, controller.signal.aborted, timeoutMs) }
  } finally {
    clearTimeout(timer)
  }
}

/** Ask the producer to emit `count` packets under `scenario`. */
export function emitPackets(
  scenario: Scenario,
  count: number,
  options?: FirehoseOptions,
): Promise<FirehoseResult> {
  if (!Number.isInteger(count) || count <= 0) {
    return Promise.resolve({
      kind: 'error',
      message: `Emit count must be a positive integer, received ${String(count)}`,
    })
  }
  return postJson(EMIT_PATH, { scenario, count }, options)
}

/** Switch the producer's running scenario and packet rate. */
export function setScenario(
  scenario: Scenario,
  ratePerSec: number,
  options?: FirehoseOptions,
): Promise<FirehoseResult> {
  if (!Number.isFinite(ratePerSec) || ratePerSec < 0) {
    return Promise.resolve({
      kind: 'error',
      message: `Rate per second must be a non-negative number, received ${String(ratePerSec)}`,
    })
  }
  return postJson(SCENARIO_PATH, { scenario, ratePerSec }, options)
}

/** Pause or resume the producer's continuous stream. */
export function setPaused(paused: boolean, options?: FirehoseOptions): Promise<FirehoseResult> {
  return postJson(PAUSE_PATH, { paused }, options)
}
