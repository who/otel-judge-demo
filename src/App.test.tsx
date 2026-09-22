import { render, screen } from '@testing-library/react'
import { App } from './App'

describe('App', () => {
  it('renders the demo title', () => {
    render(<App />)
    // toBeInTheDocument comes from jest-dom, so this also proves the
    // setup file is registered rather than silently missing.
    expect(screen.getByRole('heading', { name: 'OTel Judge Demo' })).toBeInTheDocument()
  })
})
