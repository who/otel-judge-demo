import { AppShell } from './components/AppShell'

// Stub content only. The board columns, packet chips, inspector detail and
// emit controls are sibling tasks that render into these slots.
export function App() {
  return (
    <AppShell
      header={<h1>OTel Judge Demo</h1>}
      board={<p>Board</p>}
      inspector={<p>Select a packet to inspect it.</p>}
    />
  )
}
