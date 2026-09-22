/**
 * Typed HTTP client for the otel-judge-firehose producer.
 *
 * The producer offers the demo two routes: a listing of the scenarios it
 * registers, and an emit. It runs no continuous stream, so there is nothing
 * here to set running, to re-rate, or to pause: a burst is asked for one call
 * at a time and the scenario travels with that call rather than being
 * installed beforehand.
 *
 * All packet generation, fixtures and chaos logic live in otel-judge-firehose;
 * nothing here may generate a packet locally.
 *
 * Every request is unauthenticated and sent with credentials omitted. The
 * bundle is a public static site (FR3), so no credential of any kind may be
 * read or attached here.
 */

import { readEnv, type AppEnv } from './env'

/**
 * Scenario identifiers the producer registers, in its own listing order. The
 * controls open on this list and replace it with whatever the producer
 * actually answers with, so a deployment that has grown a scenario since this
 * bundle was built still offers it.
 */
export const SCENARIOS = [
  'healthy',
  'post_deploy_burn',
  'dependency_timeouts',
  'noise_storm',
  'chaos',
  'demo_mix',
] as const

export type Scenario = (typeof SCENARIOS)[number]

/**
 * The scenario a demo opens on. One emit of demo_mix spreads packets across
 * the failure classes rather than filling a single verdict bucket, which is
 * what a reviewer watching the board for the first time wants to see.
 */
export const DEFAULT_SCENARIO: Scenario = 'demo_mix'

/** Producer routes, each relative to the validated firehose base. */
export const EMIT_PATH = '/emit'
export const SCENARIOS_PATH = '/scenarios'

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
  /**
   * A registered scenario identifier. Typed as a plain string rather than as
   * `Scenario` because the producer's listing, not this module, is the final
   * word on what is registered; an unknown one comes back as an HTTP 400.
   */
  readonly scenario: string
  readonly count: number
}

/** One entry of the producer's scenario listing. */
export interface ScenarioOption {
  readonly id: string
  /** The producer's own description of the scenario, when it sent one. */
  readonly description?: string
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
 * Issue one request to a producer path. Returns disabled without touching the
 * network when no firehose base is configured, and never throws: every failure
 * mode is folded into the FirehoseResult so a demo control can render a
 * message instead of surfacing an unhandled rejection.
 */
async function request(
  path: string,
  init: RequestInit,
  options: FirehoseOptions,
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
      ...init,
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

function postJson(
  path: string,
  payload: EmitRequest,
  options: FirehoseOptions = {},
): Promise<FirehoseResult> {
  return request(
    path,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    },
    options,
  )
}

/**
 * Ask the producer to emit `count` packets under `scenario`.
 *
 * This is the whole of the demo's control over what lands on the board: the
 * scenario is part of the request, so whichever one the reviewer has chosen
 * takes effect on the next press with nothing to install first.
 */
export function emitPackets(
  scenario: string,
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

/** Reads a `{ scenarios: [{ id, description }] }` body, or null for anything else. */
function parseScenarioList(body: unknown): readonly ScenarioOption[] | null {
  if (typeof body !== 'object' || body === null) return null
  const { scenarios } = body as { scenarios?: unknown }
  if (!Array.isArray(scenarios)) return null

  const listed: ScenarioOption[] = []
  for (const entry of scenarios) {
    if (typeof entry !== 'object' || entry === null) return null
    const { id, description } = entry as { id?: unknown; description?: unknown }
    if (typeof id !== 'string' || id === '') return null
    listed.push(typeof description === 'string' ? { id, description } : { id })
  }
  // An empty listing is treated as no answer: a producer with no scenario to
  // offer would leave the dropdown blank, and the static list is better.
  return listed.length === 0 ? null : listed
}

/**
 * Ask the producer which scenarios it registers.
 *
 * Returns null whenever the listing cannot be had — no firehose configured, an
 * older producer that does not serve the route, a rejected request, an
 * unreadable answer — so the caller keeps the list it already has rather than
 * rendering an empty choice. Asking is therefore always safe, and never a
 * precondition for emitting.
 */
export async function fetchScenarios(
  options: FirehoseOptions = {},
): Promise<readonly ScenarioOption[] | null> {
  const result = await request(SCENARIOS_PATH, { method: 'GET' }, options)
  return result.kind === 'ok' ? parseScenarioList(result.body) : null
}
