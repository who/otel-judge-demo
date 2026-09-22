import type { ConnectionStatus } from '../hooks/useBoardState'

export interface ConnectionBadgeProps {
  /** Where the board's data is coming from, exactly as the hook reports it. */
  status: ConnectionStatus
  /**
   * The validated Worker origin, when one is configured. Only its hostname is
   * ever shown, and only while the status is live. Undefined for every other
   * status, and for a live mount whose origin is somehow unavailable.
   */
  origin?: string | undefined
}

interface StatusCopy {
  /** The status word, always rendered in text so colour is never the only cue. */
  label: string
  /** Short explanation shown beside the word for every status except live. */
  detail: string
}

/**
 * One entry per status the hook can report. Mock and degraded read
 * differently on purpose: mock is a deliberate offline demo, degraded is a
 * connection problem. Collapsing them would hide a real outage behind a
 * benign-looking label.
 */
export const CONNECTION_COPY: Readonly<Record<ConnectionStatus, StatusCopy>> = {
  connecting: { label: 'Connecting', detail: 'Opening the Judge Worker connection' },
  live: { label: 'Live', detail: 'Streaming from the Judge Worker' },
  degraded: { label: 'Degraded', detail: 'Worker connection failed; showing the last good board' },
  mock: { label: 'Mock', detail: 'No Worker configured; running on the local fixture' },
}

/**
 * Hostname of an origin, or undefined when none is supplied or it does not
 * parse. The env module has already rejected malformed values before they
 * reach here, so the catch is belt and braces rather than an expected path.
 */
export function originHostname(origin: string | undefined): string | undefined {
  if (origin === undefined) return undefined
  try {
    return new URL(origin).hostname
  } catch {
    return undefined
  }
}

/**
 * Header badge that makes the board's data source unambiguous: connecting,
 * live, degraded or mock. The status word is always text; the semantic
 * colour set through data-status is a secondary cue.
 *
 * The container is a polite live region, so a status change is announced
 * rather than only appearing. Polite supersedes rather than queues, which is
 * what keeps rapid flapping from building a backlog of announcements.
 *
 * In the live state the detail is the Worker hostname rather than the full
 * URL: it proves the connection target without turning the header into a URL
 * bar. A live status with no origin renders the label alone.
 */
export function ConnectionBadge({ status, origin }: ConnectionBadgeProps) {
  const copy = CONNECTION_COPY[status]
  const hostname = status === 'live' ? originHostname(origin) : undefined
  const detail = status === 'live' ? hostname : copy.detail

  return (
    <div className="connection-badge" data-status={status} role="status" aria-live="polite">
      <span className="connection-badge__label">{copy.label}</span>
      {detail !== undefined && (
        <span className="connection-badge__detail" data-origin={hostname !== undefined ? '' : undefined}>
          {detail}
        </span>
      )}
    </div>
  )
}
