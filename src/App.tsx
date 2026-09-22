import { AppShell } from './components/AppShell'
import { Board } from './components/Board'
import { Inspector } from './components/Inspector'
import { mockBoardState } from './mock/boardFixture'

// The board renders the deterministic fixture for now. Selection state and
// the live data source are sibling tasks; until they land the board is
// rendered unselected with a no-op select handler and the inspector is handed
// a null packet. The emit controls are another sibling task.
const initialState = mockBoardState()

export function App() {
  return (
    <AppShell
      header={<h1>OTel Judge Demo</h1>}
      board={<Board state={initialState} selectedId={null} onSelect={() => {}} />}
      inspector={<Inspector packet={null} />}
    />
  )
}
