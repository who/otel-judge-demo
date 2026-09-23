import { render, screen } from '@testing-library/react'
import {
  AWAITING_VERDICT_TEXT,
  LLAMA_SKIPPED_TEXT,
  NO_WHY_TEXT,
  VerdictPanel,
  WHY_LABEL,
} from './VerdictPanel'
import type { LlamaVerdict } from '../types/board'

const RATIONALE = 'payments answered POST /charge with 502. A human should look before it repeats.'
const CRITIQUE =
  'Jev puts 90% on upstream_error and the status agrees with it, so this is the dependency failing rather than the caller.'

function verdict(overrides: Partial<LlamaVerdict> = {}): LlamaVerdict {
  return { label: 'escalate', rationale: RATIONALE, actions: [], ...overrides }
}

describe('VerdictPanel', () => {
  it('shows the critique under the badge as the reason for the verdict', () => {
    render(<VerdictPanel verdict={verdict({ critique: CRITIQUE })} />)

    expect(screen.getByText(WHY_LABEL)).toBeInTheDocument()
    expect(screen.getByText(CRITIQUE)).toHaveAttribute('data-why', 'present')
    // The rationale is saying something else, so it keeps its own paragraph.
    expect(screen.getByText(RATIONALE)).toBeInTheDocument()
  })

  it('falls back to the rationale, printed once, for a verdict with no critique', () => {
    render(<VerdictPanel verdict={verdict()} />)

    expect(screen.getAllByText(RATIONALE)).toHaveLength(1)
    expect(screen.getByText(RATIONALE)).toHaveAttribute('data-why', 'present')
    expect(screen.queryByText(NO_WHY_TEXT)).not.toBeInTheDocument()
  })

  it('treats a whitespace-only critique as no critique at all', () => {
    render(<VerdictPanel verdict={verdict({ critique: '   ' })} />)

    expect(screen.getAllByText(RATIONALE)).toHaveLength(1)
  })

  it('prints a critique that repeats the rationale only once', () => {
    render(<VerdictPanel verdict={verdict({ critique: RATIONALE })} />)

    expect(screen.getAllByText(RATIONALE)).toHaveLength(1)
  })

  it('says no reason was published rather than leaving a gap under the heading', () => {
    render(<VerdictPanel verdict={verdict({ rationale: '', critique: '' })} />)

    expect(screen.getByText(WHY_LABEL)).toBeInTheDocument()
    expect(screen.getByText(NO_WHY_TEXT)).toHaveAttribute('data-why', 'missing')
  })

  it('renders the actions alongside the reason when the verdict carries them', () => {
    render(<VerdictPanel verdict={verdict({ critique: CRITIQUE, actions: ['Page on-call'] })} />)

    const actions = screen.getByRole('list', { name: 'Recommended actions' })
    expect(actions).toHaveTextContent('Page on-call')
    expect(screen.getByText(CRITIQUE)).toBeInTheDocument()
  })

  it('keeps the no-verdict copy, with no reason block, for a packet Llama has not judged', () => {
    const { rerender } = render(<VerdictPanel verdict={null} />)

    expect(screen.getByText(AWAITING_VERDICT_TEXT)).toBeInTheDocument()
    expect(screen.queryByText(WHY_LABEL)).not.toBeInTheDocument()

    rerender(<VerdictPanel verdict={null} skipped />)
    expect(screen.getByText(LLAMA_SKIPPED_TEXT)).toBeInTheDocument()
    expect(screen.queryByText(WHY_LABEL)).not.toBeInTheDocument()
  })
})
