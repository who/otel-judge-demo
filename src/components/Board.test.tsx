import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { Board } from './Board'
import { SKIPPED_BADGE_TEXT } from './PacketChip'
import { mockBoardState } from '../mock/boardFixture'
import { BOARD_COLUMNS, columnForPacket } from '../types/board'
import type { BoardState, LlamaVerdictLabel, Packet, PacketStage } from '../types/board'

function renderBoard(state: BoardState, selectedId: string | null = null) {
  const onSelect = vi.fn()
  render(<Board state={state} selectedId={selectedId} onSelect={onSelect} />)
  return { onSelect }
}

function column(name: string) {
  return screen.getByRole('region', { name: new RegExp(`^${name}`) })
}

/** A minimal packet built here rather than from the fixture, so the ordering tests own their timestamps. */
function packetAt(id: string, stage: PacketStage, receivedAt: string): Packet {
  return {
    id,
    stage,
    receivedAt,
    summary: { service: 'orders', operation: 'GET /orders', durationMs: 12, statusCode: 200 },
  }
}

/** A settled packet carrying the verdict that decides which bucket it belongs in. */
function judgedAt(id: string, label: LlamaVerdictLabel, receivedAt: string): Packet {
  return {
    ...packetAt(id, 'verdict', receivedAt),
    llama: { label, rationale: `Judged ${label}.`, actions: [] },
  }
}

/** Packet ids of the chips in a column, top to bottom. */
function chipIds(scope: HTMLElement) {
  return within(scope)
    .getAllByRole('button')
    .map((chip) => chip.getAttribute('data-packet-id'))
}

describe('Board', () => {
  it('renders a column per stage and outcome in flow order with its packet count', () => {
    const state = mockBoardState()
    renderBoard(state)

    const headings = screen.getAllByRole('heading', { level: 2 })
    expect(headings.map((h) => h.querySelector('.board-column__name')?.textContent)).toEqual([
      ...BOARD_COLUMNS,
    ])

    for (const name of BOARD_COLUMNS) {
      const expected = state.packets.filter((p) => columnForPacket(p) === name).length
      expect(within(column(name)).getByLabelText(`${expected} packets`)).toHaveTextContent(
        String(expected),
      )
    }
  })

  it('groups packets into the column their stage or verdict names', () => {
    const state = mockBoardState()
    renderBoard(state)

    for (const packet of state.packets) {
      const name = columnForPacket(packet)
      expect(name).not.toBeNull()
      const chip = within(column(name as string)).getByRole('button', {
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

  it('files a passing packet in the pass bucket instead of one verdict column', () => {
    renderBoard(mockBoardState())

    expect(chipIds(column('pass'))).toContain('pkt-0006')
    expect(screen.queryByRole('region', { name: /^verdict/ })).not.toBeInTheDocument()
  })

  it('files flagged and escalated packets in their own buckets', () => {
    renderBoard(mockBoardState())

    expect(chipIds(column('flag'))).toContain('pkt-0005')
    expect(chipIds(column('escalate'))).toContain('pkt-0007')
    // A bucket holds only its own label: the three judged packets do not blur.
    expect(chipIds(column('flag'))).not.toContain('pkt-0007')
    expect(chipIds(column('escalate'))).not.toContain('pkt-0005')
  })

  it('keeps a Llama-skipped packet in the jev column and out of every bucket', () => {
    const state = mockBoardState()
    renderBoard(state)

    const skipped = within(column('jev')).getByRole('button', { name: /, Llama skipped$/ })
    const skippedId = skipped.getAttribute('data-packet-id')
    expect(skippedId).not.toBeNull()

    for (const bucket of ['pass', 'flag', 'escalate']) {
      expect(chipIds(column(bucket))).not.toContain(skippedId)
    }
  })

  it('leaves a settled packet with no readable verdict out of the buckets and counts it', () => {
    const state = mockBoardState()
    state.packets = [
      judgedAt('pkt-judged', 'pass', '2026-02-01T10:00:00.000Z'),
      packetAt('pkt-labelless', 'verdict', '2026-02-01T10:00:01.000Z'),
    ]
    renderBoard(state)

    expect(chipIds(column('pass'))).toEqual(['pkt-judged'])
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(screen.getByRole('status')).toHaveTextContent('1 packet the board cannot place')
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

  it('renders empty-state text in an empty column instead of collapsing', () => {
    const state = mockBoardState()
    state.packets = state.packets.filter((p) => p.stage !== 'llama')
    renderBoard(state)

    expect(within(column('llama')).getByText('No packets')).toBeInTheDocument()
    expect(within(column('llama')).getByLabelText('0 packets')).toHaveTextContent('0')
    expect(within(column('escalate')).queryByText('No packets')).not.toBeInTheDocument()
  })

  it('renders an empty column for every stage and outcome on an empty board', () => {
    const state = mockBoardState()
    state.packets = []
    renderBoard(state)

    expect(screen.getAllByRole('region')).toHaveLength(BOARD_COLUMNS.length)
    expect(screen.getAllByText('No packets')).toHaveLength(BOARD_COLUMNS.length)
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  it('shows the newest judgement at the top of its bucket whatever order the board sent', () => {
    const state = mockBoardState()
    state.packets = [
      judgedAt('pkt-oldest', 'flag', '2026-02-01T10:00:00.000Z'),
      judgedAt('pkt-newest', 'flag', '2026-02-01T10:00:02.000Z'),
      judgedAt('pkt-middle', 'flag', '2026-02-01T10:00:01.000Z'),
    ]
    renderBoard(state)

    expect(chipIds(column('flag'))).toEqual(['pkt-newest', 'pkt-middle', 'pkt-oldest'])
  })

  it('orders each bucket on its own rather than across the three', () => {
    const state = mockBoardState()
    state.packets = [
      judgedAt('pkt-pass-old', 'pass', '2026-02-01T10:00:00.000Z'),
      judgedAt('pkt-escalate', 'escalate', '2026-02-01T10:00:03.000Z'),
      judgedAt('pkt-pass-new', 'pass', '2026-02-01T10:00:01.000Z'),
    ]
    renderBoard(state)

    expect(chipIds(column('pass'))).toEqual(['pkt-pass-new', 'pkt-pass-old'])
    expect(chipIds(column('escalate'))).toEqual(['pkt-escalate'])
  })

  it('sorts a judged packet with no arrival time below the dated ones', () => {
    const state = mockBoardState()
    state.packets = [
      judgedAt('pkt-undated', 'flag', ''),
      judgedAt('pkt-older', 'flag', '2026-02-01T10:00:00.000Z'),
      judgedAt('pkt-newer', 'flag', '2026-02-01T10:00:02.000Z'),
    ]
    renderBoard(state)

    expect(chipIds(column('flag'))).toEqual(['pkt-newer', 'pkt-older', 'pkt-undated'])
  })

  it('leaves judged packets stamped at the same instant in the order they arrived', () => {
    const sameInstant = '2026-02-01T10:00:00.000Z'
    const state = mockBoardState()
    state.packets = [
      judgedAt('pkt-first', 'escalate', sameInstant),
      judgedAt('pkt-second', 'escalate', sameInstant),
      judgedAt('pkt-third', 'escalate', sameInstant),
    ]
    renderBoard(state)

    expect(chipIds(column('escalate'))).toEqual(['pkt-first', 'pkt-second', 'pkt-third'])
  })

  it('keeps the in-flight columns in board order instead of sorting them too', () => {
    const state = mockBoardState()
    state.packets = [
      packetAt('pkt-ingest-old', 'ingest', '2026-02-01T10:00:00.000Z'),
      packetAt('pkt-ingest-new', 'ingest', '2026-02-01T10:00:03.000Z'),
      packetAt('pkt-jev-new', 'jev', '2026-02-01T10:00:04.000Z'),
      packetAt('pkt-jev-old', 'jev', '2026-02-01T10:00:01.000Z'),
      packetAt('pkt-llama-undated', 'llama', ''),
      packetAt('pkt-llama-dated', 'llama', '2026-02-01T10:00:02.000Z'),
    ]
    renderBoard(state)

    expect(chipIds(column('ingest'))).toEqual(['pkt-ingest-old', 'pkt-ingest-new'])
    expect(chipIds(column('jev'))).toEqual(['pkt-jev-new', 'pkt-jev-old'])
    expect(chipIds(column('llama'))).toEqual(['pkt-llama-undated', 'pkt-llama-dated'])
  })

  it('keeps an in-flight packet in its stage column even once a verdict is attached', () => {
    const state = mockBoardState()
    state.packets = [{ ...judgedAt('pkt-early', 'escalate', '2026-02-01T10:00:00.000Z'), stage: 'llama' }]
    renderBoard(state)

    expect(chipIds(column('llama'))).toEqual(['pkt-early'])
    expect(within(column('escalate')).queryAllByRole('button')).toHaveLength(0)
  })

  it('drops a packet with an unknown stage from the columns and counts it', () => {
    const state = mockBoardState()
    const stray = { ...state.packets[0], id: 'pkt-stray', stage: 'mystery' } as unknown as Packet
    state.packets = [...state.packets, stray]
    renderBoard(state)

    expect(screen.getAllByRole('region')).toHaveLength(BOARD_COLUMNS.length)
    expect(screen.queryByRole('button', { name: /mystery/ })).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('1 packet the board cannot place')
  })
})
