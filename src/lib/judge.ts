/**
 * Typed HTTP client for the otel-judge Worker.
 *
 * The board reads the Worker's Agent state over a socket; this module is the
 * one place the client asks the Worker to *change* that state, and today the
 * only such request is the reset that empties the board. Packet generation
 * stays with the firehose producer: nothing here invents telemetry.
 *
 * The request is unauthenticated and sent with credentials omitted. The bundle
 * is a public static site (FR3), so no credential of any kind may be read or
 * attached here.
 */

import { readEnv, type AppEnv } from './env'

/** Worker route that empties the board, relative to the validated API base. */
export const RESET_PATH = '/reset'

/** Upper bound on any single Worker request before it is aborted. */
export const JUDGE_TIMEOUT_MS = 8000

/** Longest slice of a rejected response body carried back to the UI. */
const ERROR_BODY_LIMIT = 200

/**
 * Mirrors the firehose client's result shape on purpose: the header controls
 * render both through one status line, so both clients hand back the same
 * three outcomes and never throw.
 */
export type JudgeResult =
  | {
      /** The Worker accepted the request with a 2xx status. */
      readonly kind: 'ok'
      readonly status: number
      /** Parsed JSON when the Worker returned JSON, otherwise the raw text. */
      readonly body: unknown
    }
  | {
      /** No Worker base is configured, so no request was issued. */
      readonly kind: 'disabled'
      readonly reason: string
    }
  | {
      /** The request was rejected, failed to reach the Worker, or timed out. */
      readonly kind: 'error'
      readonly message: string
      /** HTTP status when the Worker answered with a non-2xx response. */
      readonly status?: number
    }

export interface JudgeOptions {
  /** Pre-read environment, used by tests and by callers that already hold one. */
  readonly env?: AppEnv
  /** Override of the request timeout, primarily for tests. */
  readonly timeoutMs?: number
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
    return `Judge request timed out after ${timeoutMs}ms`
  }
  const detail = cause instanceof Error ? cause.message : String(cause)
  return `Judge request failed: ${detail}`
}

/**
 * Ask the Worker to drop every packet it is holding.
 *
 * The Worker gates this route behind ALLOW_BOARD_RESET and answers 403 when
 * the gate is off; that rejection comes back as an error result rather than an
 * exception, so the caller can say so on the status line and leave the board
 * alone. A successful reset is never applied locally: the board clears when
 * the Worker pushes its emptied state, which keeps the server the single
 * source of truth for what is on screen.
 */
export async function resetBoard(options: JudgeOptions = {}): Promise<JudgeResult> {
  const env = options.env ?? readEnv()
  if (env.apiBase === undefined) {
    return { kind: 'disabled', reason: 'VITE_API_BASE is not configured' }
  }

  const timeoutMs = options.timeoutMs ?? JUDGE_TIMEOUT_MS
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    // An empty object rather than no body at all: a handler that reads JSON
    // off the request gets valid JSON, and one that ignores it is unaffected.
    const response = await fetch(`${env.apiBase}${RESET_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
      credentials: 'omit',
      signal: controller.signal,
    })
    const text = await response.text()
    if (!response.ok) {
      return {
        kind: 'error',
        status: response.status,
        message: `Judge responded ${response.status}: ${truncate(text)}`,
      }
    }
    return { kind: 'ok', status: response.status, body: parseBody(text) }
  } catch (cause) {
    return { kind: 'error', message: describeFailure(cause, controller.signal.aborted, timeoutMs) }
  } finally {
    clearTimeout(timer)
  }
}
