import { render, screen } from '@testing-library/react'
import { CONNECTION_COPY, ConnectionBadge, originHostname } from './ConnectionBadge'
import type { ConnectionStatus } from '../hooks/useBoardState'

const STATUSES: readonly ConnectionStatus[] = ['connecting', 'live', 'degraded', 'mock']
const ORIGIN = 'https://judge.example.workers.dev'
const HOSTNAME = 'judge.example.workers.dev'

describe('ConnectionBadge', () => {
  it('renders each status with its own distinct label text', () => {
    const labels = new Set<string>()
    for (const status of STATUSES) {
      const { unmount } = render(<ConnectionBadge status={status} />)
      const badge = screen.getByRole('status')
      expect(badge).toHaveAttribute('data-status', status)
      expect(badge).toHaveTextContent(CONNECTION_COPY[status].label)
      labels.add(CONNECTION_COPY[status].label)
      unmount()
    }
    // Four statuses, four different words: nothing collapses onto another.
    expect(labels.size).toBe(STATUSES.length)
  })

  it('renders each status: mock and degraded carry different explanations', () => {
    render(<ConnectionBadge status="mock" />)
    expect(screen.getByRole('status')).toHaveTextContent(CONNECTION_COPY.mock.detail)
    expect(CONNECTION_COPY.mock.detail).not.toBe(CONNECTION_COPY.degraded.detail)
  })

  it('shows origin hostname only when the status is live', () => {
    for (const status of STATUSES) {
      const { unmount } = render(<ConnectionBadge status={status} origin={ORIGIN} />)
      const badge = screen.getByRole('status')
      if (status === 'live') {
        expect(badge).toHaveTextContent(HOSTNAME)
      } else {
        expect(badge).not.toHaveTextContent(HOSTNAME)
      }
      // The full URL never appears in any state.
      expect(badge).not.toHaveTextContent(ORIGIN)
      unmount()
    }
  })

  it('shows origin: a live status with no origin renders the label alone', () => {
    render(<ConnectionBadge status="live" />)
    const badge = screen.getByRole('status')
    expect(badge).toHaveTextContent(CONNECTION_COPY.live.label)
    expect(badge.querySelector('.connection-badge__detail')).toBeNull()
  })

  it('shows origin: hostname derivation never throws on a malformed origin', () => {
    expect(originHostname(ORIGIN)).toBe(HOSTNAME)
    expect(originHostname('http://localhost:8787')).toBe('localhost')
    expect(originHostname(undefined)).toBeUndefined()
    expect(originHostname('not a url')).toBeUndefined()
  })

  it('is a polite live region', () => {
    render(<ConnectionBadge status="connecting" />)
    const badge = screen.getByRole('status')
    expect(badge).toHaveAttribute('aria-live', 'polite')
  })
})
