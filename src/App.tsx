import { useCallback, useState } from 'react'
import { AppShell } from './components/AppShell'
import { Board } from './components/Board'
import { BoardEmptyState } from './components/BoardEmptyState'
import { ConnectionBadge } from './components/ConnectionBadge'
import { EmitControls } from './components/EmitControls'
import { Inspector } from './components/Inspector'
import { PipelineConsole } from './components/PipelineConsole'
import { useBoardState } from './hooks/useBoardState'
import { readEnv } from './lib/env'

// The mock advance interval now lives with the hook that owns the ticking.
// It is re-exported so tests that drive the board by advancing timers keep a
// single import for both the component and its cadence.
export { MOCK_ADVANCE_MS } from './hooks/useBoardState'

export function App() {
  // The public env is read once per mount and shared: the hook decides its
  // data source from it and the badge shows the same Worker origin, so the
  // two can never disagree about which Worker the page is pointed at.
  const [env] = useState(readEnv)

  // Board ownership sits in the hook: mock fixture with no Worker configured,
  // live Agent state otherwise. Selection below never cares which it is; the
  // badge and the empty state are the only consumers of the status. The emit
  // controls share the same env so they and the badge agree on which producer
  // is configured, and the reset control borrows the hook's clear so a mock
  // board empties in the one place that owns it.
  const { board, status, clearBoard } = useBoardState({ env })

  // Only the id is stored, never the packet object. The packet is re-resolved
  // against the current board on every render, so the inspector always shows
  // the packet's latest Jev and verdict values rather than a stale copy.
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // Clicking the selected chip again clears the selection. The toggle reads
  // the current value through the updater form, so two rapid clicks resolve
  // in order instead of racing a captured value.
  const handleSelect = useCallback((id: string) => {
    setSelectedId((current) => (current === id ? null : id))
  }, [])

  // A selected id with no matching packet resolves to null and the inspector
  // falls back to its instruction state. The id itself stays in state, so a
  // packet that briefly drops off between updates reselects itself on return.
  const selectedPacket = board.packets.find((packet) => packet.id === selectedId) ?? null

  // Header DOM order is the tab order: badge, then the emit controls in their
  // own left-to-right order, then the board, then the inspector. Nothing here
  // carries a tabindex, so the sequence a keyboard user gets is exactly what
  // is written below.
  return (
    <AppShell
      header={
        <>
          <h1>OTel Judge Demo</h1>
          <ConnectionBadge status={status} origin={env.apiBase} />
          <EmitControls env={env} onClearBoard={clearBoard} />
        </>
      }
      board={
        <>
          {board.packets.length === 0 && (
            <BoardEmptyState status={status} firehoseConfigured={env.firehoseBase !== undefined} />
          )}
          <Board state={board} selectedId={selectedId} onSelect={handleSelect} />
        </>
      }
      inspector={<Inspector packet={selectedPacket} />}
      // The console reads the same board the columns render, so a line is
      // printed for exactly the movement a reviewer just watched, whether the
      // board came from the Worker or from the mock fixture's tick.
      footer={<PipelineConsole state={board} />}
    />
  )
}
