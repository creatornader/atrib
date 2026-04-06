import { describe, it, expect } from 'vitest'
import { getPublicKey, signRecord, verifyRecord } from '../src/signing.js'
import { base64urlEncode } from '../src/base64url.js'
import type { AtribRecord } from '../src/types.js'

async function makeSignedRecord(
  privateKey: Uint8Array,
  overrides?: Partial<AtribRecord>,
): Promise<AtribRecord> {
  const publicKey = await getPublicKey(privateKey)
  const record: AtribRecord = {
    spec_version: 'atrib/1.0',
    content_id: 'sha256:3f8a2b0000000000000000000000000000000000000000000000000000000000',
    creator_key: base64urlEncode(publicKey),
    chain_root: 'sha256:7e1f4a0000000000000000000000000000000000000000000000000000000000',
    event_type: 'tool_call',
    context_id: '4bf92f3577b34da6a3ce929d0e0e4736',
    timestamp: 1743850000000,
    signature: '',
    ...overrides,
  } as AtribRecord
  return signRecord(record, privateKey)
}

describe('signRecord / verifyRecord', () => {
  const privateKey = new Uint8Array(32).fill(1) // deterministic test key

  it('produces a valid signature that verifies', async () => {
    const signed = await makeSignedRecord(privateKey)
    expect(signed.signature).toBeTruthy()
    expect(signed.signature.length).toBe(86) // 64 bytes → 86 base64url chars
    const valid = await verifyRecord(signed)
    expect(valid).toBe(true)
  })

  it('rejects a record with tampered content_id', async () => {
    const signed = await makeSignedRecord(privateKey)
    const tampered = {
      ...signed,
      content_id: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
    } as AtribRecord
    const valid = await verifyRecord(tampered)
    expect(valid).toBe(false)
  })

  it('rejects a record with tampered timestamp', async () => {
    const signed = await makeSignedRecord(privateKey)
    const tampered = { ...signed, timestamp: 9999999999999 } as AtribRecord
    const valid = await verifyRecord(tampered)
    expect(valid).toBe(false)
  })

  it('rejects a record with wrong creator_key', async () => {
    const signed = await makeSignedRecord(privateKey)
    const otherKey = await getPublicKey(new Uint8Array(32).fill(2))
    const tampered = { ...signed, creator_key: base64urlEncode(otherKey) } as AtribRecord
    const valid = await verifyRecord(tampered)
    expect(valid).toBe(false)
  })

  it('rejects unknown spec_version', async () => {
    const signed = await makeSignedRecord(privateKey)
    const tampered = { ...signed, spec_version: 'atrib/2.0' } as unknown as AtribRecord
    // Re-sign with the wrong spec version, signature will be valid but step 5 rejects
    const resignedTampered = await signRecord(tampered, privateKey)
    const valid = await verifyRecord(resignedTampered)
    expect(valid).toBe(false)
  })

  it('rejects unknown event_type', async () => {
    const signed = await makeSignedRecord(privateKey)
    const tampered = { ...signed, event_type: 'unknown' } as unknown as AtribRecord
    const resignedTampered = await signRecord(tampered, privateKey)
    const valid = await verifyRecord(resignedTampered)
    expect(valid).toBe(false)
  })

  it('rejects timestamp more than 5 minutes in the future', async () => {
    const futureTimestamp = Date.now() + 6 * 60 * 1000
    const signed = await makeSignedRecord(privateKey, { timestamp: futureTimestamp })
    const valid = await verifyRecord(signed)
    expect(valid).toBe(false)
  })

  it('accepts timestamp within 5-minute future window', async () => {
    const nearFuture = Date.now() + 4 * 60 * 1000
    const signed = await makeSignedRecord(privateKey, { timestamp: nearFuture })
    const valid = await verifyRecord(signed)
    expect(valid).toBe(true)
  })

  it('rejects invalid context_id (too short)', async () => {
    const signed = await makeSignedRecord(privateKey, { context_id: 'abc123' })
    const valid = await verifyRecord(signed)
    expect(valid).toBe(false)
  })

  it('rejects invalid context_id (uppercase)', async () => {
    const signed = await makeSignedRecord(privateKey, {
      context_id: '4BF92F3577B34DA6A3CE929D0E0E4736',
    })
    const valid = await verifyRecord(signed)
    expect(valid).toBe(false)
  })

  it('handles records with session_token', async () => {
    const signed = await makeSignedRecord(privateKey, {
      session_token: 'dGVzdF9zZXNzaW9uX3Rva2Vu',
    } as Partial<AtribRecord>)
    expect(signed.signature.length).toBe(86)
    const valid = await verifyRecord(signed)
    expect(valid).toBe(true)
  })

  it('session_token presence changes signature', async () => {
    const without = await makeSignedRecord(privateKey)
    const withToken = await makeSignedRecord(privateKey, {
      session_token: 'dGVzdF9zZXNzaW9uX3Rva2Vu',
    } as Partial<AtribRecord>)
    expect(without.signature).not.toBe(withToken.signature)
  })

  it('transaction event_type is valid', async () => {
    const signed = await makeSignedRecord(privateKey, { event_type: 'transaction' })
    const valid = await verifyRecord(signed)
    expect(valid).toBe(true)
  })

  it('accepts very old timestamps (no staleness check in v1)', async () => {
    // Year 2020 timestamp, spec only rejects future timestamps, not old ones
    const oldTimestamp = new Date('2020-01-01').getTime()
    const signed = await makeSignedRecord(privateKey, { timestamp: oldTimestamp })
    const valid = await verifyRecord(signed)
    expect(valid).toBe(true)
  })

  it('deterministic: same input produces same signature', async () => {
    const a = await makeSignedRecord(privateKey)
    const b = await makeSignedRecord(privateKey)
    expect(a.signature).toBe(b.signature)
  })
})
