// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import * as ed from '@noble/ed25519'
import { sha512 } from '@noble/hashes/sha2.js'
import canonicalize from 'canonicalize'
import {
  base64urlEncode,
  canonicalRecord,
  hexEncode,
  sha256,
  signRecord,
  type AtribRecord,
} from '@atrib/mcp'
import { verifyHandoffClaims } from '../src/index.js'

ed.hashes.sha512 = sha512

const NOW_MS = Date.now()

function hashJson(value: unknown): string {
  const encoded = canonicalize(value)
  if (encoded === undefined) throw new Error('test value is not JCS-encodable')
  return `sha256:${hexEncode(sha256(new TextEncoder().encode(encoded)))}`
}

function recordHash(record: AtribRecord): string {
  return `sha256:${hexEncode(sha256(canonicalRecord(record)))}`
}

async function buildClaimRecord(seedByte: number, body: unknown): Promise<AtribRecord> {
  const seed = new Uint8Array(32).fill(seedByte)
  const creatorKey = base64urlEncode(await ed.getPublicKeyAsync(seed))
  return signRecord(
    {
      spec_version: 'atrib/1.0',
      content_id: hashJson({ claim: 'pattern3', body }),
      creator_key: creatorKey,
      chain_root: 'sha256:' + '1'.repeat(64),
      event_type: 'https://atrib.dev/v1/types/observation',
      context_id: '2'.repeat(32),
      timestamp: NOW_MS - 1_000,
      args_hash: hashJson(body),
      signature: '',
    } as AtribRecord,
    seed,
  )
}

async function buildUncommittedClaimRecord(seedByte: number, body: unknown): Promise<AtribRecord> {
  const seed = new Uint8Array(32).fill(seedByte)
  const creatorKey = base64urlEncode(await ed.getPublicKeyAsync(seed))
  return signRecord(
    {
      spec_version: 'atrib/1.0',
      content_id: hashJson({ claim: 'pattern3', body }),
      creator_key: creatorKey,
      chain_root: 'sha256:' + '1'.repeat(64),
      event_type: 'https://atrib.dev/v1/types/observation',
      context_id: '2'.repeat(32),
      timestamp: NOW_MS - 1_000,
      signature: '',
    } as AtribRecord,
    seed,
  )
}

async function buildMalformedSaltClaimRecord(
  seedByte: number,
  body: unknown,
): Promise<AtribRecord> {
  const seed = new Uint8Array(32).fill(seedByte)
  const creatorKey = base64urlEncode(await ed.getPublicKeyAsync(seed))
  return signRecord(
    {
      spec_version: 'atrib/1.0',
      content_id: hashJson({ claim: 'pattern3-malformed-salt', body }),
      creator_key: creatorKey,
      chain_root: 'sha256:' + '1'.repeat(64),
      event_type: 'https://atrib.dev/v1/types/observation',
      context_id: '2'.repeat(32),
      timestamp: NOW_MS - 1_000,
      args_hash: 'sha256:' + '0'.repeat(64),
      args_salt: 'not base64url?',
      signature: '',
    } as AtribRecord,
    seed,
  )
}

async function buildFutureClaimRecord(seedByte: number, body: unknown): Promise<AtribRecord> {
  const seed = new Uint8Array(32).fill(seedByte)
  const creatorKey = base64urlEncode(await ed.getPublicKeyAsync(seed))
  return signRecord(
    {
      spec_version: 'atrib/1.0',
      content_id: hashJson({ claim: 'pattern3-future', body }),
      creator_key: creatorKey,
      chain_root: 'sha256:' + '1'.repeat(64),
      event_type: 'https://atrib.dev/v1/types/observation',
      context_id: '2'.repeat(32),
      timestamp: NOW_MS + 60_000,
      args_hash: hashJson(body),
      signature: '',
    } as AtribRecord,
    seed,
  )
}

describe('verifyHandoffClaims', () => {
  it('accepts a fresh trusted claim with matching record hash and body commitment', async () => {
    const body = { summary: 'Agent A read the tenant logs', ticket: 'SUP-42' }
    const record = await buildClaimRecord(11, body)
    const hash = recordHash(record)

    const result = await verifyHandoffClaims([{ record_hash: hash, record, body }], {
      trusted_creator_keys: [record.creator_key],
      require_body: true,
      require_body_commitment: true,
      now_ms: NOW_MS,
      max_age_ms: 60_000,
    })

    expect(result.accepted_record_hashes).toEqual([hash])
    expect(result.rejected).toEqual([])
    expect(result.accepted[0]?.record_hash).toBe(hash)
    expect(result.accepted[0]?.signature_ok).toBe(true)
    expect(result.accepted[0]?.body?.args_hash_ok).toBe(true)
  })

  it('rejects a claim without proof when log inclusion is required', async () => {
    const body = { summary: 'Agent A read the tenant logs', ticket: 'SUP-42' }
    const record = await buildClaimRecord(11, body)
    const hash = recordHash(record)

    const result = await verifyHandoffClaims([{ record_hash: hash, record, body }], {
      trusted_creator_keys: [record.creator_key],
      require_body: true,
      require_body_commitment: true,
      require_log_inclusion: true,
      now_ms: NOW_MS,
      max_age_ms: 60_000,
    })

    expect(result.accepted_record_hashes).toEqual([])
    expect(result.rejected[0]?.rejection_reasons).toContain('proof_missing')
  })

  it('rejects an invalid proof when log inclusion is required', async () => {
    const body = { summary: 'Agent A read the tenant logs', ticket: 'SUP-42' }
    const record = await buildClaimRecord(11, body)
    const hash = recordHash(record)

    const result = await verifyHandoffClaims(
      [
        {
          record_hash: hash,
          record,
          body,
          proof: {
            log_index: 0,
            checkpoint: 'not a checkpoint',
            inclusion_proof: [],
            leaf_hash: Buffer.alloc(32).toString('base64'),
          },
        },
      ],
      {
        trusted_creator_keys: [record.creator_key],
        require_body: true,
        require_body_commitment: true,
        require_log_inclusion: true,
        now_ms: NOW_MS,
        max_age_ms: 60_000,
      },
    )

    expect(result.accepted_record_hashes).toEqual([])
    expect(result.rejected[0]?.rejection_reasons).toContain('proof_invalid')
    expect(result.rejected[0]?.proof?.inclusion_ok).toBe(false)
  })

  it('rejects a missing record for a claimed hash', async () => {
    const hash = 'sha256:' + 'a'.repeat(64)

    const result = await verifyHandoffClaims([{ record_hash: hash }])

    expect(result.accepted_record_hashes).toEqual([])
    expect(result.rejected[0]?.rejection_reasons).toContain('record_missing')
  })

  it('rejects a record that does not match the claimed hash', async () => {
    const body = { summary: 'Agent A read the tenant logs', ticket: 'SUP-42' }
    const record = await buildClaimRecord(11, body)

    const result = await verifyHandoffClaims(
      [{ record_hash: 'sha256:' + 'f'.repeat(64), record, body }],
      {
        trusted_creator_keys: [record.creator_key],
        require_body: true,
        require_body_commitment: true,
        now_ms: NOW_MS,
        max_age_ms: 60_000,
      },
    )

    expect(result.accepted_record_hashes).toEqual([])
    expect(result.rejected[0]?.rejection_reasons).toContain('record_hash_mismatch')
  })

  it('rejects an uncommitted body when a body commitment is required', async () => {
    const body = { summary: 'Agent A read the tenant logs', ticket: 'SUP-42' }
    const record = await buildUncommittedClaimRecord(11, body)
    const hash = recordHash(record)

    const result = await verifyHandoffClaims([{ record_hash: hash, record, body }], {
      trusted_creator_keys: [record.creator_key],
      require_body: true,
      require_body_commitment: true,
      now_ms: NOW_MS,
      max_age_ms: 60_000,
    })

    expect(result.accepted_record_hashes).toEqual([])
    expect(result.rejected[0]?.rejection_reasons).toContain('body_commitment_missing')
  })

  it('rejects malformed salted body evidence without throwing', async () => {
    const body = { summary: 'Agent A read the tenant logs', ticket: 'SUP-42' }
    const record = await buildMalformedSaltClaimRecord(11, body)
    const hash = recordHash(record)

    const result = await verifyHandoffClaims([{ record_hash: hash, record, body }], {
      trusted_creator_keys: [record.creator_key],
      require_body: true,
      require_body_commitment: true,
      now_ms: NOW_MS,
      max_age_ms: 60_000,
    })

    expect(result.accepted_record_hashes).toEqual([])
    expect(result.rejected[0]?.rejection_reasons).toContain('body_hash_mismatch')
  })

  it('rejects future-dated records when a freshness bound is supplied', async () => {
    const body = { summary: 'Agent A read the tenant logs', ticket: 'SUP-42' }
    const record = await buildFutureClaimRecord(11, body)
    const hash = recordHash(record)

    const result = await verifyHandoffClaims([{ record_hash: hash, record, body }], {
      trusted_creator_keys: [record.creator_key],
      require_body: true,
      require_body_commitment: true,
      now_ms: NOW_MS,
      max_age_ms: 60_000,
    })

    expect(result.accepted_record_hashes).toEqual([])
    expect(result.rejected[0]?.rejection_reasons).toContain('stale')
  })
})
