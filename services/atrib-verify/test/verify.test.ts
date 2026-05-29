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
import { handleAtribVerify } from '../src/index.js'

ed.hashes.sha512 = sha512

const KEY = new Uint8Array(32).fill(61)
const NOW_MS = 1_780_000_000_000
const CONTEXT_ID = '7'.repeat(32)

function hashJson(value: unknown): string {
  const encoded = canonicalize(value)
  if (encoded === undefined) throw new Error('test value is not JCS-encodable')
  return `sha256:${hexEncode(sha256(new TextEncoder().encode(encoded)))}`
}

function recordHash(record: AtribRecord): string {
  return `sha256:${hexEncode(sha256(canonicalRecord(record)))}`
}

async function makeClaim(body: unknown): Promise<AtribRecord> {
  const creatorKey = base64urlEncode(await ed.getPublicKeyAsync(KEY))
  return signRecord(
    {
      spec_version: 'atrib/1.0',
      content_id: hashJson({ kind: 'verify-mcp-test' }),
      creator_key: creatorKey,
      chain_root: 'sha256:' + '6'.repeat(64),
      event_type: 'https://atrib.dev/v1/types/observation',
      context_id: CONTEXT_ID,
      timestamp: NOW_MS - 1_000,
      args_hash: hashJson(body),
      signature: '',
    } as AtribRecord,
    KEY,
  )
}

describe('atrib-verify primitive handler', () => {
  it('accepts a trusted D062 evidence packet', async () => {
    const body = { summary: 'Agent A verified the ticket state', ticket: 'SUP-77' }
    const record = await makeClaim(body)
    const hash = recordHash(record)

    const result = await handleAtribVerify({
      packet: {
        required_record_hashes: [hash],
        records: [
          {
            record,
            _local: {
              producer: 'agent-a',
              content: body,
            },
          },
        ],
      },
      trusted_creator_keys: [record.creator_key],
      allowed_context_ids: [record.context_id],
      require_body: true,
      require_body_commitment: true,
      now_ms: NOW_MS,
      max_age_ms: 60_000,
    })

    expect(result.primitive).toBe('atrib-verify')
    expect(result.accepted_record_hashes).toEqual([hash])
    expect(result.accepted[0]?.body?.args_hash_ok).toBe(true)
    expect(result.rejected).toEqual([])
  })

  it('returns rejections for missing packet material', async () => {
    const result = await handleAtribVerify({
      records: [],
      required_record_hashes: ['sha256:' + 'b'.repeat(64)],
      require_body: true,
      require_log_inclusion: true,
    })

    expect(result.accepted_record_hashes).toEqual([])
    expect(result.rejected[0]?.rejection_reasons).toContain('record_missing')
  })
})
