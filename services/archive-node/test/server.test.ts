// SPDX-License-Identifier: Apache-2.0

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as ed from '@noble/ed25519'
import { sha512, sha256 } from '@noble/hashes/sha2.js'
import { canonicalRecord, hexEncode, signRecord, type AtribRecord } from '@atrib/mcp'
import { startLogServer } from '@atrib/log-node'
import { bindArchiveServer } from '../src/index.js'

ed.hashes.sha512 = sha512

async function makeSignedRecord(overrides: Partial<AtribRecord> = {}): Promise<AtribRecord> {
  const privateKey = ed.utils.randomSecretKey()
  const publicKeyBytes = await ed.getPublicKeyAsync(privateKey)
  const creatorKey = Buffer.from(publicKeyBytes).toString('base64url')
  const contextId = hexEncode(crypto.getRandomValues(new Uint8Array(16)))
  const chainRoot = `sha256:${hexEncode(sha256(new TextEncoder().encode(contextId)))}`
  const unsigned = {
    spec_version: 'atrib/1.0' as const,
    event_type: 'https://atrib.dev/v1/types/tool_call' as const,
    timestamp: Date.now(),
    context_id: contextId,
    creator_key: creatorKey,
    chain_root: chainRoot,
    content_id: `sha256:${hexEncode(sha256(new TextEncoder().encode('archive-test')))}`,
    signature: '',
    ...overrides,
  }
  return signRecord(unsigned as AtribRecord, privateKey)
}

function hashRecord(record: AtribRecord): string {
  return `sha256:${hexEncode(sha256(canonicalRecord(record)))}`
}

async function submitRecord(logUrl: string, record: AtribRecord): Promise<unknown> {
  const res = await fetch(`${logUrl}/v1/entries`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(record),
  })
  expect(res.status).toBe(200)
  return res.json()
}

describe('archive-node HTTP', () => {
  it('archives a committed record and projects OAuth evidence', async () => {
    const log = await startLogServer({ port: 0 })
    const archive = await bindArchiveServer(0, '127.0.0.1', {
      origin: 'archive.test/v1',
      trustedLogEndpoints: [`${log.url}/v1`],
    })
    try {
      const record = await makeSignedRecord()
      const proof = await submitRecord(log.url, record)
      const hash = hashRecord(record)

      const submit = await fetch(`${archive.url}/v1/records`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          record_hash: hash,
          record,
          proof,
          authorizationEvidence: [
            {
              protocol: 'mcp_oauth',
              claimsVerified: true,
              claims: {
                iss: 'https://issuer.example',
                sub: 'agent-a',
                client_id: 'client-1',
                scope: 'tools:read tools:write',
                resource: 'https://mcp.example',
              },
              issuer: 'https://issuer.example',
              resource: 'https://mcp.example',
              requiredScopes: ['tools:read'],
              expectedClientId: 'client-1',
            },
          ],
          resolvedFacts: { tool_name: 'search' },
        }),
      })
      expect(submit.status).toBe(201)

      const evidence = await fetch(`${archive.url}/v1/evidence/${hash.slice('sha256:'.length)}`)
      expect(evidence.status).toBe(200)
      const body = (await evidence.json()) as {
        record_hash: string
        evidence: Array<{ protocol: string; valid: boolean; attenuation_ok: boolean | null }>
        resolved_facts?: { tool_name?: string }
      }
      expect(body.record_hash).toBe(hash)
      expect(body.resolved_facts?.tool_name).toBe('search')
      expect(body.evidence[0]).toMatchObject({
        protocol: 'mcp_oauth',
        valid: true,
        attenuation_ok: true,
      })

      const retrieved = await fetch(`${archive.url}/v1/record/${hash.slice('sha256:'.length)}`)
      expect(retrieved.status).toBe(200)
      const full = (await retrieved.json()) as { record: AtribRecord; log_proofs: unknown[] }
      expect(full.record.creator_key).toBe(record.creator_key)
      expect(full.log_proofs).toHaveLength(1)
    } finally {
      await archive.close()
      await log.close()
    }
  })

  it('rejects a record that has not been committed to a trusted log', async () => {
    const log = await startLogServer({ port: 0 })
    const archive = await bindArchiveServer(0, '127.0.0.1', {
      origin: 'archive.test/v1',
      trustedLogEndpoints: [`${log.url}/v1`],
    })
    try {
      const record = await makeSignedRecord()
      const res = await fetch(`${archive.url}/v1/records`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ record }),
      })
      expect(res.status).toBe(409)
    } finally {
      await archive.close()
      await log.close()
    }
  })

  it('returns a generic problem for invalid JSON bodies', async () => {
    const archive = await bindArchiveServer(0, '127.0.0.1', {
      origin: 'archive.test/v1',
      allowUncommittedRecords: true,
    })
    try {
      const res = await fetch(`${archive.url}/v1/records`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{',
      })
      expect(res.status).toBe(400)
      const body = (await res.json()) as { detail: string }
      expect(body.detail).toBe('invalid JSON body')
    } finally {
      await archive.close()
    }
  })

  it('does not expose archive validation exception text', async () => {
    const archive = await bindArchiveServer(0, '127.0.0.1', {
      origin: 'archive.test/v1',
      allowUncommittedRecords: true,
    })
    try {
      const res = await fetch(`${archive.url}/v1/records`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ record: { bad: true } }),
      })
      expect(res.status).toBe(400)
      const body = (await res.json()) as { detail: string }
      expect(body.detail).toBe('archive submission failed validation')
      expect(body.detail).not.toContain('Error')
    } finally {
      await archive.close()
    }
  })

  it('sets CORS headers on read endpoints', async () => {
    const archive = await bindArchiveServer(0, '127.0.0.1', {
      origin: 'archive.test',
      allowUncommittedRecords: true,
    })
    try {
      const res = await fetch(`${archive.url}/v1/retention`)
      expect(res.status).toBe(200)
      expect(res.headers.get('access-control-allow-origin')).toBe('*')
      const body = (await res.json()) as { operator: string }
      expect(body.operator).toBe('archive.test')
    } finally {
      await archive.close()
    }
  })

  it('replays persisted records after restart', async () => {
    const log = await startLogServer({ port: 0 })
    const dir = await mkdtemp(join(tmpdir(), 'atrib-archive-'))
    const persistencePath = join(dir, 'archive.jsonl')
    const record = await makeSignedRecord()
    const proof = await submitRecord(log.url, record)
    const hash = hashRecord(record)

    const first = await bindArchiveServer(0, '127.0.0.1', {
      origin: 'archive.test/v1',
      trustedLogEndpoints: [`${log.url}/v1`],
      persistencePath,
    })
    try {
      const res = await fetch(`${first.url}/v1/records`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ record, proof }),
      })
      expect(res.status).toBe(201)
    } finally {
      await first.close()
    }

    const second = await bindArchiveServer(0, '127.0.0.1', {
      origin: 'archive.test/v1',
      trustedLogEndpoints: [`${log.url}/v1`],
      persistencePath,
    })
    try {
      const res = await fetch(`${second.url}/v1/record/${hash.slice('sha256:'.length)}`)
      expect(res.status).toBe(200)
    } finally {
      await second.close()
      await log.close()
    }
  })

  it('returns 410 after the retention window expires', async () => {
    let now = 1_000
    const archive = await bindArchiveServer(0, '127.0.0.1', {
      origin: 'archive.test/v1',
      allowUncommittedRecords: true,
      retentionWindowMs: 10,
      nowMs: () => now,
    })
    try {
      const record = await makeSignedRecord()
      const hash = hashRecord(record)
      const submit = await fetch(`${archive.url}/v1/records`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ record }),
      })
      expect(submit.status).toBe(201)
      now = 1_011

      const expired = await fetch(`${archive.url}/v1/record/${hash.slice('sha256:'.length)}`)
      expect(expired.status).toBe(410)
      const body = (await expired.json()) as { error: string; expired_at_ms: number }
      expect(body.error).toBe('retention expired')
      expect(body.expired_at_ms).toBe(1_010)
    } finally {
      await archive.close()
    }
  })
})
