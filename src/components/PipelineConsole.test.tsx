import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CONSOLE_IDLE_TEXT, CONSOLE_LABEL, MAX_CONSOLE_LINES, PipelineConsole } from './PipelineConsole'
import { JEV_FINISHED_TEXT, WAITING_FOR_JEV_TEXT, WAITING_FOR_LLAMA_TEXT } from '../lib/boardConsole'
import type { BoardState, Packet, PacketStage } from '../types/board'

function packet(id: string, stage: PacketStage): Packet {
  return {
    id,
    stage,
    receivedAt: '2026-09-21T10:00:00.000Z',
    summary: { service: 'checkout', operation: 'POST /cart/items', durationMs: 42, statusCode: 200 },
  }
}

function board(...packets: Packet[]): BoardState {
  return {
    packets,
    producer: { scenario: 'nominal', ratePerSec: 2, paused: false },
    updatedAt: '2026-09-21T10:00:00.000Z',
  }
}

function consoleLines(): string[] {
  const log = screen.getByRole('log', { name: CONSOLE_LABEL })
  return within(log)
    .queryAllByRole('listitem')
    .map((line) => line.textContent ?? '')
}

describe('PipelineConsole', () => {
  it('names its log region and starts idle rather than narrating the board it opened on', () => {
    render(<PipelineConsole state={board(packet('pkt-1', 'jev'))} />)

    expect(screen.getByRole('log', { name: CONSOLE_LABEL })).toBeInTheDocument()
    expect(screen.getByText(CONSOLE_IDLE_TEXT)).toBeInTheDocument()
    expect(consoleLines()).toEqual([])
  })

  it('appends a line as the board moves, newest last', () => {
    const { rerender } = render(<PipelineConsole state={board()} />)

    rerender(<PipelineConsole state={board(packet('pkt-1', 'jev'))} />)
    rerender(<PipelineConsole state={board(packet('pkt-1', 'llama'))} />)

    expect(consoleLines()).toEqual([
      `${WAITING_FOR_JEV_TEXT} — pkt-1`,
      `${JEV_FINISHED_TEXT} — pkt-1`,
      `${WAITING_FOR_LLAMA_TEXT} — pkt-1`,
    ])
    expect(screen.queryByText(CONSOLE_IDLE_TEXT)).not.toBeInTheDocument()
  })

  it('keeps the newest lines when the cap is passed', () => {
    const arrivals = Array.from({ length: MAX_CONSOLE_LINES + 20 }, (_, index) =>
      packet(`pkt-${index}`, 'ingest'),
    )
    const { rerender } = render(<PipelineConsole state={board()} />)

    rerender(<PipelineConsole state={board(...arrivals)} />)

    const rendered = consoleLines()
    expect(rendered).toHaveLength(MAX_CONSOLE_LINES)
    expect(rendered.at(-1)).toBe(`${WAITING_FOR_JEV_TEXT} — pkt-${arrivals.length - 1}`)
    expect(rendered[0]).toBe(`${WAITING_FOR_JEV_TEXT} — pkt-20`)
  })

  it('offers the history to the keyboard without taking focus when a line lands', () => {
    const { rerender } = render(<PipelineConsole state={board()} />)
    rerender(<PipelineConsole state={board(packet('pkt-1', 'jev'))} />)

    const log = screen.getByRole('log', { name: CONSOLE_LABEL })
    expect(log).toHaveAttribute('tabindex', '0')
    expect(log).not.toHaveFocus()
  })
})
