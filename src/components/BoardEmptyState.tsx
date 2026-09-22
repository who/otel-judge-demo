import type { ConnectionStatus } from '../hooks/useBoardState'
import { EMIT_LABEL } from './EmitControls'

export interface BoardEmptyStateProps {
  /** Where the board's data is coming from, exactly as the hook reports it. */
  status: ConnectionStatus
  /** Whether a firehose producer is configured, so the emit control can actually be pressed. */
  firehoseConfigured: boolean
}

/**
 * The first-load instruction, naming the emit control by its exact label so a
 * reviewer facing four empty columns learns the next action instead of
 * guessing.
 */
export const EMPTY_BOARD_TEXT = `No packets on the board yet. Press "${EMIT_LABEL}" to send a burst through the pipeline.`

/** Appended when no producer is configured, so the instruction never points at a dead button without saying why. */
export const EMPTY_BOARD_UNCONFIGURED_TEXT =
  'The firehose is not configured for this build, so the board fills only when the Worker receives traffic from elsewhere.'

/**
 * Empty-state banner shown above the board when it holds zero packets.
 *
 * It renders nothing while the status is still `connecting`: a live socket
 * that has opened but not yet delivered its first payload would otherwise
 * flash this copy for a frame before the real board arrives. Every other
 * status is settled, so an empty board there is a genuinely idle board.
 */
export function BoardEmptyState({ status, firehoseConfigured }: BoardEmptyStateProps) {
  if (status === 'connecting') return null

  return (
    <div className="board-empty" role="status">
      <p className="board-empty__text">{EMPTY_BOARD_TEXT}</p>
      {!firehoseConfigured && <p className="board-empty__note">{EMPTY_BOARD_UNCONFIGURED_TEXT}</p>}
    </div>
  )
}
