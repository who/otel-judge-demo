import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// The site is a GitHub Pages project site, so every asset URL is served
// from /otel-judge-demo/ rather than the domain root.
export default defineConfig({
  base: '/otel-judge-demo/',
  plugins: [react()],
  // Vitest reuses this config directly. Every consumer is a React component
  // or a browser fetch client, so tests run in jsdom with jest-dom matchers
  // registered once through the setup file below.
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['src/test/setup.ts'],
  },
})
