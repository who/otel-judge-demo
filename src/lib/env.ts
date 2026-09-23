/**
 * Single validated accessor for the public base URLs this demo needs.
 *
 * Both values are public origins. Nothing here may read a credential: the
 * secret-name guard below turns an accidental TYPESAFE_API_KEY or similar in
 * the Pages build into a loud startup failure instead of a leaked bundle.
 */

/** Name of the Agent class exposed by the Judge Worker. */
export const AGENT_NAME = 'otel-judge-agent'

/** Instance name the board connects to on that Agent. */
export const AGENT_INSTANCE = 'board'

export type AppMode = 'live' | 'mock'

export interface AppEnv {
  /** Worker origin with any trailing slash removed, or undefined when unset or malformed. */
  readonly apiBase: string | undefined
  /** Firehose producer origin with any trailing slash removed, or undefined when unset or malformed. */
  readonly firehoseBase: string | undefined
  /** `live` when the Worker base is present, otherwise `mock`. */
  readonly mode: AppMode
}

/** Any exposed key containing one of these fragments is treated as a credential. */
const SECRET_FRAGMENTS = ['KEY', 'TOKEN', 'SECRET'] as const

/**
 * Vite only exposes keys carrying this prefix to the client bundle, so these
 * are the only keys that could ever ship a value to the browser. Scanning
 * unprefixed keys would be noise: under Vitest, import.meta.env also mirrors
 * the whole process environment, which is never part of the bundle.
 */
const EXPOSED_PREFIX = 'VITE_'

type EnvRecord = Readonly<Record<string, unknown>>

/**
 * Trim, validate and normalise one URL value. Returns undefined for unset,
 * empty, non-http(s) or unparsable values so the caller degrades to mock mode.
 */
export function normaliseBase(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (trimmed === '') return undefined

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return undefined
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined

  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed
}

/**
 * Throw when any client-exposed env key looks like a credential. Public URLs
 * are the only values this client may carry (FR3).
 */
export function assertNoSecrets(env: EnvRecord): void {
  for (const key of Object.keys(env)) {
    const upper = key.toUpperCase()
    if (!upper.startsWith(EXPOSED_PREFIX)) continue
    const hit = SECRET_FRAGMENTS.find((fragment) => upper.includes(fragment))
    if (hit) {
      throw new Error(
        `Refusing to start: env variable "${key}" looks like a credential (contains ${hit}). ` +
          'This client ships as a public static bundle and must only carry public URLs.',
      )
    }
  }
}

/**
 * Read and validate the public configuration. Validation runs here, not at
 * module top level, so importing this module never throws.
 */
export function readEnv(env: EnvRecord = import.meta.env): AppEnv {
  assertNoSecrets(env)
  const apiBase = normaliseBase(env.VITE_API_BASE)
  const firehoseBase = normaliseBase(env.VITE_FIREHOSE_BASE)
  return {
    apiBase,
    firehoseBase,
    mode: apiBase === undefined ? 'mock' : 'live',
  }
}
