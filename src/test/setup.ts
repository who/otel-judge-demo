// Registers the jest-dom matchers (toBeInTheDocument, toHaveTextContent, ...)
// on Vitest's expect. Wired through the test.setupFiles entry in
// vite.config.ts so every test file inherits them without importing this.
import '@testing-library/jest-dom/vitest'
