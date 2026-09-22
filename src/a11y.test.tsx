import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App, MOCK_ADVANCE_MS } from './App'
import {
  BoardEmptyState,
  EMPTY_BOARD_TEXT,
  EMPTY_BOARD_UNCONFIGURED_TEXT,
} from './components/BoardEmptyState'
import { EMIT_LABEL, RESET_LABEL } from './components/EmitControls'
import { mockBoardState } from './mock/boardFixture'
import { BOARD_COLUMNS } from './types/board'
import type { BoardState } from './types/board'

// Spy mode keeps the fixture real by default and lets the empty-state tests
// hand the hook a board with no packets, which the fixture itself never does.
vi.mock('./mock/boardFixture', { spy: true })

const FIREHOSE = 'http://localhost:8788'

function emptyBoard(): BoardState {
  return { packets: [], producer: { scenario: 'nominal', ratePerSec: 2, paused: false }, updatedAt: '' }
}

/** True when `first` comes before `second` in document order. */
function precedes(first: Element, second: Element): boolean {
  return (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.mocked(mockBoardState).mockReset()
})

describe('accessibility: tab order', () => {
  beforeEach(() => {
    // A configured producer enables the header controls; disabled controls are
    // skipped by Tab and would hide the order under test.
    vi.stubEnv('VITE_FIREHOSE_BASE', FIREHOSE)
  })

  it('tab order runs emit, scenario, rate, pause, reset, then the first board chip', async () => {
    const user = userEvent.setup()
    render(<App />)

    const emit = screen.getByRole('button', { name: EMIT_LABEL })
    const scenario = screen.getByRole('combobox', { name: 'Scenario' })
    const rate = screen.getByRole('spinbutton', { name: 'Rate /s' })
    const pause = screen.getByRole('switch', { name: 'Pause producer' })
    // Reset is last in the control row: the destructive action is the one a
    // reviewer tabs to on purpose, never the one they land on first.
    const reset = screen.getByRole('button', { name: RESET_LABEL })
    const firstChip = screen.getByRole('button', { name: /^checkout POST \/cart\/items 42 ms, ingest stage/ })

    await user.tab()
    expect(emit).toHaveFocus()
    await user.tab()
    expect(scenario).toHaveFocus()
    await user.tab()
    expect(rate).toHaveFocus()
    await user.tab()
    expect(pause).toHaveFocus()
    await user.tab()
    expect(reset).toHaveFocus()
    await user.tab()
    expect(firstChip).toHaveFocus()
  })

  it('tab order places the connection badge before the emit controls in the DOM', () => {
    render(<App />)

    const badge = screen.getAllByRole('status').find((el) => el.classList.contains('connection-badge'))
    if (!badge) throw new Error('connection badge not rendered')
    const emit = screen.getByRole('button', { name: EMIT_LABEL })
    // Reset carries its own name rather than extending the emit button's.
    const reset = screen.getByRole('button', { name: RESET_LABEL })
    const board = screen.getByRole('main')
    const inspector = screen.getByRole('complementary', { name: 'Inspector' })

    expect(precedes(badge, emit)).toBe(true)
    expect(precedes(emit, reset)).toBe(true)
    expect(precedes(reset, board)).toBe(true)
    expect(precedes(emit, board)).toBe(true)
    expect(precedes(board, inspector)).toBe(true)
  })

  it('tab order relies on DOM order alone: no element carries a positive tabindex', () => {
    const { container } = render(<App />)

    const positive = Array.from(container.querySelectorAll<HTMLElement>('[tabindex]')).filter(
      (el) => Number(el.getAttribute('tabindex')) > 0,
    )
    expect(positive).toEqual([])
  })
})

describe('accessibility: keyboard focus across a stage move', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps focus on a chip that advances to the next column', async () => {
    const user = userEvent.setup()
    render(<App />)

    const chip = screen.getByRole('button', { name: /^payments POST \/charge 1840 ms, jev stage/ })
    await user.click(chip)
    expect(chip).toHaveFocus()

    act(() => {
      vi.advanceTimersByTime(MOCK_ADVANCE_MS)
    })

    const moved = screen.getByRole('button', { name: /^payments POST \/charge 1840 ms, llama stage/ })
    expect(moved).toHaveFocus()
  })
})

describe('accessibility: empty state', () => {
  it('empty state names the emit control when the board has zero packets', () => {
    vi.mocked(mockBoardState).mockImplementation(emptyBoard)
    vi.stubEnv('VITE_FIREHOSE_BASE', FIREHOSE)
    render(<App />)

    const text = screen.getByText(EMPTY_BOARD_TEXT)
    expect(text).toBeInTheDocument()
    expect(text).toHaveTextContent(EMIT_LABEL)
    expect(screen.queryByText(EMPTY_BOARD_UNCONFIGURED_TEXT)).not.toBeInTheDocument()
    // Every column still renders — the three pipeline stages and the three
    // outcome buckets — so the shape of the board stays visible while idle.
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(BOARD_COLUMNS.length)
  })

  it('empty state explains a missing producer instead of pointing at a dead button', () => {
    vi.mocked(mockBoardState).mockImplementation(emptyBoard)
    render(<App />)

    expect(screen.getByText(EMPTY_BOARD_TEXT)).toBeInTheDocument()
    expect(screen.getByText(EMPTY_BOARD_UNCONFIGURED_TEXT)).toBeInTheDocument()
  })

  it('empty state is absent while packets are on the board', () => {
    render(<App />)
    expect(screen.queryByText(EMPTY_BOARD_TEXT)).not.toBeInTheDocument()
  })

  it('empty state waits for a settled status rather than flashing while connecting', () => {
    const { container, rerender } = render(<BoardEmptyState status="connecting" firehoseConfigured />)
    expect(container).toBeEmptyDOMElement()

    rerender(<BoardEmptyState status="live" firehoseConfigured />)
    expect(screen.getByText(EMPTY_BOARD_TEXT)).toBeInTheDocument()
  })
})
