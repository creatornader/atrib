// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it } from 'vitest'
import { resolveKey } from '../src/keys.js'

describe('resolveKey with ATRIB_SIGNER_SOCK', () => {
  const saved = { ...process.env }
  afterEach(() => {
    process.env = { ...saved }
  })

  it('refuses instead of falling back to a seed', async () => {
    process.env['ATRIB_SIGNER_SOCK'] = '/var/run/atrib-signer/signer.sock'
    process.env['ATRIB_PRIVATE_KEY'] = Buffer.alloc(32, 7).toString('base64url')
    await expect(resolveKey('claude-code')).rejects.toThrow('ATRIB_SIGNER_SOCK is set')
  })

  it('still resolves an env seed when the socket is unset', async () => {
    delete process.env['ATRIB_SIGNER_SOCK']
    process.env['ATRIB_PRIVATE_KEY'] = Buffer.alloc(32, 7).toString('base64url')
    const key = await resolveKey('claude-code')
    expect(key.source).toBe('env')
  })
})
