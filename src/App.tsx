import { AppShell } from './components/AppShell'
import { Board } from './components/Board'
import { mockBoardState } from './mock/boardFixture'

// The board renders the deterministic fixture for now. Selection state and
// the live data source are sibling tasks; until they land the board is
// rendered unselected with a no-op select handler. The inspector detail and
// emit controls are also sibling tasks that render into these slots.
const initialState = mockBoardState()

export function App() {
  return (
    <AppShell
      header={<h1>OTel Judge Demo</h1>}
      board={<Board state={initialState} selectedId={null} onSelect={() => {}} />}
      inspector={<p>Select a packet to inspect it.</p>}
    />
  )
}
