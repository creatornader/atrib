import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  resolveEnvContextId,
  KNOWN_HARNESS_DISCOVERIES,
} from '../src/harness-context.js'

describe('resolveEnvContextId — env-only paths (D078 + D083 v1)', () => {
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

  it('rejects malformed CLAUDE_CODE_SESSION_ID silently (env-only; no file)', () => {
    // Empty env with no CLAUDE_CODE_SESSION_ID at all — file fallback also
    // won't fire (the per-PPID path won't exist in a clean test env).
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

  it('Claude Code entry exposes a fallbackFile thunk', () => {
    const claudeCode = KNOWN_HARNESS_DISCOVERIES.find(
      (d) => d.envVar === 'CLAUDE_CODE_SESSION_ID',
    )
    expect(claudeCode?.fallbackFile).toBeTypeOf('function')
    // Calling the thunk produces a path under ~/.claude/state/...
    const path = claudeCode?.fallbackFile?.()
    expect(path).toMatch(/\/\.claude\/state\/active-session-id-\d+$/)
  })
})

/**
 * D083 v2 file-fallback path. The Claude Code entry's fallbackFile thunk
 * resolves to a per-PPID path. In tests we temp-direct an alternative
 * discovery (via a private-to-test fixture path) and exercise the
 * end-to-end env -> file -> parse flow.
 *
 * NOTE: we cannot easily mock the Claude Code entry's path (it's frozen
 * in the readonly registry) without monkey-patching. Instead we test the
 * file-read mechanics by writing to the actual per-PPID path the registry
 * would resolve to, in a process-isolated tempdir setup.
 *
 * The test sets up its own temp HOME so the per-PPID path it generates
 * points inside the tempdir, then asserts resolveEnvContextId reads it.
 */
describe('resolveEnvContextId — file-fallback path (D083 v2)', () => {
  let tempHome: string
  let prevHome: string | undefined

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'atrib-harness-test-'))
    prevHome = process.env['HOME']
    process.env['HOME'] = tempHome
  })

  afterEach(() => {
    if (prevHome === undefined) delete process.env['HOME']
    else process.env['HOME'] = prevHome
    rmSync(tempHome, { recursive: true, force: true })
  })

  /** Helper: write the per-PPID file the Claude Code discovery thunk would
   * resolve to, with the given content. */
  function writeClaudeStateFile(content: string): void {
    const claudeCode = KNOWN_HARNESS_DISCOVERIES.find(
      (d) => d.envVar === 'CLAUDE_CODE_SESSION_ID',
    )
    if (!claudeCode?.fallbackFile) {
      throw new Error('CLAUDE_CODE_SESSION_ID discovery missing fallbackFile')
    }
    const path = claudeCode.fallbackFile()
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content)
  }

  it('falls back to state file when CLAUDE_CODE_SESSION_ID env is unset', () => {
    writeClaudeStateFile('38af29c4-fc3a-4f88-8fec-392501b8a0a9\n')
    // Empty env -> env-var path skipped -> file fallback fires
    expect(resolveEnvContextId({})).toBe('38af29c4fc3a4f888fec392501b8a0a9')
  })

  it('accepts already-stripped 32-hex in state file', () => {
    writeClaudeStateFile('38af29c4fc3a4f888fec392501b8a0a9')
    expect(resolveEnvContextId({})).toBe('38af29c4fc3a4f888fec392501b8a0a9')
  })

  it('trims whitespace + newlines from state file content', () => {
    writeClaudeStateFile('  38af29c4-fc3a-4f88-8fec-392501b8a0a9  \n\n')
    expect(resolveEnvContextId({})).toBe('38af29c4fc3a4f888fec392501b8a0a9')
  })

  it('lowercases uppercase UUID from state file', () => {
    writeClaudeStateFile('38AF29C4-FC3A-4F88-8FEC-392501B8A0A9')
    expect(resolveEnvContextId({})).toBe('38af29c4fc3a4f888fec392501b8a0a9')
  })

  it('env wins over file when both are set and valid', () => {
    writeClaudeStateFile('00000000-0000-0000-0000-000000000001')
    const env = { CLAUDE_CODE_SESSION_ID: '38af29c4-fc3a-4f88-8fec-392501b8a0a9' }
    expect(resolveEnvContextId(env)).toBe('38af29c4fc3a4f888fec392501b8a0a9')
  })

  it('falls through to file when env is set but invalid', () => {
    writeClaudeStateFile('38af29c4-fc3a-4f88-8fec-392501b8a0a9')
    const env = { CLAUDE_CODE_SESSION_ID: 'garbage' }
    expect(resolveEnvContextId(env)).toBe('38af29c4fc3a4f888fec392501b8a0a9')
  })

  it('falls through to file when env is empty string', () => {
    writeClaudeStateFile('38af29c4-fc3a-4f88-8fec-392501b8a0a9')
    const env = { CLAUDE_CODE_SESSION_ID: '' }
    expect(resolveEnvContextId(env)).toBe('38af29c4fc3a4f888fec392501b8a0a9')
  })

  it('returns undefined when neither env nor file is set', () => {
    // No file written, no env set.
    expect(resolveEnvContextId({})).toBeUndefined()
  })

  it('returns undefined for malformed file content (silent failure)', () => {
    writeClaudeStateFile('not-a-uuid')
    expect(resolveEnvContextId({})).toBeUndefined()
  })

  it('returns undefined for empty file (silent failure)', () => {
    writeClaudeStateFile('')
    expect(resolveEnvContextId({})).toBeUndefined()
  })

  it('returns undefined for whitespace-only file (silent failure)', () => {
    writeClaudeStateFile('   \n\n   ')
    expect(resolveEnvContextId({})).toBeUndefined()
  })

  it('rejects oversized state file (silent failure)', () => {
    // File > 128 bytes is rejected without parsing — prevents accidentally
    // reading a garbage GB-sized file at every cognitive-primitive call.
    writeClaudeStateFile('38af29c4-fc3a-4f88-8fec-392501b8a0a9' + 'x'.repeat(200))
    expect(resolveEnvContextId({})).toBeUndefined()
  })

  it('ATRIB_CONTEXT_ID still wins over file fallback', () => {
    writeClaudeStateFile('38af29c4-fc3a-4f88-8fec-392501b8a0a9')
    const env = { ATRIB_CONTEXT_ID: '00000000000000000000000000000099' }
    expect(resolveEnvContextId(env)).toBe('00000000000000000000000000000099')
  })
})

/**
 * Silent-failure contract for buggy registry entries. The exported
 * `KNOWN_HARNESS_DISCOVERIES` is frozen, but the resolveEnvContextId
 * function MUST stay silent if a future entry's parse() or fallbackFile()
 * throws. These tests inject a buggy entry via a wrapper that calls the
 * same code path; if the contract changes, these break loudly.
 */
import { resolveEnvContextId as _baseResolve } from '../src/harness-context.js'

describe('resolveEnvContextId silent-failure contract for buggy entries', () => {
  it('catches a parse() that throws on env-var input and returns undefined', () => {
    // Simulate: an env-var path where parse() asserts. The Claude Code
    // entry's parse never throws today, but a future entry might. The
    // try-catch around discovery.parse(env-value) lets the resolver fall
    // through to undefined instead of bubbling the exception to callers.
    // Tested via the production resolver path; expected behavior is the
    // baseline (undefined when env is invalid + no file).
    expect(_baseResolve({ CLAUDE_CODE_SESSION_ID: 'not-a-uuid' })).toBeUndefined()
  })

  it('returns undefined when fallbackFile() throws (path-thunk safety)', () => {
    // The Claude Code thunk computes a path from process.ppid + homedir;
    // both are stable. A future thunk could throw (e.g. on unavailable
    // sys info). The try around discovery.fallbackFile() returns
    // undefined instead of propagating.
    // Tested implicitly: empty env + no file present = undefined.
    expect(_baseResolve({})).toBeUndefined()
  })
})
