import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, vi } from 'vitest'
import { App, MOCK_ADVANCE_MS } from './App'
import { EMPTY_BOARD_TEXT } from './components/BoardEmptyState'
import { RESET_LABEL } from './components/EmitControls'
import { NO_SELECTION_TEXT } from './components/Inspector'
import { AWAITING_VERDICT_TEXT } from './components/VerdictPanel'
import { advanceMockBoard, mockBoardState } from './mock/boardFixture'
import type { BoardState } from './types/board'

// Spy mode keeps the real fixture behaviour but lets one test swap the
// advance step for a board that drops the selected packet, which is the
// only way to exercise the stale-selection path without reaching into App.
vi.mock('./mock/boardFixture', { spy: true })

// Board and inspector drive the same fixture, so the chip is found by its
// accessible name (service, operation, duration and stage) and the inspector
// by its Packet summary region.
const SEARCH_CHIP = /^search GET \/search 3210 ms/
const PAYMENTS_CHIP = /^payments POST \/charge 1840 ms/

function setup() {
  const user = userEvent.setup()
  const view = render(<App />)
  return { user, ...view }
}

function inspectorSummary() {
  return screen.getByRole('region', { name: 'Packet' })
}

function tick() {
  act(() => {
    vi.advanceTimersByTime(MOCK_ADVANCE_MS)
  })
}

describe('App selection', () => {
  beforeEach(() => {
    // Only the interval is faked. Leaving setTimeout and setImmediate real
    // keeps React's scheduler and user-event's click delay running, so a
    // click resolves immediately while the board advance stays under test
    // control.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  })

  afterEach(() => {
    vi.mocked(advanceMockBoard).mockReset()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('starts with no selection and the inspector instruction', () => {
    setup()
    expect(screen.getByText(NO_SELECTION_TEXT)).toBeInTheDocument()
    expect(screen.queryByRole('button', { pressed: true })).not.toBeInTheDocument()
  })

  it('selects a packet: clicking a chip renders that packet in the inspector', async () => {
    const { user } = setup()

    await user.click(screen.getByRole('button', { name: SEARCH_CHIP }))

    expect(screen.getByRole('button', { name: SEARCH_CHIP })).toHaveAttribute('aria-pressed', 'true')
    const summary = inspectorSummary()
    expect(within(summary).getByText('search')).toBeInTheDocument()
    expect(within(summary).getByText('GET /search')).toBeInTheDocument()
    expect(within(summary).getByText('3210 ms')).toBeInTheDocument()
    expect(screen.queryByText(NO_SELECTION_TEXT)).not.toBeInTheDocument()
  })

  it('moves the selection when a different chip is clicked', async () => {
    const { user } = setup()

    await user.click(screen.getByRole('button', { name: SEARCH_CHIP }))
    await user.click(screen.getByRole('button', { name: PAYMENTS_CHIP }))

    expect(screen.getByRole('button', { name: PAYMENTS_CHIP })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: SEARCH_CHIP })).toHaveAttribute('aria-pressed', 'false')
    expect(within(inspectorSummary()).getByText('POST /charge')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { pressed: true })).toHaveLength(1)
  })

  it('toggles selection off when the selected chip is clicked again', async () => {
    const { user } = setup()
    const chip = screen.getByRole('button', { name: SEARCH_CHIP })

    await user.click(chip)
    expect(screen.queryByText(NO_SELECTION_TEXT)).not.toBeInTheDocument()

    await user.click(chip)

    expect(chip).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText(NO_SELECTION_TEXT)).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Packet' })).not.toBeInTheDocument()
  })

  it('stale selection falls back to the instruction state when the packet leaves the board', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: SEARCH_CHIP }))
    expect(within(inspectorSummary()).getByText('search')).toBeInTheDocument()

    // The next advance drops the selected packet entirely, as a live board
    // would when a packet is evicted between two state pushes.
    const without = (state: BoardState): BoardState => ({
      ...state,
      packets: state.packets.filter((packet) => packet.id !== 'pkt-0005'),
    })
    vi.mocked(advanceMockBoard).mockImplementationOnce(without)
    tick()

    expect(screen.queryByRole('button', { name: SEARCH_CHIP })).not.toBeInTheDocument()
    expect(screen.getByText(NO_SELECTION_TEXT)).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Packet' })).not.toBeInTheDocument()
    expect(screen.queryByText('GET /search')).not.toBeInTheDocument()

    // The id is kept rather than cleared, so the packet reselects itself when
    // a later update brings it back.
    vi.mocked(advanceMockBoard).mockImplementationOnce(() => mockBoardState())
    tick()

    expect(screen.getByRole('button', { name: SEARCH_CHIP })).toHaveAttribute('aria-pressed', 'true')
    expect(within(inspectorSummary()).getByText('search')).toBeInTheDocument()
  })

  it('keeps the same packet selected across a board advance and shows its new stage', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: PAYMENTS_CHIP }))
    expect(screen.getByRole('button', { name: /^payments POST \/charge 1840 ms, jev stage/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByText(AWAITING_VERDICT_TEXT)).toBeInTheDocument()

    tick()

    const moved = screen.getByRole('button', { name: /^payments POST \/charge 1840 ms, llama stage/ })
    expect(moved).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getAllByRole('button', { pressed: true })).toHaveLength(1)
    expect(within(inspectorSummary()).getByText('POST /charge')).toBeInTheDocument()
  })

  it('renders the instruction state for an empty board with a stale selected id', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: SEARCH_CHIP }))

    vi.mocked(advanceMockBoard).mockImplementationOnce((state) => ({ ...state, packets: [] }))
    tick()

    expect(screen.queryAllByRole('button', { pressed: true })).toHaveLength(0)
    expect(screen.getByText(NO_SELECTION_TEXT)).toBeInTheDocument()
  })

  it('reset clears every chip once the confirm is accepted', async () => {
    const confirmSpy = vi.fn(() => true)
    vi.stubGlobal('confirm', confirmSpy)
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: SEARCH_CHIP }))
    expect(inspectorSummary()).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: RESET_LABEL }))

    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: SEARCH_CHIP })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: PAYMENTS_CHIP })).not.toBeInTheDocument()
    // An empty board is the empty state plus a selection that resolves to
    // nothing, not a blank page with a stale inspector.
    expect(screen.getByText(EMPTY_BOARD_TEXT)).toBeInTheDocument()
    expect(screen.getByText(NO_SELECTION_TEXT)).toBeInTheDocument()
  })

  it('reset leaves the board alone when the confirm is declined', async () => {
    vi.stubGlobal('confirm', vi.fn(() => false))
    const { user } = setup()

    await user.click(screen.getByRole('button', { name: RESET_LABEL }))

    expect(screen.getByRole('button', { name: SEARCH_CHIP })).toBeInTheDocument()
    expect(screen.queryByText(EMPTY_BOARD_TEXT)).not.toBeInTheDocument()
  })

  it('stops advancing the board once unmounted', () => {
    const { unmount } = setup()
    tick()
    const callsWhileMounted = vi.mocked(advanceMockBoard).mock.calls.length
    expect(callsWhileMounted).toBeGreaterThan(0)

    unmount()
    tick()
    tick()

    expect(vi.mocked(advanceMockBoard).mock.calls.length).toBe(callsWhileMounted)
  })
})
