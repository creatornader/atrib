// SPDX-License-Identifier: Apache-2.0

/**
 * Checkpoint format and witness infrastructure tests (Gap #9).
 *
 * §2.9 witnessing is deferred to v2, but the checkpoint format is production
 * code. These tests verify the C2SP signed-note format, key ID computation,
 * and signature structure. the foundation that witnesses will verify.
 */

import { describe, it, expect } from 'vitest'
import * as ed from '@noble/ed25519'
import { sha512 } from '@noble/hashes/sha2.js'
import {
  formatCheckpointBody,
  parseCheckpointBody,
  createCheckpointSigner,
  parseSignatureLine,
} from '../src/checkpoint.js'

ed.hashes.sha512 = sha512

describe('C2SP signed-note format', () => {
  it('formatCheckpointBody produces origin\\nsize\\nbase64hash\\n', () => {
    const root = new Uint8Array(32).fill(0xaa)
    const body = formatCheckpointBody('log.atrib.dev/v1', 42, root)

    const lines = body.split('\n')
    expect(lines[0]).toBe('log.atrib.dev/v1')
    expect(lines[1]).toBe('42')
    expect(lines[2]!.length).toBeGreaterThan(0) // base64 hash
    expect(lines[3]).toBe('') // trailing newline
    expect(body.endsWith('\n')).toBe(true)
  })

  it('parseCheckpointBody round-trips', () => {
    const root = new Uint8Array(32).fill(0xbb)
    const body = formatCheckpointBody('log.example.com', 100, root)
    const parsed = parseCheckpointBody(body)

    expect(parsed.origin).toBe('log.example.com')
    expect(parsed.treeSize).toBe(100)
    expect(parsed.rootHash).toBeTruthy()
  })

  it('parseCheckpointBody rejects fewer than 3 lines', () => {
    expect(() => parseCheckpointBody('one\ntwo\n')).toThrow()
  })

  it('parseCheckpointBody rejects leading zeros in tree size', () => {
    expect(() => parseCheckpointBody('origin\n042\nhash\n')).toThrow()
  })

  it('parseCheckpointBody rejects non-numeric tree size', () => {
    expect(() => parseCheckpointBody('origin\nabc\nhash\n')).toThrow()
  })

  it('parseCheckpointBody rejects carriage returns in origin', () => {
    expect(() => parseCheckpointBody('origin\r\n42\nhash\n')).toThrow()
  })

  it('tree size 0 is valid', () => {
    const parsed = parseCheckpointBody('origin\n0\nhash\n')
    expect(parsed.treeSize).toBe(0)
  })
})

describe('checkpoint signer', () => {
  it('produces signed note with correct structure', async () => {
    const privateKey = ed.utils.randomSecretKey()
    const publicKey = await ed.getPublicKeyAsync(privateKey)
    const signer = createCheckpointSigner(privateKey, publicKey, 'log.test.io')

    const root = new Uint8Array(32).fill(0xcc)
    const note = await signer.sign(5, root)

    // Structure: body\n\n— origin keyid+sig\n
    expect(note).toContain('log.test.io')
    expect(note).toContain('\n\n\u2014 ') // em-dash separator
    // C2SP signed-note: signature line parses as base64 of (keyHash || sig).
    const sigLine = note.split('\n\n')[1]!.trim()
    const parsed = parseSignatureLine(sigLine)
    expect(parsed).not.toBeNull()
    expect(parsed!.keyId.byteLength).toBe(4)
    expect(parsed!.signature.byteLength).toBe(64)
  })

  it('key ID is deterministic for same key and origin', async () => {
    const privateKey = ed.utils.randomSecretKey()
    const publicKey = await ed.getPublicKeyAsync(privateKey)

    const signer1 = createCheckpointSigner(privateKey, publicKey, 'log.test.io')
    const signer2 = createCheckpointSigner(privateKey, publicKey, 'log.test.io')

    expect(signer1.keyId).toEqual(signer2.keyId)
  })

  it('key ID differs for different origins', async () => {
    const privateKey = ed.utils.randomSecretKey()
    const publicKey = await ed.getPublicKeyAsync(privateKey)

    const signer1 = createCheckpointSigner(privateKey, publicKey, 'log.a.io')
    const signer2 = createCheckpointSigner(privateKey, publicKey, 'log.b.io')

    expect(signer1.keyId).not.toEqual(signer2.keyId)
  })

  it('key ID is 4 bytes (per spec §2.4.2)', async () => {
    const privateKey = ed.utils.randomSecretKey()
    const publicKey = await ed.getPublicKeyAsync(privateKey)
    const signer = createCheckpointSigner(privateKey, publicKey, 'log.test.io')

    expect(signer.keyId.length).toBe(4)
  })

  it('signature is valid Ed25519 over checkpoint body', async () => {
    const privateKey = ed.utils.randomSecretKey()
    const publicKey = await ed.getPublicKeyAsync(privateKey)
    const signer = createCheckpointSigner(privateKey, publicKey, 'log.test.io')

    const root = new Uint8Array(32).fill(0xdd)
    const note = await signer.sign(10, root)

    // Parse the note (C2SP signed-note canonical encoding, spec §2.4.3).
    const parts = note.split('\n\n')
    const body = parts[0]! + '\n'
    const sigLine = parts[1]!.trim()
    const parsed = parseSignatureLine(sigLine)
    expect(parsed).not.toBeNull()

    const bodyBytes = new TextEncoder().encode(body)
    const valid = await ed.verifyAsync(parsed!.signature, bodyBytes, publicKey)
    expect(valid).toBe(true)
  })

  it('different tree sizes produce different signatures', async () => {
    const privateKey = ed.utils.randomSecretKey()
    const publicKey = await ed.getPublicKeyAsync(privateKey)
    const signer = createCheckpointSigner(privateKey, publicKey, 'log.test.io')

    const root = new Uint8Array(32).fill(0xee)
    const note1 = await signer.sign(1, root)
    const note2 = await signer.sign(2, root)

    expect(note1).not.toBe(note2)
  })
})
