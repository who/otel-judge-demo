import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The site is a GitHub Pages project site, so every asset URL is served
// from /otel-judge-demo/ rather than the domain root.
export default defineConfig({
  base: '/otel-judge-demo/',
  plugins: [react()],
})
