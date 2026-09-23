import { render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import { ACTIVITY_BORDER_COLOR, JEV_BADGE_PREFIX, PacketChip, SKIPPED_BADGE_TEXT, topJevLabel } from './PacketChip'
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

/**
 * The ActivityCard layer tracing this chip, or null when nothing wraps it.
 *
 * It is found by the animation it runs rather than by a class of this demo's
 * own, so a chip that lost the vendored border and kept the wrapper reads as
 * untraced here instead of passing on the wrapper alone.
 */
function activityBorder(chip: HTMLElement): HTMLElement | null {
  const wrapper = chip.closest('.packet-chip-activity')
  return wrapper === null ? null : wrapper.querySelector<HTMLElement>('[style*="borderTrace"]')
}

/** A hex colour as the border gradient spells it out, so the two stay tied. */
function gradientRgb(hex: string): string {
  const channels = Number.parseInt(hex.slice(1), 16)
  return `rgba(${(channels >> 16) & 255}, ${(channels >> 8) & 255}, ${channels & 255}`
}

function renderChip(subject: Packet, selected = false) {
  const onSelect = vi.fn()
  render(<PacketChip packet={subject} selected={selected} onSelect={onSelect} />)
  const chip = screen.getByRole('button')
  return { chip, badge: chip.querySelector('[data-jev-top]'), activity: activityBorder(chip), onSelect }
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

describe('PacketChip activity border', () => {
  it('traces a purple pulse around a chip Jev is still scoring', () => {
    const { activity } = renderChip(packet({ stage: 'jev' }))

    expect(activity).not.toBeNull()
    expect(activity?.getAttribute('style')).toContain(gradientRgb(ACTIVITY_BORDER_COLOR))
  })

  it('traces the same pulse around a chip waiting on Llama', () => {
    const { activity } = renderChip(packet({ stage: 'llama' }))

    expect(activity).not.toBeNull()
    expect(activity?.getAttribute('style')).toContain(gradientRgb(ACTIVITY_BORDER_COLOR))
  })

  it('leaves a chip that no judge has picked up yet untraced', () => {
    expect(renderChip(packet({ stage: 'ingest' })).activity).toBeNull()
  })

  it.each(['pass', 'flag', 'escalate'] as const)('leaves a chip settled in the %s bucket untraced', (label) => {
    expect(renderChip(judged(label)).activity).toBeNull()
  })

  it('leaves a packet parked in the jev column by a Jev failure untraced', () => {
    // It is resting there for good rather than waiting on a verdict, so the
    // stage it stopped at must not read as work still in progress.
    const { chip, activity } = renderChip(packet({ jevUnavailable: true }))

    expect(activity).toBeNull()
    expect(chip).toHaveTextContent(SKIPPED_BADGE_TEXT)
  })

  it('leaves a settled packet the board cannot bucket untraced', () => {
    expect(renderChip(packet({ stage: 'verdict' })).activity).toBeNull()
  })

  it('keeps a traced chip a working button that still shows its selection', () => {
    const { chip, onSelect, activity } = renderChip(packet({ stage: 'llama' }), true)

    expect(activity).not.toBeNull()
    expect(chip).toHaveAttribute('aria-pressed', 'true')
    expect(chip).toHaveAttribute('data-packet-id', 'pkt-0001')
    expect(chip).toHaveAccessibleName('search GET /search 3210 ms, llama stage')

    chip.click()

    expect(onSelect).toHaveBeenCalledWith('pkt-0001')
  })
})
