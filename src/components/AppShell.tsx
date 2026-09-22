import type { ReactNode } from 'react'

export interface AppShellProps {
  /** Rendered inside the banner landmark across the top of the page. */
  header: ReactNode
  /** Rendered inside the main landmark; the board region. */
  board: ReactNode
  /** Rendered inside the complementary landmark; the right inspector rail. */
  inspector: ReactNode
  /**
   * Rendered inside the contentinfo landmark across the foot of the page.
   * Optional: with no slot the row collapses and the shell is the two-region
   * layout it was before, so a caller that wants no footer passes nothing.
   */
  footer?: ReactNode
}

/**
 * Page shell with a fixed header row and a two-column body. It is purely
 * presentational: every region is a render slot and no global state is read,
 * so it renders in isolation without any fixture.
 *
 * Each slot maps to exactly one landmark element. The inspector rail is
 * always rendered, even when its slot is empty, so it keeps its width and the
 * board never jumps horizontally when a packet is deselected. The footer is the
 * exception: an absent slot renders no element at all rather than an empty
 * landmark for a screen reader to announce.
 */
export function AppShell({ header, board, inspector, footer }: AppShellProps) {
  return (
    <div className="app-shell">
      <header className="app-shell__header">{header}</header>
      <main className="app-shell__board">{board}</main>
      <aside className="app-shell__inspector" aria-label="Inspector">
        {inspector}
      </aside>
      {footer !== undefined && <footer className="app-shell__footer">{footer}</footer>}
    </div>
  )
}
