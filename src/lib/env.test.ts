import { describe, expect, it } from 'vitest'
import { AGENT_INSTANCE, AGENT_NAME, readEnv } from './env'

describe('readEnv', () => {
  it('normalises a valid Worker URL and yields live mode', () => {
    const env = readEnv({ VITE_API_BASE: 'https://judge.example.workers.dev' })
    expect(env.apiBase).toBe('https://judge.example.workers.dev')
    expect(env.mode).toBe('live')
  })

  it('normalises a trailing slash away so paths can be appended', () => {
    const env = readEnv({
      VITE_API_BASE: '  https://judge.example.workers.dev/ ',
      VITE_FIREHOSE_BASE: 'http://localhost:8788/',
    })
    expect(env.apiBase).toBe('https://judge.example.workers.dev')
    expect(env.firehoseBase).toBe('http://localhost:8788')
    expect(`${env.apiBase}/state`).toBe('https://judge.example.workers.dev/state')
  })

  it('reports an unset URL as absent and yields mock mode', () => {
    const env = readEnv({})
    expect(env.apiBase).toBeUndefined()
    expect(env.firehoseBase).toBeUndefined()
    expect(env.mode).toBe('mock')
  })

  it('reports an empty-string URL as absent', () => {
    const env = readEnv({ VITE_API_BASE: '', VITE_FIREHOSE_BASE: '   ' })
    expect(env.apiBase).toBeUndefined()
    expect(env.firehoseBase).toBeUndefined()
    expect(env.mode).toBe('mock')
  })

  it('reports a malformed URL as absent rather than throwing', () => {
    expect(readEnv({ VITE_API_BASE: 'judge.example.workers.dev' }).apiBase).toBeUndefined()
    expect(readEnv({ VITE_API_BASE: 'ws://judge.example.workers.dev' }).apiBase).toBeUndefined()
    expect(readEnv({ VITE_API_BASE: 'file:///tmp/judge' }).apiBase).toBeUndefined()
    expect(readEnv({ VITE_API_BASE: 'not a url' }).mode).toBe('mock')
  })

  it('reads import.meta.env by default without throwing', () => {
    const env = readEnv()
    expect(['live', 'mock']).toContain(env.mode)
  })

  it('secret guard rejects a credential-looking exposed env key', () => {
    expect(() => readEnv({ VITE_TYPESAFE_API_KEY: 'abc' })).toThrow(/VITE_TYPESAFE_API_KEY/)
    expect(() => readEnv({ VITE_AUTH_TOKEN: 'abc' })).toThrow(/credential/)
    expect(() => readEnv({ vite_client_secret: 'abc' })).toThrow(/vite_client_secret/)
  })

  it('secret guard ignores keys Vite never exposes to the bundle', () => {
    // Vitest mirrors the whole process environment into import.meta.env, but
    // only VITE_-prefixed keys can reach the shipped bundle.
    expect(() => readEnv({ TYPESAFE_API_KEY: 'abc', SOME_TOKEN: 'x' })).not.toThrow()
  })

  it('secret guard allows the two public URL names', () => {
    expect(() =>
      readEnv({ VITE_API_BASE: 'https://a.example', VITE_FIREHOSE_BASE: 'https://b.example' }),
    ).not.toThrow()
  })
})

describe('agent identity', () => {
  it('pins the Agent name and instance', () => {
    expect(AGENT_NAME).toBe('judge-agent')
    expect(AGENT_INSTANCE).toBe('board')
  })
})
