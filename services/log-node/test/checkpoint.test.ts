import { describe, it, expect } from 'vitest'
import * as ed from '@noble/ed25519'
import { sha256 } from '@noble/hashes/sha2.js'
import { sha512 } from '@noble/hashes/sha2.js'

// Set up sha512 for @noble/ed25519 (safe to call multiple times)
ed.hashes.sha512 = sha512

import {
  formatCheckpointBody,
  parseCheckpointBody,
  createCheckpointSigner,
  parseSignatureLine,
} from '../src/checkpoint.js'

const TEST_ORIGIN = 'log.atrib.dev/v1'
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
    //   log.atrib.dev/v1\n
    //   4821937\n
    //   CsUYapGGPo4dkMgIAUqom/Xajj7h2fB2MPA3j2jxq2I=\n
    const rootHashBytes = Buffer.from('CsUYapGGPo4dkMgIAUqom/Xajj7h2fB2MPA3j2jxq2I=', 'base64')
    const body = formatCheckpointBody('log.atrib.dev/v1', 4821937, new Uint8Array(rootHashBytes))
    expect(body).toBe('log.atrib.dev/v1\n4821937\nCsUYapGGPo4dkMgIAUqom/Xajj7h2fB2MPA3j2jxq2I=\n')
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

    // C2SP signed-note format (spec §2.4.3 post-D031):
    //   body\n\n— <key_name> <base64(keyHash[4B] || sig[64B])>\n
    const blankLineIdx = note.indexOf('\n\n')
    expect(blankLineIdx).toBeGreaterThan(0)

    const body = note.slice(0, blankLineIdx + 1) // body ends with \n
    const sigSection = note.slice(blankLineIdx + 2) // after the blank line

    const expectedBody = formatCheckpointBody(TEST_ORIGIN, TEST_TREE_SIZE, TEST_ROOT_HASH)
    expect(body).toBe(expectedBody)

    const sigLine = sigSection.trimEnd()
    const parsed = parseSignatureLine(sigLine)
    expect(parsed).not.toBeNull()
    expect(parsed!.origin).toBe(TEST_ORIGIN)
    expect(parsed!.keyId.byteLength).toBe(4)
    expect(parsed!.signature.byteLength).toBe(64)

    const bodyBytes = new TextEncoder().encode(body)
    const valid = await ed.verifyAsync(parsed!.signature, bodyBytes, publicKey)
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
    preimage[keyNameBytes.length] = 0x0a // newline
    preimage[keyNameBytes.length + 1] = 0x01 // Ed25519 type byte
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

  it('signed note embeds the key ID in the first 4 bytes of the base64 token', async () => {
    const { privateKey, publicKey } = await makeKeys()
    const signer = createCheckpointSigner(privateKey, publicKey, TEST_ORIGIN)
    const note = await signer.sign(TEST_TREE_SIZE, TEST_ROOT_HASH)

    const sigLine = note.split('\n\n')[1]!.trimEnd()
    const parsed = parseSignatureLine(sigLine)
    expect(parsed).not.toBeNull()
    // C2SP signed-note: keyHash is the first 4 bytes of the base64-decoded
    // signature token. Must equal the signer's keyId.
    expect(Array.from(parsed!.keyId)).toEqual(Array.from(signer.keyId))
  })
})
