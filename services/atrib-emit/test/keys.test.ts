// SPDX-License-Identifier: Apache-2.0

/**
 * Key-resolution fail-fast tests.
 *
 * resolveKey() shells out to `security` (Keychain) and `op` (1Password);
 * both can block indefinitely in headless contexts (locked login
 * Keychain, no GUI to approve an `op read`). keys.ts bounds each
 * spawnSync with a timeout so resolution always returns quickly and the
 * caller reaches the §5.8 pass-through path instead of stalling the
 * atrib-emit MCP init handshake.
 *
 * Regression surface for the 15s `atrib-emit connect timed out` cluster
 * observed in session-end / cron runs (key=no-env → blocking Keychain).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SpawnSyncReturns } from 'node:child_process'

const spawnSyncMock = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', () => ({ spawnSync: spawnSyncMock }))

import { resolveKey } from '../src/keys.js'

/** A spawnSync result shaped like a timeout kill (per Node's spawnSync contract). */
function timedOut(): SpawnSyncReturns<string> {
  return {
    pid: 0,
    output: [],
    stdout: '',
    stderr: '',
    status: null,
    signal: 'SIGTERM',
    error: Object.assign(new Error('spawnSync security ETIMEDOUT'), { code: 'ETIMEDOUT' }),
  } as unknown as SpawnSyncReturns<string>
}

/** A spawnSync result shaped like an ordinary "entry not found" miss. */
function notFound(): SpawnSyncReturns<string> {
  return {
    pid: 123,
    output: [],
    stdout: '',
    stderr: 'security: SecKeychainSearchCopyNext: not found',
    status: 44,
    signal: null,
  } as unknown as SpawnSyncReturns<string>
}

describe('resolveKey fail-fast', () => {
  let savedPlatform: PropertyDescriptor | undefined
  const savedEnv = { ...process.env }

  beforeEach(() => {
    spawnSyncMock.mockReset()
    // Force the darwin Keychain branch so this runs on Linux CI too.
    savedPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
    // Clear the earlier-priority sources so resolution reaches Keychain,
    // and the recovery source so it returns null right after.
    delete process.env['ATRIB_PRIVATE_KEY']
    delete process.env['ATRIB_KEY_FILE']
    delete process.env['ATRIB_OP_REFERENCE']
  })

  afterEach(() => {
    if (savedPlatform) Object.defineProperty(process, 'platform', savedPlatform)
    process.env = { ...savedEnv }
  })

  it('bounds the security spawn with a numeric timeout', async () => {
    spawnSyncMock.mockReturnValue(notFound())
    await resolveKey()
    expect(spawnSyncMock).toHaveBeenCalled()
    const [cmd, , opts] = spawnSyncMock.mock.calls[0] as [string, string[], { timeout?: unknown }]
    expect(cmd).toBe('security')
    expect(typeof opts.timeout).toBe('number')
    expect(opts.timeout as number).toBeGreaterThan(0)
  })

  it('short-circuits the second Keychain service when the first times out', async () => {
    spawnSyncMock.mockReturnValue(timedOut())
    const key = await resolveKey()
    expect(key).toBeNull()
    // Two services are configured (agent-scoped + generic). A timeout on
    // the first means the Keychain subsystem is unresponsive; the second
    // would hang identically, so the loop must break after one call.
    expect(spawnSyncMock).toHaveBeenCalledTimes(1)
  })

  it('still attempts the second service on an ordinary miss', async () => {
    spawnSyncMock.mockReturnValue(notFound())
    const key = await resolveKey()
    expect(key).toBeNull()
    // An ordinary miss is not a hang: both services are tried before
    // falling through. This pins the break as timeout-specific.
    expect(spawnSyncMock).toHaveBeenCalledTimes(2)
  })
})
