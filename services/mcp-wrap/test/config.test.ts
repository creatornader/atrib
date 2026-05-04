// Tests the zod config schema. Wrap config is the public contract operators
// fill out, so the validation surface needs to reject malformed configs and
// accept the canonical shape with sensible defaults.

import { describe, it, expect } from 'vitest'
import { parseConfig } from '../src/config.js'

const MINIMAL = {
  name: 'agent-bridge',
  upstream: { command: 'agent-bridge' },
  serverUrl: 'mcp://agent-bridge.local',
}

describe('parseConfig', () => {
  it('accepts the minimal valid config + applies defaults', () => {
    const config = parseConfig(MINIMAL)
    expect(config.name).toBe('agent-bridge')
    expect(config.agent).toBe('claude-code')
    expect(config.logEndpoint).toBe('https://log.atrib.dev/v1/entries')
    expect(config.autoChain).toBe(true)
    expect(config.tools).toBeUndefined()
  })

  it('honors explicit agent override', () => {
    const config = parseConfig({ ...MINIMAL, agent: 'sido' })
    expect(config.agent).toBe('sido')
  })

  it('honors explicit logEndpoint override', () => {
    const config = parseConfig({ ...MINIMAL, logEndpoint: 'http://localhost:3100/v1/entries' })
    expect(config.logEndpoint).toBe('http://localhost:3100/v1/entries')
  })

  it('honors autoChain false', () => {
    const config = parseConfig({ ...MINIMAL, autoChain: false })
    expect(config.autoChain).toBe(false)
  })

  it('parses upstream with args + env', () => {
    const config = parseConfig({
      ...MINIMAL,
      upstream: {
        command: 'node',
        args: ['./dist/server.js'],
        env: { FOO: 'bar' },
      },
    })
    expect(config.upstream.args).toEqual(['./dist/server.js'])
    expect(config.upstream.env).toEqual({ FOO: 'bar' })
  })

  it('parses per-tool overrides', () => {
    const config = parseConfig({
      ...MINIMAL,
      tools: {
        post_context: { injectReceiptId: true },
        checkout: { transactionTool: true },
      },
    })
    expect(config.tools?.['post_context']?.injectReceiptId).toBe(true)
    expect(config.tools?.['checkout']?.transactionTool).toBe(true)
  })

  it('rejects empty name', () => {
    expect(() => parseConfig({ ...MINIMAL, name: '' })).toThrow()
  })

  it('rejects missing upstream.command', () => {
    expect(() => parseConfig({ ...MINIMAL, upstream: {} })).toThrow()
  })

  it('rejects missing serverUrl', () => {
    const { serverUrl: _omit, ...rest } = MINIMAL
    expect(() => parseConfig(rest)).toThrow()
  })

  it('rejects logEndpoint that is not a URL', () => {
    expect(() => parseConfig({ ...MINIMAL, logEndpoint: 'not a url' })).toThrow()
  })
})
