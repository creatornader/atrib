import { describe, it, expect } from 'vitest'
import * as ed from '@noble/ed25519'
import { sha256 } from '@noble/hashes/sha2.js'
import { sha512 } from '@noble/hashes/sha2.js'

// Set up sync sha512 for @noble/ed25519
ed.etc.sha512Sync = (...m: Uint8Array[]) => sha512(ed.etc.concatBytes(...m))

import {
  formatCheckpointBody,
  parseCheckpointBody,
  createCheckpointSigner,
} from '../src/checkpoint.js'

const TEST_ORIGIN = 'log.atrib.io/v1'
const TEST_TREE_SIZE = 4821937
// A stable 32-byte root hash
const TEST_ROOT_HASH = new Uint8Array(32).fill(0xab)

describe('formatCheckpointBody', () => {
  it('formats as origin\\nsize\\nrootBase64\\n', () => {
    const body = formatCheckpointBody(TEST_ORIGIN, TEST_TREE_SIZE, TEST_ROOT_HASH)
    const lines = body.split('\n')
    // Should have 4 elements when split by \n: origin, size, rootBase64, '' (trailing newline)
    expect(lines).toHaveLength(4)
    expect(lines[0]).toBe(TEST_ORIGIN)
    expect(lines[1]).toBe(String(TEST_TREE_SIZE))
    // rootBase64 should decode back to TEST_ROOT_HASH
    const decoded = Buffer.from(lines[2] as string, 'base64')
    expect(new Uint8Array(decoded)).toEqual(TEST_ROOT_HASH)
    // trailing newline means last element is empty string
    expect(lines[3]).toBe('')
  })

  it('uses standard base64 (not base64url)', () => {
    // Use a root hash that would produce + or / in base64 if it appears
    // Simple check: output should NOT contain - or _
    const body = formatCheckpointBody(TEST_ORIGIN, 1, TEST_ROOT_HASH)
    const rootLine = body.split('\n')[2] as string
    expect(rootLine).not.toMatch(/[-_]/)
  })

  it('matches the spec example format', () => {
    // From spec Section 2.4.1 example:
    //   log.atrib.io/v1\n
    //   4821937\n
    //   CsUYapGGPo4dkMgIAUqom/Xajj7h2fB2MPA3j2jxq2I=\n
    const rootHashBytes = Buffer.from('CsUYapGGPo4dkMgIAUqom/Xajj7h2fB2MPA3j2jxq2I=', 'base64')
    const body = formatCheckpointBody('log.atrib.io/v1', 4821937, new Uint8Array(rootHashBytes))
    expect(body).toBe('log.atrib.io/v1\n4821937\nCsUYapGGPo4dkMgIAUqom/Xajj7h2fB2MPA3j2jxq2I=\n')
  })
})

describe('parseCheckpointBody', () => {
  it('round-trips through formatCheckpointBody', () => {
    const body = formatCheckpointBody(TEST_ORIGIN, TEST_TREE_SIZE, TEST_ROOT_HASH)
    const parsed = parseCheckpointBody(body)
    expect(parsed.origin).toBe(TEST_ORIGIN)
    expect(parsed.treeSize).toBe(TEST_TREE_SIZE)
    // rootHash is base64 string
    const decoded = Buffer.from(parsed.rootHash, 'base64')
    expect(new Uint8Array(decoded)).toEqual(TEST_ROOT_HASH)
  })
})

describe('createCheckpointSigner', () => {
  async function makeKeys() {
    const seed = new Uint8Array(32).fill(0x42)
    const privateKey = seed
    const publicKey = await ed.getPublicKeyAsync(privateKey)
    return { privateKey, publicKey }
  }

  it('produces a signed note with a valid Ed25519 signature', async () => {
    const { privateKey, publicKey } = await makeKeys()
    const signer = createCheckpointSigner(privateKey, publicKey, TEST_ORIGIN)
    const note = await signer.sign(TEST_TREE_SIZE, TEST_ROOT_HASH)

    // Signed note format: body\n\n— origin keyIdHex+sigBase64\n
    // Split into body and signature sections at the blank line
    const blankLineIdx = note.indexOf('\n\n')
    expect(blankLineIdx).toBeGreaterThan(0)

    const body = note.slice(0, blankLineIdx + 1) // body ends with \n
    const sigSection = note.slice(blankLineIdx + 2) // after the blank line

    // Verify body matches expected checkpoint body
    const expectedBody = formatCheckpointBody(TEST_ORIGIN, TEST_TREE_SIZE, TEST_ROOT_HASH)
    expect(body).toBe(expectedBody)

    // Parse the signature line:, origin keyIdHex+sigBase64\n
    expect(sigSection).toMatch(/^— .+ .+\n$/)
    const sigLine = sigSection.trimEnd() // remove trailing newline
    // Remove em-dash and space prefix
    const rest = sigLine.slice('— '.length)
    // rest = "origin keyIdHex+sigBase64"
    const spaceIdx = rest.indexOf(' ')
    expect(spaceIdx).toBeGreaterThan(0)
    const sigOrigin = rest.slice(0, spaceIdx)
    expect(sigOrigin).toBe(TEST_ORIGIN)

    const keyIdPlusSig = rest.slice(spaceIdx + 1) as string
    // Format: keyIdHex+sigBase64, find the + separator
    const plusIdx = keyIdPlusSig.indexOf('+')
    expect(plusIdx).toBeGreaterThan(0)
    const sigBase64 = keyIdPlusSig.slice(plusIdx + 1)
    const sigBytes = Buffer.from(sigBase64, 'base64')
    expect(sigBytes.byteLength).toBe(64)

    // Verify the signature over the body bytes
    const bodyBytes = new TextEncoder().encode(body)
    const valid = await ed.verifyAsync(new Uint8Array(sigBytes), bodyBytes, publicKey)
    expect(valid).toBe(true)
  })

  it('key ID is 4 bytes derived from SHA-256(key_name || 0x0A || 0x01 || pubkey)', async () => {
    const { privateKey, publicKey } = await makeKeys()
    const signer = createCheckpointSigner(privateKey, publicKey, TEST_ORIGIN)

    // Compute expected key ID
    const encoder = new TextEncoder()
    const keyNameBytes = encoder.encode(TEST_ORIGIN)
    const preimage = new Uint8Array(keyNameBytes.length + 1 + 1 + publicKey.length)
    preimage.set(keyNameBytes, 0)
    preimage[keyNameBytes.length] = 0x0a       // newline
    preimage[keyNameBytes.length + 1] = 0x01   // Ed25519 type byte
    preimage.set(publicKey, keyNameBytes.length + 2)
    const hash = sha256(preimage)
    const expectedKeyId = hash.slice(0, 4)

    expect(signer.keyId).toEqual(expectedKeyId)
    expect(signer.keyId.byteLength).toBe(4)
  })

  it('exposes the public key on the signer', async () => {
    const { privateKey, publicKey } = await makeKeys()
    const signer = createCheckpointSigner(privateKey, publicKey, TEST_ORIGIN)
    expect(signer.publicKey).toEqual(publicKey)
  })

  it('signed note embeds the key ID in hex before the + separator', async () => {
    const { privateKey, publicKey } = await makeKeys()
    const signer = createCheckpointSigner(privateKey, publicKey, TEST_ORIGIN)
    const note = await signer.sign(TEST_TREE_SIZE, TEST_ROOT_HASH)

    const sigLine = note.split('\n\n')[1]!.trimEnd()
    const rest = sigLine.slice('— '.length)
    const keyIdPlusSig = rest.split(' ')[1] as string
    const keyIdHex = keyIdPlusSig.split('+')[0] as string

    // Should be 8 hex chars (4 bytes)
    expect(keyIdHex).toHaveLength(8)
    expect(keyIdHex).toBe(Buffer.from(signer.keyId).toString('hex'))
  })
})
