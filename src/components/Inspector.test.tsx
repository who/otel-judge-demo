import { render, screen, within } from '@testing-library/react'
import { Inspector, NO_SELECTION_TEXT } from './Inspector'
import { AWAITING_JEV_TEXT } from './JevBars'
import { AWAITING_VERDICT_TEXT, LLAMA_SKIPPED_TEXT } from './VerdictPanel'
import { mockBoardState } from '../mock/boardFixture'
import type { Packet } from '../types/board'

function fixturePacket(id: string): Packet {
  const packet = mockBoardState().packets.find((p) => p.id === id)
  if (!packet) throw new Error(`fixture has no packet ${id}`)
  return packet
}

describe('Inspector', () => {
  it('renders the packet summary fields for a selected packet', () => {
    render(<Inspector packet={fixturePacket('pkt-0005')} />)

    const summary = screen.getByRole('region', { name: 'Packet' })
    expect(within(summary).getByText('search')).toBeInTheDocument()
    expect(within(summary).getByText('GET /search')).toBeInTheDocument()
    expect(within(summary).getByText('3210 ms')).toBeInTheDocument()
    expect(within(summary).getByText('200')).toBeInTheDocument()
  })

  it('renders jev bars: one labelled meter per label with its percentage, highest first', () => {
    const packet = fixturePacket('pkt-0005')
    render(<Inspector packet={packet} />)

    const meters = screen.getAllByRole('meter')
    expect(meters).toHaveLength(Object.keys(packet.jev ?? {}).length)
    expect(meters.map((m) => m.getAttribute('aria-label'))).toEqual([
      'latency_spike',
      'normal',
      'upstream_error',
    ])

    const spike = screen.getByRole('meter', { name: 'latency_spike' })
    expect(spike).toHaveAttribute('aria-valuenow', '0.9')
    expect(spike).toHaveAttribute('aria-valuemin', '0')
    expect(spike).toHaveAttribute('aria-valuemax', '1')
    expect(spike.firstElementChild).toHaveStyle({ width: '90%' })

    const list = screen.getByRole('list', { name: 'Jev probability distribution' })
    expect(within(list).getByText('90.0%')).toBeInTheDocument()
    expect(within(list).getAllByText('5.0%')).toHaveLength(2)
    expect(screen.queryByText(AWAITING_JEV_TEXT)).not.toBeInTheDocument()
  })

  it('renders jev bars for an arbitrary label set and clamps out-of-range widths', () => {
    const packet: Packet = {
      ...fixturePacket('pkt-0003'),
      jev: { weird_label: 1.4, tail: 0.004, negative: -0.2 },
    }
    render(<Inspector packet={packet} />)

    const weird = screen.getByRole('meter', { name: 'weird_label' })
    expect(weird).toHaveAttribute('aria-valuenow', '1.4')
    expect(weird.firstElementChild).toHaveStyle({ width: '100%' })
    expect(screen.getByText('140.0%')).toBeInTheDocument()

    expect(screen.getByRole('meter', { name: 'negative' }).firstElementChild).toHaveStyle({
      width: '0%',
    })
    expect(screen.getByText('-20.0%')).toBeInTheDocument()
    expect(screen.getByText('0.4%')).toBeInTheDocument()
  })

  it('renders llama verdict label, rationale and actions', () => {
    const packet = fixturePacket('pkt-0007')
    render(<Inspector packet={packet} />)

    const section = screen.getByRole('region', { name: 'Llama verdict' })
    const label = within(section).getByText('escalate')
    expect(label).toHaveAttribute('data-verdict', 'escalate')
    expect(within(section).getByText(packet.llama?.rationale ?? '')).toBeInTheDocument()

    const actions = within(section).getByRole('list', { name: 'Recommended actions' })
    expect(within(actions).getAllByRole('listitem').map((li) => li.textContent)).toEqual(
      packet.llama?.actions,
    )
    expect(screen.queryByText(AWAITING_VERDICT_TEXT)).not.toBeInTheDocument()
  })

  it('renders llama verdict with no actions list when actions are empty', () => {
    render(<Inspector packet={fixturePacket('pkt-0006')} />)

    const section = screen.getByRole('region', { name: 'Llama verdict' })
    expect(within(section).getByText('pass')).toHaveAttribute('data-verdict', 'pass')
    expect(
      within(section).queryByRole('list', { name: 'Recommended actions' }),
    ).not.toBeInTheDocument()
  })

  it('renders awaiting messages for both Jev and the verdict on an ingest packet', () => {
    const packet = fixturePacket('pkt-0001')
    expect(packet.jev).toBeUndefined()
    expect(packet.llama).toBeUndefined()
    render(<Inspector packet={packet} />)

    expect(screen.getByText(AWAITING_JEV_TEXT)).toBeInTheDocument()
    expect(screen.getByText(AWAITING_VERDICT_TEXT)).toBeInTheDocument()
    expect(screen.queryAllByRole('meter')).toHaveLength(0)
    expect(screen.getByText('checkout')).toBeInTheDocument()
  })

  it('renders only the awaiting verdict message for a packet scored by Jev but not judged', () => {
    render(<Inspector packet={fixturePacket('pkt-0003')} />)

    expect(screen.queryByText(AWAITING_JEV_TEXT)).not.toBeInTheDocument()
    expect(screen.getAllByRole('meter')).toHaveLength(3)
    expect(screen.getByText(AWAITING_VERDICT_TEXT)).toBeInTheDocument()
    expect(screen.queryByText(LLAMA_SKIPPED_TEXT)).not.toBeInTheDocument()
  })

  it('says Llama was skipped, not awaited, for a packet that settled without Jev', () => {
    const packet = fixturePacket('pkt-0008')
    expect(packet.llama).toBeUndefined()
    render(<Inspector packet={packet} />)

    const section = screen.getByRole('region', { name: 'Llama verdict' })
    expect(within(section).getByText(LLAMA_SKIPPED_TEXT)).toBeInTheDocument()
    expect(within(section).queryByText(AWAITING_VERDICT_TEXT)).not.toBeInTheDocument()
  })

  it('keeps the awaiting copy for an unjudged packet that carries no skip flag', () => {
    const packet: Packet = { ...fixturePacket('pkt-0008'), jevUnavailable: undefined }
    render(<Inspector packet={packet} />)

    expect(screen.getByText(AWAITING_VERDICT_TEXT)).toBeInTheDocument()
    expect(screen.queryByText(LLAMA_SKIPPED_TEXT)).not.toBeInTheDocument()
  })

  it('renders the pick-a-packet instruction with no selection', () => {
    render(<Inspector packet={null} />)

    expect(screen.getByText(NO_SELECTION_TEXT)).toBeInTheDocument()
    expect(screen.queryAllByRole('region')).toHaveLength(0)
    expect(screen.queryAllByRole('meter')).toHaveLength(0)
    expect(screen.queryByText(AWAITING_JEV_TEXT)).not.toBeInTheDocument()
  })
})
