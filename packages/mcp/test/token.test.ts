import { describe, it, expect } from 'vitest'
import { encodeToken, decodeToken } from '../src/token.js'
import { signRecord, getPublicKey } from '../src/signing.js'
import { base64urlEncode, base64urlDecode } from '../src/base64url.js'
import { genesisChainRoot } from '../src/chain-root.js'
import type { AtribRecord } from '../src/types.js'

describe('token encoding/decoding', () => {
  const privateKey = new Uint8Array(32).fill(1)

  async function makeSignedRecord(): Promise<AtribRecord> {
    const publicKey = await getPublicKey(privateKey)
    const record: AtribRecord = {
      spec_version: 'atrib/1.0',
      content_id: 'sha256:3f8a2b0000000000000000000000000000000000000000000000000000000000',
      creator_key: base64urlEncode(publicKey),
      chain_root: genesisChainRoot('4bf92f3577b34da6a3ce929d0e0e4736'),
      event_type: 'tool_call',
      context_id: '4bf92f3577b34da6a3ce929d0e0e4736',
      timestamp: 1743850000000,
      signature: '',
    } as AtribRecord
    return signRecord(record, privateKey)
  }

  it('produces token in correct format: hash.key', async () => {
    const signed = await makeSignedRecord()
    const token = encodeToken(signed)
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
  })

  it('token is at most 87 characters', async () => {
    const signed = await makeSignedRecord()
    const token = encodeToken(signed)
    // 43 (hash) + 1 (dot) + 43 (key) = 87
    expect(token.length).toBeLessThanOrEqual(87)
    expect(token.length).toBe(87) // exactly 87 for 32+32 byte values
  })

  it('round-trips through encode/decode', async () => {
    const signed = await makeSignedRecord()
    const token = encodeToken(signed)
    const decoded = decodeToken(token)
    expect(decoded).not.toBeNull()
    // The creator_key bytes should match the record's creator_key
    const expectedCreatorKey = base64urlDecode(signed.creator_key)
    expect(decoded!.creatorKey).toEqual(expectedCreatorKey)
    expect(decoded!.recordHash.length).toBe(32)
  })

  it('decode returns null for malformed tokens', () => {
    expect(decodeToken('')).toBeNull()
    expect(decodeToken('nodot')).toBeNull()
    expect(decodeToken('.onlykey')).toBeNull()
    expect(decodeToken('onlyhash.')).toBeNull()
  })

  it('decode returns null for wrong-length components', () => {
    // Too short, 16 bytes instead of 32
    const short = base64urlEncode(new Uint8Array(16))
    const full = base64urlEncode(new Uint8Array(32))
    expect(decodeToken(`${short}.${full}`)).toBeNull()
    expect(decodeToken(`${full}.${short}`)).toBeNull()
  })

  it('is deterministic', async () => {
    const signed = await makeSignedRecord()
    const a = encodeToken(signed)
    const b = encodeToken(signed)
    expect(a).toBe(b)
  })
})
