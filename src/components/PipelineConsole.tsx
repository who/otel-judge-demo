import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { diffBoardConsoleEvents } from '../lib/boardConsole'
import type { ConsoleEvent } from '../lib/boardConsole'
import type { BoardState } from '../types/board'

export const CONSOLE_LABEL = 'Pipeline console'
export const CONSOLE_IDLE_TEXT = 'Waiting for the first packet to move.'

/**
 * How many lines the console keeps. A demo left running overnight would grow an
 * unbounded list of DOM nodes otherwise, and nobody scrolls back that far: the
 * oldest lines are dropped, never the newest.
 */
export const MAX_CONSOLE_LINES = 200

/** How close to the bottom counts as reading the newest line, in pixels. */
const STICK_THRESHOLD_PX = 24

interface ConsoleLine {
  /** Stable across re-renders so React never reuses a row for a different line. */
  key: string
  event: ConsoleEvent
}

export interface PipelineConsoleProps {
  /** The board as it stands. Every change to it is one console update. */
  state: BoardState
}

/**
 * A running narration of the pipeline along the foot of the page.
 *
 * The console owns no data of its own: it holds the last board it saw and turns
 * each new one into lines, so it narrates the mock board and a live Worker on
 * exactly the same terms. Newest lines are at the bottom, the way a terminal
 * reads, and the viewport follows them unless the reader has scrolled up — a
 * reviewer reading back through a burst is never yanked to the end mid-sentence.
 *
 * The lines are a polite log region rather than an alert: a reviewer using a
 * screen reader hears them between other announcements instead of having the
 * board and the emit controls talked over. The viewport is focusable so the
 * history can be scrolled from the keyboard.
 */
export function PipelineConsole({ state }: PipelineConsoleProps) {
  const [lines, setLines] = useState<ConsoleLine[]>([])
  const previousRef = useRef<BoardState | null>(null)
  const nextKeyRef = useRef(0)
  const viewportRef = useRef<HTMLDivElement>(null)
  const followingRef = useRef(true)

  useEffect(() => {
    // The first board a mount sees is the baseline, and diffing reports that by
    // returning nothing for it. Recording it before the early return below is
    // what makes the next update a real comparison rather than a second baseline.
    const events = diffBoardConsoleEvents(previousRef.current, state)
    previousRef.current = state
    if (events.length === 0) return

    // Keys are handed out here rather than inside the updater below, so a
    // double-invoked updater cannot mint two rows carrying the same key.
    const first = nextKeyRef.current
    nextKeyRef.current = first + events.length
    const added = events.map((event, index) => ({ key: `line-${first + index}`, event }))
    setLines((current) => current.concat(added).slice(-MAX_CONSOLE_LINES))
  }, [state])

  const handleScroll = () => {
    const viewport = viewportRef.current
    if (viewport === null) return
    followingRef.current =
      viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= STICK_THRESHOLD_PX
  }

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (viewport === null || !followingRef.current) return
    viewport.scrollTop = viewport.scrollHeight
  }, [lines])

  return (
    <div className="pipeline-console">
      <p className="pipeline-console__title" id="pipeline-console-title">
        {CONSOLE_LABEL}
      </p>
      <div
        className="pipeline-console__viewport"
        role="log"
        aria-labelledby="pipeline-console-title"
        tabIndex={0}
        ref={viewportRef}
        onScroll={handleScroll}
      >
        {lines.length === 0 ? (
          <p className="pipeline-console__idle">{CONSOLE_IDLE_TEXT}</p>
        ) : (
          <ol className="pipeline-console__lines">
            {lines.map(({ key, event }) => (
              <li key={key} className="pipeline-console__line" data-kind={event.kind}>
                {event.text}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  )
}
