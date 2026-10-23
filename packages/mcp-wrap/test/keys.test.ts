// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it } from 'vitest'
import { resolveKey } from '../src/keys.js'

const PINNED = Buffer.alloc(32, 9).toString('base64url')

describe('resolveKey with ATRIB_SIGNER_SOCK', () => {
  const saved = { ...process.env }
  afterEach(() => {
    process.env = { ...saved }
  })

  it('returns the signer socket and ignores a seed in the environment', async () => {
    process.env['ATRIB_SIGNER_SOCK'] = '/var/run/atrib-signer/signer.sock'
    process.env['ATRIB_SIGNER_PUBKEY'] = PINNED
    delete process.env['ATRIB_SIGNER_IDENTITY']
    delete process.env['ATRIB_AGENT']
    process.env['ATRIB_PRIVATE_KEY'] = Buffer.alloc(32, 7).toString('base64url')
    const key = await resolveKey('codex')
    expect(key.source).toBe('signer-socket')
    if (key.source !== 'signer-socket') return
    expect(key.signer.creatorKey).toBe(PINNED)
    expect(key.signer.identity).toBe('codex')
    expect('seedB64url' in key).toBe(false)
  })

  it('fails closed when the pinned key is missing', async () => {
    process.env['ATRIB_SIGNER_SOCK'] = '/var/run/atrib-signer/signer.sock'
    delete process.env['ATRIB_SIGNER_PUBKEY']
    process.env['ATRIB_PRIVATE_KEY'] = Buffer.alloc(32, 7).toString('base64url')
    await expect(resolveKey('codex')).rejects.toThrow('ATRIB_SIGNER_PUBKEY')
  })

  it('still resolves an env seed when the socket is unset', async () => {
    delete process.env['ATRIB_SIGNER_SOCK']
    process.env['ATRIB_PRIVATE_KEY'] = Buffer.alloc(32, 7).toString('base64url')
    const key = await resolveKey('claude-code')
    expect(key.source).toBe('env')
  })
})
