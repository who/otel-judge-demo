import { useCallback, useEffect, useState } from 'react'
import { AppShell } from './components/AppShell'
import { Board } from './components/Board'
import { Inspector } from './components/Inspector'
import { advanceMockBoard, mockBoardState } from './mock/boardFixture'

/**
 * How often the mock board advances while no Worker is connected. The live
 * data source replaces this interval wholesale, which is why the ticking lives
 * in one effect that never touches the selection state below it.
 */
export const MOCK_ADVANCE_MS = 2000

export function App() {
  const [board, setBoard] = useState(mockBoardState)

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

  useEffect(() => {
    const timer = setInterval(() => setBoard(advanceMockBoard), MOCK_ADVANCE_MS)
    return () => clearInterval(timer)
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
