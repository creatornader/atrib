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
import {
  bindDirectoryServer,
  hashDirectoryAnchor,
  type AnchorRecord,
  type DirectoryServerHandle,
} from '../src/index.js'

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
    const body = (await r.json()) as { epoch: number; root_hash: string; directory_origin: string }
    expect(body.epoch).toBe(0)
    expect(body.root_hash.length).toBeGreaterThan(0)
    expect(body.directory_origin).toBe('directory.test.local/v6')
  })

  it('POST /v6/publish + GET /v6/lookup round-trips a claim', async () => {
    const { privateKey, publicKey } = await genKeypair()
    const claim: IdentityClaim = await signClaim(
      {
        creator_key: publicKey,
        claim_type: 'self_attested',
        claim_method: 'self',
        claim_subject: { display_name: 'alice' },
      },
      privateKey,
    )

    const pub = await fetch(`${handle.url}/v6/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(claim),
    })
    expect(pub.status).toBe(200)
    const pubBody = (await pub.json()) as {
      epoch: number
      root_hash: string
      anchor: { submitted: boolean }
    }
    expect(pubBody.epoch).toBe(1)
    expect(pubBody.anchor.submitted).toBe(false) // no logEndpoint configured

    const look = await fetch(`${handle.url}/v6/lookup/${publicKey}`)
    expect(look.status).toBe(200)
    const lookBody = (await look.json()) as {
      found: boolean
      claim: IdentityClaim
      version: number
      proof: string
    }
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
    const claim = await signClaim(
      {
        creator_key: publicKey,
        claim_type: 'self_attested',
        claim_method: 'self',
        claim_subject: { display_name: 'alice' },
      },
      privateKey,
    )
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
    const body = (await r.json()) as { found: boolean }
    expect(body.found).toBe(false)
  })

  it('GET /v6/history returns version chain', async () => {
    const { privateKey, publicKey } = await genKeypair()
    for (let i = 1; i <= 2; i++) {
      const claim = await signClaim(
        {
          creator_key: publicKey,
          claim_type: 'self_attested',
          claim_method: 'self',
          claim_subject: { display_name: `v${i}` },
        },
        privateKey,
      )
      const r = await fetch(`${handle.url}/v6/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(claim),
      })
      expect(r.status).toBe(200)
    }
    const h = await fetch(`${handle.url}/v6/history/${publicKey}`)
    expect(h.status).toBe(200)
    const body = (await h.json()) as { versions: { version: number }[]; proof: string }
    expect(body.versions.length).toBe(2)
    expect(body.proof.length).toBeGreaterThan(0)
  })

  it('GET /v6/audit-proof between epochs returns serialized proof', async () => {
    const { privateKey, publicKey } = await genKeypair()
    for (let i = 1; i <= 3; i++) {
      const v = await signClaim(
        {
          creator_key: publicKey,
          claim_type: 'self_attested',
          claim_method: 'self',
          claim_subject: { v: i },
        },
        privateKey,
      )
      const r = await fetch(`${handle.url}/v6/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(v),
      })
      expect(r.status).toBe(200)
    }

    const proof = await fetch(`${handle.url}/v6/audit-proof?from=1&to=3`)
    expect(proof.status).toBe(200)
    const body = (await proof.json()) as { from_epoch: number; to_epoch: number; proof: string }
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

  it('GET /v6 returns service-info index', async () => {
    const r = await fetch(`${handle.url}/v6`)
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body.service).toBe('atrib-directory-node')
    expect(body.versions).toEqual(['v6'])
    expect(body.current_version).toBe('v6')
    expect(body.endpoints).toMatchObject({
      publish: 'POST /v6/publish',
      lookup: 'GET /v6/lookup/<creator_key>',
      history: 'GET /v6/history/<creator_key>',
      anchor: 'GET /v6/anchor',
    })
  })

  it('GET /v6/ (with trailing slash) also returns service-info index', async () => {
    const r = await fetch(`${handle.url}/v6/`)
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body.service).toBe('atrib-directory-node')
  })

  it('GET / (bare hostname) returns the same service-info index', async () => {
    const r = await fetch(`${handle.url}/`)
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body.service).toBe('atrib-directory-node')
    expect(body.current_version).toBe('v6')
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

// ===========================================================================
// /v6/anchors (point lookup + recent list): body retrieval for §6.3 step 1.
//
// Boots a stub log-node sink so emitDirectoryAnchor produces a record (which
// the directory persists in its in-memory anchor history) regardless of log
// submission outcome. The stub responds 200 to /v1/entries; the bodies in the
// stub responses are irrelevant to these tests because we read the anchors
// from directory-node, not from the log.
// ===========================================================================

describe('directory-node /v6/anchors body retrieval', () => {
  let handle: DirectoryServerHandle
  let stubLog: {
    url: string
    close: () => Promise<void>
    submissions: AnchorRecord[]
    postStatuses: number[]
  }

  beforeEach(async () => {
    const { createServer } = await import('node:http')
    const submissions: AnchorRecord[] = []
    const accepted = new Map<string, AnchorRecord>()
    const postStatuses: number[] = []
    const server = createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/v1/entries') {
        let body = ''
        req.setEncoding('utf-8')
        req.on('data', (c) => {
          body += c
        })
        req.on('end', () => {
          const record = JSON.parse(body) as AnchorRecord
          submissions.push(record)
          const status = postStatuses.shift() ?? 200
          if (status === 200) accepted.set(hashDirectoryAnchor(record), record)
          res.statusCode = status
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ tree_size: accepted.size }))
        })
        return
      }
      const lookup = req.url?.match(/^\/v1\/lookup\/([0-9a-f]{64})$/)
      if (req.method === 'GET' && lookup) {
        const recordHash = `sha256:${lookup[1]}`
        if (accepted.has(recordHash)) {
          res.statusCode = 200
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ record_hash: recordHash }))
        } else {
          res.statusCode = 404
          res.end()
        }
        return
      }
      res.statusCode = 404
      res.end()
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    const addr = server.address()
    const port = typeof addr === 'object' && addr ? addr.port : 0
    stubLog = {
      url: `http://127.0.0.1:${port}`,
      close: () => new Promise((resolve) => server.close(() => resolve())),
      submissions,
      postStatuses,
    }

    handle = await bindDirectoryServer(0, '127.0.0.1', {
      operatorPrivateKey: randomBytes(32),
      origin: 'directory.test.local/v6',
      logEndpoint: `${stubLog.url}/v1`,
    })
  })

  afterEach(async () => {
    await handle.close()
    await stubLog.close()
  })

  async function publishOne(displayName: string): Promise<{ recordHash: string; epoch: number }> {
    const { privateKey, publicKey } = await genKeypair()
    const claim = await signClaim(
      {
        creator_key: publicKey,
        claim_type: 'self_attested',
        claim_method: 'self',
        claim_subject: { display_name: displayName },
      },
      privateKey,
    )
    const r = await fetch(`${handle.url}/v6/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(claim),
    })
    expect(r.status).toBe(200)
    const body = (await r.json()) as {
      epoch: number
      anchor: { record_hash: string; submitted: boolean }
    }
    expect(body.anchor.submitted).toBe(true)
    expect(body.anchor.record_hash).toMatch(/^sha256:[0-9a-f]{64}$/)
    return { recordHash: body.anchor.record_hash, epoch: body.epoch }
  }

  it('GET /v6/anchors/<hash> returns the signed body for a known anchor', async () => {
    const { recordHash, epoch } = await publishOne('alice')

    const r = await fetch(`${handle.url}/v6/anchors/${recordHash}`)
    expect(r.status).toBe(200)
    const body = (await r.json()) as {
      record_hash: string
      record: {
        event_type: string
        creator_key: string
        metadata: { directory_origin: string; directory_root: string; directory_epoch: number }
        signature: string
      }
    }
    expect(body.record_hash).toBe(recordHash)
    expect(body.record.event_type).toBe('https://atrib.dev/v1/types/directory_anchor')
    expect(body.record.metadata.directory_epoch).toBe(epoch)
    expect(body.record.metadata.directory_origin).toBe('directory.test.local/v6')
    expect(body.record.metadata.directory_root.length).toBeGreaterThan(0)
    expect(body.record.signature.length).toBeGreaterThan(0)
  })

  it('GET /v6/anchors/<hash> returns 404 for an unknown hash', async () => {
    await publishOne('alice') // ensure history is non-empty
    const fakeHash = 'sha256:' + 'f'.repeat(64)
    const r = await fetch(`${handle.url}/v6/anchors/${fakeHash}`)
    expect(r.status).toBe(404)
  })

  it('GET /v6/anchors/<hash> returns 404 for a malformed hash (regex miss)', async () => {
    const r = await fetch(`${handle.url}/v6/anchors/notahash`)
    // Falls through to the default 404 because the regex doesn't match;
    // documented behavior: malformed inputs are not honored.
    expect(r.status).toBe(404)
  })

  it('GET /v6/anchors returns recent anchors newest-first', async () => {
    const a = await publishOne('alice')
    const b = await publishOne('bob')
    const c = await publishOne('carol')

    const r = await fetch(`${handle.url}/v6/anchors`)
    expect(r.status).toBe(200)
    const body = (await r.json()) as {
      total_anchors: number
      since: number | null
      limit: number
      count: number
      anchors: { metadata: { directory_epoch: number } }[]
    }
    expect(body.total_anchors).toBe(3)
    expect(body.since).toBeNull()
    expect(body.limit).toBe(100)
    expect(body.count).toBe(3)
    // Newest-first order: carol (epoch 3) → bob (2) → alice (1)
    expect(body.anchors.map((x) => x.metadata.directory_epoch)).toEqual([c.epoch, b.epoch, a.epoch])
  })

  it('chains each committed anchor to the prior anchor record hash', async () => {
    const first = await publishOne('alice')
    const second = await publishOne('bob')
    const third = await publishOne('carol')

    expect(stubLog.submissions).toHaveLength(3)
    expect(stubLog.submissions[1]?.chain_root).toBe(first.recordHash)
    expect(stubLog.submissions[2]?.chain_root).toBe(second.recordHash)
    expect(hashDirectoryAnchor(stubLog.submissions[2]!)).toBe(third.recordHash)
  })

  it('retries an uncommitted anchor before advancing the directory', async () => {
    stubLog.postStatuses.push(503)
    const first = await publishOneExpectingPending('alice')

    const before = (await (await fetch(`${handle.url}/v6/anchors`)).json()) as {
      total_anchors: number
    }
    expect(before.total_anchors).toBe(0)
    expect((await fetch(`${handle.url}/v6/anchors/${first.recordHash}`)).status).toBe(200)

    const second = await publishOne('bob')
    expect(stubLog.submissions).toHaveLength(3)
    expect(hashDirectoryAnchor(stubLog.submissions[0]!)).toBe(first.recordHash)
    expect(hashDirectoryAnchor(stubLog.submissions[1]!)).toBe(first.recordHash)
    expect(stubLog.submissions[2]?.chain_root).toBe(first.recordHash)
    expect(hashDirectoryAnchor(stubLog.submissions[2]!)).toBe(second.recordHash)

    const after = (await (await fetch(`${handle.url}/v6/anchors`)).json()) as {
      total_anchors: number
    }
    expect(after.total_anchors).toBe(2)
  })

  it('serializes concurrent publishes into one anchor chain', async () => {
    const publishes = await Promise.all(
      Array.from({ length: 8 }, (_, index) => publishOne(`agent-${index}`)),
    )

    expect(stubLog.submissions).toHaveLength(8)
    for (let index = 1; index < stubLog.submissions.length; index += 1) {
      expect(stubLog.submissions[index]?.chain_root).toBe(
        hashDirectoryAnchor(stubLog.submissions[index - 1]!),
      )
    }
    expect(new Set(publishes.map(({ epoch }) => epoch)).size).toBe(8)
  })

  it('GET /v6/anchors honors `since` cutoff', async () => {
    await publishOne('alice')
    const middle = Date.now()
    // Brief wait so the next anchor's timestamp is strictly greater than `middle`.
    await new Promise((resolve) => setTimeout(resolve, 5))
    await publishOne('bob')

    const r = await fetch(`${handle.url}/v6/anchors?since=${middle}`)
    expect(r.status).toBe(200)
    const body = (await r.json()) as {
      count: number
      anchors: { metadata: { directory_epoch: number } }[]
    }
    expect(body.count).toBe(1)
    expect(body.anchors[0]?.metadata.directory_epoch).toBe(2) // only bob
  })

  it('GET /v6/anchors honors `limit` cap', async () => {
    await publishOne('a')
    await publishOne('b')
    await publishOne('c')

    const r = await fetch(`${handle.url}/v6/anchors?limit=2`)
    const body = (await r.json()) as { count: number; anchors: unknown[] }
    expect(body.count).toBe(2)
    expect(body.anchors.length).toBe(2)
  })

  it('GET /v6/anchors rejects negative `since`', async () => {
    const r = await fetch(`${handle.url}/v6/anchors?since=-1`)
    expect(r.status).toBe(400)
  })

  it('GET /v6/anchors rejects zero `limit`', async () => {
    const r = await fetch(`${handle.url}/v6/anchors?limit=0`)
    expect(r.status).toBe(400)
  })

  it('GET /v6/anchors returns empty list before any publishes', async () => {
    const r = await fetch(`${handle.url}/v6/anchors`)
    expect(r.status).toBe(200)
    const body = (await r.json()) as { total_anchors: number; count: number; anchors: unknown[] }
    expect(body.total_anchors).toBe(0)
    expect(body.count).toBe(0)
    expect(body.anchors).toEqual([])
  })

  async function publishOneExpectingPending(
    displayName: string,
  ): Promise<{ recordHash: string; epoch: number }> {
    const { privateKey, publicKey } = await genKeypair()
    const claim = await signClaim(
      {
        creator_key: publicKey,
        claim_type: 'self_attested',
        claim_method: 'self',
        claim_subject: { display_name: displayName },
      },
      privateKey,
    )
    const response = await fetch(`${handle.url}/v6/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(claim),
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      epoch: number
      anchor: { record_hash: string; submitted: boolean; pending: boolean }
    }
    expect(body.anchor.submitted).toBe(false)
    expect(body.anchor.pending).toBe(true)
    return { recordHash: body.anchor.record_hash, epoch: body.epoch }
  }
})

describe('directory-node persistence', () => {
  it('fails closed on claim-journal corruption', async () => {
    const { mkdtemp, rm, writeFile } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const opKey = randomBytes(32)
    const dir = await mkdtemp(join(tmpdir(), 'atrib-dir-corrupt-'))
    const persistPath = join(dir, 'publishes.jsonl')

    try {
      await writeFile(persistPath, '{not-json}\n')
      await expect(
        bindDirectoryServer(0, '127.0.0.1', {
          operatorPrivateKey: opKey,
          origin: 'directory.test.local/v6',
          persistencePath: persistPath,
        }),
      ).rejects.toThrow('directory claim journal line 1 is not valid JSON')

      const key = await genKeypair()
      const claim = await signClaim(
        {
          creator_key: key.publicKey,
          claim_type: 'self_attested',
          claim_method: 'self',
          claim_subject: { display_name: 'tampered' },
        },
        key.privateKey,
      )
      await writeFile(persistPath, `${JSON.stringify({ ...claim, signature: 'invalid' })}\n`)
      await expect(
        bindDirectoryServer(0, '127.0.0.1', {
          operatorPrivateKey: opKey,
          origin: 'directory.test.local/v6',
          persistencePath: persistPath,
        }),
      ).rejects.toThrow('directory claim journal line 1 has an invalid signature')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('replays persisted claims after restart and produces identical lookups', async () => {
    const { mkdtemp, rm } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const opKey = randomBytes(32)
    const dir = await mkdtemp(join(tmpdir(), 'atrib-dir-persist-'))
    const persistPath = join(dir, 'publishes.jsonl')

    // Step 1: boot, publish 2 claims, capture epoch + root_hash
    const a = await bindDirectoryServer(0, '127.0.0.1', {
      operatorPrivateKey: opKey,
      origin: 'directory.test.local/v6',
      persistencePath: persistPath,
    })

    const k1 = await genKeypair()
    const k2 = await genKeypair()
    const claim1 = await signClaim(
      {
        creator_key: k1.publicKey,
        claim_type: 'self_attested',
        claim_method: 'self',
        claim_subject: { display_name: 'alice' },
      },
      k1.privateKey,
    )
    const claim2 = await signClaim(
      {
        creator_key: k2.publicKey,
        claim_type: 'self_attested',
        claim_method: 'self',
        claim_subject: { display_name: 'bob' },
      },
      k2.privateKey,
    )

    for (const c of [claim1, claim2]) {
      const r = await fetch(`${a.url}/v6/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(c),
      })
      expect(r.status).toBe(200)
    }
    const beforeAnchor = (await (await fetch(`${a.url}/v6/anchor`)).json()) as {
      epoch: number
      root_hash: string
    }
    expect(beforeAnchor.epoch).toBe(2)
    await a.close()

    // Step 2: boot a fresh server with the same persistence path, expect replay
    const b = await bindDirectoryServer(0, '127.0.0.1', {
      operatorPrivateKey: opKey,
      origin: 'directory.test.local/v6',
      persistencePath: persistPath,
    })

    const afterAnchor = (await (await fetch(`${b.url}/v6/anchor`)).json()) as {
      epoch: number
      root_hash: string
    }
    expect(afterAnchor.epoch).toBe(beforeAnchor.epoch)
    expect(afterAnchor.root_hash).toBe(beforeAnchor.root_hash)

    // Both claims still findable
    const a1 = (await (await fetch(`${b.url}/v6/lookup/${k1.publicKey}`)).json()) as {
      found: boolean
      claim: IdentityClaim
    }
    const a2 = (await (await fetch(`${b.url}/v6/lookup/${k2.publicKey}`)).json()) as {
      found: boolean
      claim: IdentityClaim
    }
    expect(a1.found).toBe(true)
    expect(a2.found).toBe(true)
    expect(a1.claim.claim_subject.display_name).toBe('alice')
    expect(a2.claim.claim_subject.display_name).toBe('bob')

    await b.close()
    await rm(dir, { recursive: true, force: true })
  })

  it('restores committed anchor bodies and the chain head after restart', async () => {
    const { createServer } = await import('node:http')
    const { appendFile, mkdtemp, rm } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const accepted = new Map<string, AnchorRecord>()
    const submissions: AnchorRecord[] = []
    const logServer = createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/v1/entries') {
        let body = ''
        req.setEncoding('utf8')
        req.on('data', (chunk) => {
          body += chunk
        })
        req.on('end', () => {
          const record = JSON.parse(body) as AnchorRecord
          const recordHash = hashDirectoryAnchor(record)
          accepted.set(recordHash, record)
          submissions.push(record)
          res.statusCode = 200
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ tree_size: accepted.size }))
        })
        return
      }
      const lookup = req.url?.match(/^\/v1\/lookup\/([0-9a-f]{64})$/)
      if (req.method === 'GET' && lookup) {
        const recordHash = `sha256:${lookup[1]}`
        if (accepted.has(recordHash)) {
          res.statusCode = 200
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ record_hash: recordHash }))
        } else {
          res.statusCode = 404
          res.end()
        }
        return
      }
      res.statusCode = 404
      res.end()
    })
    await new Promise<void>((resolve) => logServer.listen(0, '127.0.0.1', resolve))
    const address = logServer.address()
    const logPort = typeof address === 'object' && address ? address.port : 0
    const logEndpoint = `http://127.0.0.1:${logPort}/v1`
    const opKey = randomBytes(32)
    const dir = await mkdtemp(join(tmpdir(), 'atrib-dir-anchor-persist-'))
    const persistPath = join(dir, 'publishes.jsonl')

    const publish = async (server: DirectoryServerHandle, name: string): Promise<string> => {
      const key = await genKeypair()
      const claim = await signClaim(
        {
          creator_key: key.publicKey,
          claim_type: 'self_attested',
          claim_method: 'self',
          claim_subject: { display_name: name },
        },
        key.privateKey,
      )
      const response = await fetch(`${server.url}/v6/publish`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(claim),
      })
      expect(response.status).toBe(200)
      const body = (await response.json()) as { anchor: { record_hash: string } }
      return body.anchor.record_hash
    }

    const firstServer = await bindDirectoryServer(0, '127.0.0.1', {
      operatorPrivateKey: opKey,
      origin: 'directory.test.local/v6',
      logEndpoint,
      persistencePath: persistPath,
    })
    const firstHash = await publish(firstServer, 'alice')
    const secondHash = await publish(firstServer, 'bob')
    await firstServer.close()

    // Simulate a crash after the claim write-ahead record reached disk but
    // before the in-memory publish and its anchor preparation completed.
    const interruptedKey = await genKeypair()
    const interruptedClaim = await signClaim(
      {
        creator_key: interruptedKey.publicKey,
        claim_type: 'self_attested',
        claim_method: 'self',
        claim_subject: { display_name: 'interrupted' },
      },
      interruptedKey.privateKey,
    )
    await appendFile(persistPath, `${JSON.stringify(interruptedClaim)}\n`)

    const secondServer = await bindDirectoryServer(0, '127.0.0.1', {
      operatorPrivateKey: opKey,
      origin: 'directory.test.local/v6',
      logEndpoint,
      persistencePath: persistPath,
    })
    const restored = (await (await fetch(`${secondServer.url}/v6/anchors`)).json()) as {
      total_anchors: number
    }
    expect(restored.total_anchors).toBe(3)
    expect((await fetch(`${secondServer.url}/v6/anchors/${firstHash}`)).status).toBe(200)
    expect((await fetch(`${secondServer.url}/v6/anchors/${secondHash}`)).status).toBe(200)
    const recoveredRecord = submissions.at(-1)!
    const recoveredHash = hashDirectoryAnchor(recoveredRecord)
    expect(recoveredRecord.chain_root).toBe(secondHash)

    const thirdHash = await publish(secondServer, 'carol')
    expect(submissions.at(-1)?.chain_root).toBe(recoveredHash)
    expect(hashDirectoryAnchor(submissions.at(-1)!)).toBe(thirdHash)

    await secondServer.close()
    await new Promise<void>((resolve) => logServer.close(() => resolve()))
    await rm(dir, { recursive: true, force: true })
  })

  it('reconciles a prepared anchor after restart before accepting a successor', async () => {
    const { createServer } = await import('node:http')
    const { mkdtemp, rm } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const accepted = new Set<string>()
    const submissions: AnchorRecord[] = []
    let failFirstSubmission = true
    const logServer = createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/v1/entries') {
        let body = ''
        req.setEncoding('utf8')
        req.on('data', (chunk) => {
          body += chunk
        })
        req.on('end', () => {
          const record = JSON.parse(body) as AnchorRecord
          submissions.push(record)
          if (failFirstSubmission) {
            failFirstSubmission = false
            res.statusCode = 503
            res.end()
            return
          }
          accepted.add(hashDirectoryAnchor(record))
          res.statusCode = 200
          res.end()
        })
        return
      }
      const lookup = req.url?.match(/^\/v1\/lookup\/([0-9a-f]{64})$/)
      if (req.method === 'GET' && lookup) {
        const recordHash = `sha256:${lookup[1]}`
        if (accepted.has(recordHash)) {
          res.statusCode = 200
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ record_hash: recordHash }))
        } else {
          res.statusCode = 404
          res.end()
        }
        return
      }
      res.statusCode = 404
      res.end()
    })
    await new Promise<void>((resolve) => logServer.listen(0, '127.0.0.1', resolve))
    const address = logServer.address()
    const logPort = typeof address === 'object' && address ? address.port : 0
    const logEndpoint = `http://127.0.0.1:${logPort}/v1`
    const opKey = randomBytes(32)
    const dir = await mkdtemp(join(tmpdir(), 'atrib-dir-anchor-pending-'))
    const persistPath = join(dir, 'publishes.jsonl')

    const publish = async (
      server: DirectoryServerHandle,
      name: string,
    ): Promise<{ status: number; recordHash?: string; pending?: boolean }> => {
      const key = await genKeypair()
      const claim = await signClaim(
        {
          creator_key: key.publicKey,
          claim_type: 'self_attested',
          claim_method: 'self',
          claim_subject: { display_name: name },
        },
        key.privateKey,
      )
      const response = await fetch(`${server.url}/v6/publish`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(claim),
      })
      const body = (await response.json()) as {
        anchor?: { record_hash?: string; pending?: boolean }
      }
      return {
        status: response.status,
        recordHash: body.anchor?.record_hash,
        pending: body.anchor?.pending,
      }
    }

    const firstServer = await bindDirectoryServer(0, '127.0.0.1', {
      operatorPrivateKey: opKey,
      origin: 'directory.test.local/v6',
      logEndpoint,
      persistencePath: persistPath,
    })
    const first = await publish(firstServer, 'alice')
    expect(first.status).toBe(200)
    expect(first.pending).toBe(true)
    await firstServer.close()

    const secondServer = await bindDirectoryServer(0, '127.0.0.1', {
      operatorPrivateKey: opKey,
      origin: 'directory.test.local/v6',
      logEndpoint,
      persistencePath: persistPath,
    })
    const second = await publish(secondServer, 'bob')
    expect(second.status).toBe(200)
    expect(submissions).toHaveLength(3)
    expect(hashDirectoryAnchor(submissions[0]!)).toBe(first.recordHash)
    expect(hashDirectoryAnchor(submissions[1]!)).toBe(first.recordHash)
    expect(submissions[2]?.chain_root).toBe(first.recordHash)

    await secondServer.close()
    await new Promise<void>((resolve) => logServer.close(() => resolve()))
    await rm(dir, { recursive: true, force: true })
  })

  it('bootstraps a new journal from the latest existing log anchor', async () => {
    const { createServer } = await import('node:http')
    const { mkdtemp, rm } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const opKey = randomBytes(32)
    const operatorCreatorKey = Buffer.from(await ed25519.getPublicKeyAsync(opKey)).toString(
      'base64url',
    )
    const dir = await mkdtemp(join(tmpdir(), 'atrib-dir-anchor-bootstrap-'))
    const persistPath = join(dir, 'publishes.jsonl')

    const unanchoredServer = await bindDirectoryServer(0, '127.0.0.1', {
      operatorPrivateKey: opKey,
      origin: 'directory.test.local/v6',
      persistencePath: persistPath,
    })
    const key = await genKeypair()
    const claim = await signClaim(
      {
        creator_key: key.publicKey,
        claim_type: 'self_attested',
        claim_method: 'self',
        claim_subject: { display_name: 'existing' },
      },
      key.privateKey,
    )
    const publishResponse = await fetch(`${unanchoredServer.url}/v6/publish`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(claim),
    })
    expect(publishResponse.status).toBe(200)
    await unanchoredServer.close()

    const predecessorHash = `sha256:${'a'.repeat(64)}`
    const submissions: AnchorRecord[] = []
    const logServer = createServer((req, res) => {
      if (req.method === 'GET' && req.url?.startsWith('/v1/by-context/')) {
        res.statusCode = 200
        res.setHeader('content-type', 'application/json')
        res.end(
          JSON.stringify({
            entries: [
              {
                record_hash: predecessorHash,
                creator_key: operatorCreatorKey,
                event_type: 'directory_anchor',
              },
            ],
          }),
        )
        return
      }
      if (req.method === 'POST' && req.url === '/v1/entries') {
        let body = ''
        req.setEncoding('utf8')
        req.on('data', (chunk) => {
          body += chunk
        })
        req.on('end', () => {
          submissions.push(JSON.parse(body) as AnchorRecord)
          res.statusCode = 200
          res.end()
        })
        return
      }
      res.statusCode = 404
      res.end()
    })
    await new Promise<void>((resolve) => logServer.listen(0, '127.0.0.1', resolve))
    const address = logServer.address()
    const logPort = typeof address === 'object' && address ? address.port : 0

    const anchoredServer = await bindDirectoryServer(0, '127.0.0.1', {
      operatorPrivateKey: opKey,
      origin: 'directory.test.local/v6',
      logEndpoint: `http://127.0.0.1:${logPort}/v1`,
      persistencePath: persistPath,
    })
    expect(submissions).toHaveLength(1)
    expect(submissions[0]?.chain_root).toBe(predecessorHash)
    const anchors = (await (await fetch(`${anchoredServer.url}/v6/anchors`)).json()) as {
      total_anchors: number
    }
    expect(anchors.total_anchors).toBe(1)

    await anchoredServer.close()
    await new Promise<void>((resolve) => logServer.close(() => resolve()))
    await rm(dir, { recursive: true, force: true })
  })
})
