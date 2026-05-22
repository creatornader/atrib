import { describe, it, expect } from 'vitest'
import {
  resolveEnvContextId,
  KNOWN_HARNESS_DISCOVERIES,
} from '../src/harness-context.js'

describe('resolveEnvContextId', () => {
  it('returns ATRIB_CONTEXT_ID when set and valid (D078 precedence)', () => {
    const env = { ATRIB_CONTEXT_ID: 'a1b2c3d4e5f60718293a4b5c6d7e8f90' }
    expect(resolveEnvContextId(env)).toBe('a1b2c3d4e5f60718293a4b5c6d7e8f90')
  })

  it('skips invalid ATRIB_CONTEXT_ID and falls through to harness discovery', () => {
    const env = {
      ATRIB_CONTEXT_ID: 'not-32-hex',
      CLAUDE_CODE_SESSION_ID: '38af29c4-fc3a-4f88-8fec-392501b8a0a9',
    }
    expect(resolveEnvContextId(env)).toBe('38af29c4fc3a4f888fec392501b8a0a9')
  })

  it('ATRIB_CONTEXT_ID wins when both are set and ATRIB_CONTEXT_ID is valid', () => {
    const env = {
      ATRIB_CONTEXT_ID: '00000000000000000000000000000001',
      CLAUDE_CODE_SESSION_ID: '38af29c4-fc3a-4f88-8fec-392501b8a0a9',
    }
    expect(resolveEnvContextId(env)).toBe('00000000000000000000000000000001')
  })

  it('derives 32-hex from CLAUDE_CODE_SESSION_ID UUID', () => {
    const env = { CLAUDE_CODE_SESSION_ID: '38af29c4-fc3a-4f88-8fec-392501b8a0a9' }
    expect(resolveEnvContextId(env)).toBe('38af29c4fc3a4f888fec392501b8a0a9')
  })

  it('lowercases CLAUDE_CODE_SESSION_ID before validating', () => {
    const env = { CLAUDE_CODE_SESSION_ID: '38AF29C4-FC3A-4F88-8FEC-392501B8A0A9' }
    expect(resolveEnvContextId(env)).toBe('38af29c4fc3a4f888fec392501b8a0a9')
  })

  it('rejects malformed CLAUDE_CODE_SESSION_ID silently', () => {
    const env = { CLAUDE_CODE_SESSION_ID: 'not-a-uuid' }
    expect(resolveEnvContextId(env)).toBeUndefined()
  })

  it('returns undefined when no env var is set', () => {
    expect(resolveEnvContextId({})).toBeUndefined()
  })

  it('rejects empty ATRIB_CONTEXT_ID and falls through', () => {
    const env = {
      ATRIB_CONTEXT_ID: '',
      CLAUDE_CODE_SESSION_ID: '38af29c4-fc3a-4f88-8fec-392501b8a0a9',
    }
    expect(resolveEnvContextId(env)).toBe('38af29c4fc3a4f888fec392501b8a0a9')
  })

  it('rejects 33-char-hex ATRIB_CONTEXT_ID', () => {
    const env = { ATRIB_CONTEXT_ID: '0'.repeat(33) }
    expect(resolveEnvContextId(env)).toBeUndefined()
  })

  it('rejects uppercase ATRIB_CONTEXT_ID (32-hex normalization is lowercase)', () => {
    const env = { ATRIB_CONTEXT_ID: 'A1B2C3D4E5F60718293A4B5C6D7E8F90' }
    expect(resolveEnvContextId(env)).toBeUndefined()
  })
})

describe('KNOWN_HARNESS_DISCOVERIES', () => {
  it('includes CLAUDE_CODE_SESSION_ID', () => {
    const claudeCode = KNOWN_HARNESS_DISCOVERIES.find(
      (d) => d.envVar === 'CLAUDE_CODE_SESSION_ID',
    )
    expect(claudeCode).toBeDefined()
  })

  it('each entry parses a known-good value into 32-hex', () => {
    const fixtures: Record<string, string> = {
      CLAUDE_CODE_SESSION_ID: '38af29c4-fc3a-4f88-8fec-392501b8a0a9',
    }
    for (const discovery of KNOWN_HARNESS_DISCOVERIES) {
      const fixture = fixtures[discovery.envVar]
      expect(fixture, `add a known-good fixture for ${discovery.envVar}`).toBeDefined()
      if (fixture !== undefined) {
        const result = discovery.parse(fixture)
        expect(result).toMatch(/^[0-9a-f]{32}$/)
      }
    }
  })
})
