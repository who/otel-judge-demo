import { useCallback, useState } from 'react'
import { AppShell } from './components/AppShell'
import { Board } from './components/Board'
import { Inspector } from './components/Inspector'
import { useBoardState } from './hooks/useBoardState'

// The mock advance interval now lives with the hook that owns the ticking.
// It is re-exported so tests that drive the board by advancing timers keep a
// single import for both the component and its cadence.
export { MOCK_ADVANCE_MS } from './hooks/useBoardState'

export function App() {
  // Board ownership sits in the hook: mock fixture with no Worker configured,
  // live Agent state otherwise. Selection below never cares which it is.
  const { board } = useBoardState()

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

  return (
    <AppShell
      header={<h1>OTel Judge Demo</h1>}
      board={<Board state={board} selectedId={selectedId} onSelect={handleSelect} />}
      inspector={<Inspector packet={selectedPacket} />}
    />
  )
}
