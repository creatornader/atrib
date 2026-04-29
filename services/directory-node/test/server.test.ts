// directory-node HTTP server smoke tests.
//
// Boots a real server on a random port, exercises each endpoint, asserts
// the response shape matches §6.2's documented API. Anchoring is disabled
// (no logEndpoint) so tests run fully self-contained.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { randomBytes } from 'node:crypto'
import * as ed25519 from '@noble/ed25519'

import { signClaim } from '@atrib/directory'
import type { IdentityClaim } from '@atrib/directory'
import { bindDirectoryServer, type DirectoryServerHandle } from '../src/index.js'

async function genKeypair(): Promise<{ privateKey: Uint8Array; publicKey: string }> {
  const privateKey = randomBytes(32)
  const pubBytes = await ed25519.getPublicKeyAsync(privateKey)
  const publicKey = Buffer.from(pubBytes).toString('base64url').replace(/=+$/, '')
  return { privateKey, publicKey }
}

describe('directory-node HTTP', () => {
  let handle: DirectoryServerHandle
  let operatorKey: Uint8Array

  beforeEach(async () => {
    operatorKey = randomBytes(32)
    handle = await bindDirectoryServer(0, '127.0.0.1', {
      operatorPrivateKey: operatorKey,
      origin: 'directory.test.local/v6',
      // no logEndpoint → anchoring skipped
    })
  })

  afterEach(async () => {
    await handle.close()
  })

  it('GET /v6/anchor returns initial snapshot', async () => {
    const r = await fetch(`${handle.url}/v6/anchor`)
    expect(r.status).toBe(200)
    const body = await r.json() as { epoch: number; root_hash: string; directory_origin: string }
    expect(body.epoch).toBe(0)
    expect(body.root_hash.length).toBeGreaterThan(0)
    expect(body.directory_origin).toBe('directory.test.local/v6')
  })

  it('POST /v6/publish + GET /v6/lookup round-trips a claim', async () => {
    const { privateKey, publicKey } = await genKeypair()
    const claim: IdentityClaim = await signClaim({
      creator_key: publicKey,
      claim_type: 'self_attested',
      claim_method: 'self',
      claim_subject: { display_name: 'alice' },
    }, privateKey)

    const pub = await fetch(`${handle.url}/v6/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(claim),
    })
    expect(pub.status).toBe(200)
    const pubBody = await pub.json() as { epoch: number; root_hash: string; anchor: { submitted: boolean } }
    expect(pubBody.epoch).toBe(1)
    expect(pubBody.anchor.submitted).toBe(false)  // no logEndpoint configured

    const look = await fetch(`${handle.url}/v6/lookup/${publicKey}`)
    expect(look.status).toBe(200)
    const lookBody = await look.json() as { found: boolean; claim: IdentityClaim; version: number; proof: string }
    expect(lookBody.found).toBe(true)
    expect(lookBody.claim.creator_key).toBe(publicKey)
    expect(lookBody.claim.claim_subject.display_name).toBe('alice')
    expect(lookBody.version).toBe(1)
    expect(lookBody.proof.length).toBeGreaterThan(0)
  })

  it('POST /v6/publish rejects an unsigned claim', async () => {
    const { publicKey } = await genKeypair()
    const unsigned = {
      creator_key: publicKey,
      claim_type: 'self_attested',
      claim_method: 'self',
      claim_subject: {},
      signature: '',
    }
    const r = await fetch(`${handle.url}/v6/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(unsigned),
    })
    expect(r.status).toBe(400)
  })

  it('POST /v6/publish rejects a claim with bad signature', async () => {
    const { privateKey, publicKey } = await genKeypair()
    const claim = await signClaim({
      creator_key: publicKey,
      claim_type: 'self_attested',
      claim_method: 'self',
      claim_subject: { display_name: 'alice' },
    }, privateKey)
    // Tamper with the subject after signing
    claim.claim_subject = { display_name: 'mallory' }

    const r = await fetch(`${handle.url}/v6/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(claim),
    })
    expect(r.status).toBe(400)
  })

  it('GET /v6/lookup returns 404 for unregistered key', async () => {
    const { publicKey } = await genKeypair()
    const r = await fetch(`${handle.url}/v6/lookup/${publicKey}`)
    expect(r.status).toBe(404)
    const body = await r.json() as { found: boolean }
    expect(body.found).toBe(false)
  })

  it('GET /v6/history returns version chain', async () => {
    const { privateKey, publicKey } = await genKeypair()
    for (let i = 1; i <= 2; i++) {
      const claim = await signClaim({
        creator_key: publicKey,
        claim_type: 'self_attested',
        claim_method: 'self',
        claim_subject: { display_name: `v${i}` },
      }, privateKey)
      const r = await fetch(`${handle.url}/v6/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(claim),
      })
      expect(r.status).toBe(200)
    }
    const h = await fetch(`${handle.url}/v6/history/${publicKey}`)
    expect(h.status).toBe(200)
    const body = await h.json() as { versions: { version: number }[]; proof: string }
    expect(body.versions.length).toBe(2)
    expect(body.proof.length).toBeGreaterThan(0)
  })

  it('GET /v6/audit-proof between epochs returns serialized proof', async () => {
    const { privateKey, publicKey } = await genKeypair()
    for (let i = 1; i <= 3; i++) {
      const v = await signClaim({
        creator_key: publicKey,
        claim_type: 'self_attested',
        claim_method: 'self',
        claim_subject: { v: i },
      }, privateKey)
      const r = await fetch(`${handle.url}/v6/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(v),
      })
      expect(r.status).toBe(200)
    }

    const proof = await fetch(`${handle.url}/v6/audit-proof?from=1&to=3`)
    expect(proof.status).toBe(200)
    const body = await proof.json() as { from_epoch: number; to_epoch: number; proof: string }
    expect(body.from_epoch).toBe(1)
    expect(body.to_epoch).toBe(3)
    expect(body.proof.length).toBeGreaterThan(0)
  })

  it('GET /v6/audit-proof rejects invalid epoch ranges', async () => {
    const r = await fetch(`${handle.url}/v6/audit-proof?from=5&to=2`)
    expect(r.status).toBe(400)
  })

  it('returns 400 for invalid creator_key format', async () => {
    const r = await fetch(`${handle.url}/v6/lookup/not-a-real-key`)
    expect(r.status).toBe(400)
  })

  it('returns 404 for unknown route', async () => {
    const r = await fetch(`${handle.url}/v6/unknown`)
    expect(r.status).toBe(404)
  })

  // D054: browser-based explorer reads
  it('OPTIONS preflight returns CORS headers (D054)', async () => {
    const r = await fetch(`${handle.url}/v6/audit-proof?from=1&to=2`, { method: 'OPTIONS' })
    expect(r.status).toBe(204)
    expect(r.headers.get('access-control-allow-origin')).toBe('*')
    expect(r.headers.get('access-control-allow-methods')).toContain('GET')
  })

  it('GET responses include access-control-allow-origin (D054)', async () => {
    const r = await fetch(`${handle.url}/v6/audit-proof?from=1&to=3`)
    expect(r.headers.get('access-control-allow-origin')).toBe('*')
  })
})
