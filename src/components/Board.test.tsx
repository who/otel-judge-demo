import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { Board } from './Board'
import { SKIPPED_BADGE_TEXT } from './PacketChip'
import { mockBoardState } from '../mock/boardFixture'
import { PACKET_STAGES } from '../types/board'
import type { BoardState, Packet } from '../types/board'

function renderBoard(state: BoardState, selectedId: string | null = null) {
  const onSelect = vi.fn()
  render(<Board state={state} selectedId={selectedId} onSelect={onSelect} />)
  return { onSelect }
}

function column(stage: string) {
  return screen.getByRole('region', { name: new RegExp(`^${stage}`) })
}

describe('Board', () => {
  it('renders a column per stage in pipeline order with its packet count', () => {
    const state = mockBoardState()
    renderBoard(state)

    const headings = screen.getAllByRole('heading', { level: 2 })
    expect(headings.map((h) => h.querySelector('.board-column__name')?.textContent)).toEqual([
      ...PACKET_STAGES,
    ])

    for (const stage of PACKET_STAGES) {
      const expected = state.packets.filter((p) => p.stage === stage).length
      expect(within(column(stage)).getByLabelText(`${expected} packets`)).toHaveTextContent(
        String(expected),
      )
    }
  })

  it('groups packets by stage into the matching column', () => {
    const state = mockBoardState()
    renderBoard(state)

    for (const packet of state.packets) {
      const chip = within(column(packet.stage)).getByRole('button', {
        name: new RegExp(`^${packet.summary.service} `),
      })
      expect(chip).toHaveTextContent(packet.summary.operation)
      expect(chip).toHaveTextContent(`${packet.summary.durationMs} ms`)
    }

    expect(screen.getAllByRole('button')).toHaveLength(state.packets.length)
  })

  it('calls onSelect with the packet id when a chip is clicked', async () => {
    const user = userEvent.setup()
    const state = mockBoardState()
    const { onSelect } = renderBoard(state, 'pkt-0005')

    await user.click(screen.getByRole('button', { name: /^payments POST \/charge/ }))
    expect(onSelect).toHaveBeenCalledWith('pkt-0003')

    // An already selected chip still reports its id; deselect is the parent's call.
    const selected = screen.getByRole('button', { name: /^search GET \/search/ })
    expect(selected).toHaveAttribute('aria-pressed', 'true')
    await user.click(selected)
    expect(onSelect).toHaveBeenLastCalledWith('pkt-0005')
    expect(onSelect).toHaveBeenCalledTimes(2)
  })

  it('badges a Llama-skipped packet in the jev column so it does not read as in flight', () => {
    const state = mockBoardState()
    renderBoard(state)

    const skipped = within(column('jev')).getByRole('button', { name: /, Llama skipped$/ })
    expect(skipped).toHaveTextContent(SKIPPED_BADGE_TEXT)
    expect(skipped).toHaveAttribute('data-stage', 'jev')
    expect(skipped).toHaveAttribute('data-skipped', 'true')

    const inFlight = within(column('jev')).getByRole('button', { name: /^payments POST \/charge/ })
    expect(inFlight).not.toHaveTextContent(SKIPPED_BADGE_TEXT)
    expect(inFlight).not.toHaveAttribute('data-skipped')
  })

  it('renders empty-state text in an empty stage column instead of collapsing', () => {
    const state = mockBoardState()
    state.packets = state.packets.filter((p) => p.stage !== 'llama')
    renderBoard(state)

    expect(within(column('llama')).getByText('No packets')).toBeInTheDocument()
    expect(within(column('llama')).getByLabelText('0 packets')).toHaveTextContent('0')
    expect(within(column('verdict')).queryByText('No packets')).not.toBeInTheDocument()
  })

  it('renders four empty stage columns for an empty board', () => {
    const state = mockBoardState()
    state.packets = []
    renderBoard(state)

    expect(screen.getAllByRole('region')).toHaveLength(PACKET_STAGES.length)
    expect(screen.getAllByText('No packets')).toHaveLength(PACKET_STAGES.length)
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  it('drops a packet with an unknown stage from the columns and counts it', () => {
    const state = mockBoardState()
    const stray = { ...state.packets[0], id: 'pkt-stray', stage: 'mystery' } as unknown as Packet
    state.packets = [...state.packets, stray]
    renderBoard(state)

    expect(screen.getAllByRole('region')).toHaveLength(PACKET_STAGES.length)
    expect(screen.queryByRole('button', { name: /mystery/ })).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('1 packet with an unknown stage')
  })
})
