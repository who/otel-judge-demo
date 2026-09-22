import { render, screen } from '@testing-library/react'
import { AppShell } from './AppShell'

describe('AppShell', () => {
  it('renders banner, main and complementary landmarks with their slot content', () => {
    render(
      <AppShell
        header={<span>header slot</span>}
        board={<span>board slot</span>}
        inspector={<span>inspector slot</span>}
      />,
    )

    expect(screen.getByRole('banner')).toHaveTextContent('header slot')
    expect(screen.getByRole('main')).toHaveTextContent('board slot')
    expect(screen.getByRole('complementary')).toHaveTextContent('inspector slot')
  })

  it('renders exactly one of each landmark', () => {
    render(<AppShell header="h" board="b" inspector="i" />)

    expect(screen.getAllByRole('banner')).toHaveLength(1)
    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(screen.getAllByRole('complementary')).toHaveLength(1)
  })

  it('keeps the inspector rail in the document when its slot is empty', () => {
    render(<AppShell header="h" board="b" inspector={null} />)

    const rail = screen.getByRole('complementary')
    expect(rail).toBeInTheDocument()
    expect(rail).toBeEmptyDOMElement()
  })
})
