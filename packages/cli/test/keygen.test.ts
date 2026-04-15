import { describe, it, expect } from 'vitest'
import { keygen } from '../src/keygen.js'
import { base64urlDecode, getPublicKey } from '@atrib/mcp'

describe('keygen (§5.6.1)', () => {
  it('generates a valid keypair', async () => {
    const keys = await keygen()

    expect(keys.privateKey).toBeDefined()
    expect(keys.publicKey).toBeDefined()

    // Both should be base64url-encoded 32-byte values (43 chars without padding)
    expect(keys.privateKey.length).toBe(43)
    expect(keys.publicKey.length).toBe(43)
  })

  it('private key decodes to 32 bytes', async () => {
    const keys = await keygen()
    const decoded = base64urlDecode(keys.privateKey)
    expect(decoded.length).toBe(32)
  })

  it('public key decodes to 32 bytes', async () => {
    const keys = await keygen()
    const decoded = base64urlDecode(keys.publicKey)
    expect(decoded.length).toBe(32)
  })

  it('public key matches private key derivation', async () => {
    const keys = await keygen()
    const seed = base64urlDecode(keys.privateKey)
    const derivedPk = await getPublicKey(seed)
    const expectedPk = base64urlDecode(keys.publicKey)

    expect(Buffer.from(derivedPk).equals(Buffer.from(expectedPk))).toBe(true)
  })

  it('generates unique keypairs each call', async () => {
    const keys1 = await keygen()
    const keys2 = await keygen()

    expect(keys1.privateKey).not.toBe(keys2.privateKey)
    expect(keys1.publicKey).not.toBe(keys2.publicKey)
  })
})
