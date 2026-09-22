/// <reference types="vite/client" />

// Only VITE_-prefixed variables reach the client bundle. Both values below are
// public origins, never credentials (FR3). Keep the names in sync with the
// repository variables injected by .github/workflows/deploy.yml.
interface ImportMetaEnv {
  /** Public origin of the Judge Worker, e.g. https://judge.example.workers.dev */
  readonly VITE_API_BASE?: string
  /** Public origin of the otel-judge-firehose producer. */
  readonly VITE_FIREHOSE_BASE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
