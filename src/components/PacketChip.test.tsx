import { render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import { JEV_BADGE_PREFIX, PacketChip, SKIPPED_BADGE_TEXT, topJevLabel } from './PacketChip'
import type { LlamaVerdictLabel, Packet } from '../types/board'

function packet(overrides: Partial<Packet> = {}): Packet {
  return {
    id: 'pkt-0001',
    stage: 'jev',
    receivedAt: '2026-02-01T10:00:00.000Z',
    summary: { service: 'search', operation: 'GET /search', durationMs: 3210, statusCode: 200 },
    ...overrides,
  }
}

/** A packet that has settled into the bucket its label names. */
function judged(label: LlamaVerdictLabel, overrides: Partial<Packet> = {}): Packet {
  return packet({
    stage: 'verdict',
    llama: { label, rationale: `Judged ${label}.`, actions: [] },
    ...overrides,
  })
}

function renderChip(subject: Packet) {
  render(<PacketChip packet={subject} selected={false} onSelect={vi.fn()} />)
  const chip = screen.getByRole('button')
  return { chip, badge: chip.querySelector('[data-jev-top]') }
}

describe('topJevLabel', () => {
  it('reads nothing from a packet that Jev has not scored', () => {
    expect(topJevLabel(undefined)).toBeUndefined()
    expect(topJevLabel({})).toBeUndefined()
  })

  it('returns the only label of a single-entry distribution', () => {
    expect(topJevLabel({ normal: 0.4 })).toBe('normal')
  })

  it('returns the heaviest label rather than the first one published', () => {
    expect(topJevLabel({ normal: 0.05, latency_spike: 0.9, upstream_error: 0.05 })).toBe('latency_spike')
    expect(topJevLabel({ upstream_error: 0.68, latency_spike: 0.3, normal: 0.02 })).toBe('upstream_error')
  })

  it('settles a tie on the same label whichever order the masses arrive in', () => {
    expect(topJevLabel({ upstream_error: 0.5, latency_spike: 0.5 })).toBe('latency_spike')
    expect(topJevLabel({ latency_spike: 0.5, upstream_error: 0.5 })).toBe('latency_spike')
  })

  it('passes over a mass that is not a real number', () => {
    expect(topJevLabel({ broken: Number.NaN, normal: 0.2 })).toBe('normal')
    expect(topJevLabel({ broken: Number.NaN })).toBeUndefined()
  })
})

describe('PacketChip', () => {
  it('shows Jev’s leading label on a chip that has settled in a bucket', () => {
    const { chip, badge } = renderChip(
      judged('flag', { jev: { normal: 0.05, latency_spike: 0.9, upstream_error: 0.05 } }),
    )

    expect(badge).toHaveTextContent('latency_spike')
    expect(chip).toHaveAccessibleName(`search GET /search 3210 ms, verdict stage, ${JEV_BADGE_PREFIX} latency_spike`)
  })

  it('keeps the label off an in-flight chip that Jev has already scored', () => {
    const { chip, badge } = renderChip(packet({ jev: { normal: 0.1, latency_spike: 0.9 } }))

    expect(badge).toBeNull()
    expect(chip).not.toHaveTextContent('latency_spike')
    expect(chip).toHaveAccessibleName('search GET /search 3210 ms, jev stage')
  })

  it('shows no badge for a settled packet whose distribution never arrived', () => {
    expect(renderChip(judged('pass')).badge).toBeNull()
  })

  it('shows no badge for a settled packet carrying an empty distribution', () => {
    expect(renderChip(judged('escalate', { jev: {} })).badge).toBeNull()
  })

  it('shows no badge for a settled packet the board cannot bucket', () => {
    // No verdict, so columnForPacket leaves it off the board entirely.
    const { badge } = renderChip(packet({ stage: 'verdict', jev: { normal: 0.9 } }))

    expect(badge).toBeNull()
  })

  it('leaves the Llama-skipped badge exactly as it was', () => {
    const { chip, badge } = renderChip(packet({ jevUnavailable: true }))

    expect(chip).toHaveTextContent(SKIPPED_BADGE_TEXT)
    expect(chip).toHaveAttribute('data-skipped', 'true')
    expect(chip).toHaveAccessibleName('search GET /search 3210 ms, jev stage, Llama skipped')
    expect(badge).toBeNull()
  })

  it('keeps a label too long for the chip readable in full', () => {
    const label = 'downstream_dependency_saturation_with_retry_storm'
    const { badge } = renderChip(judged('escalate', { jev: { [label]: 0.8, normal: 0.2 } }))

    expect(badge).toHaveAttribute('title', label)
  })
})
