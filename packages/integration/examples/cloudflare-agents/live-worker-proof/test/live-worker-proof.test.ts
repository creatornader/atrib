// SPDX-License-Identifier: Apache-2.0

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { canonicalRecord, leafHash, type AtribRecord, type ProofBundle } from '@atrib/mcp/worker'
import {
  base64url,
  parseCheckpoint,
  parseTextContent,
  recordHash,
  verifyProof,
} from '../scripts/run-live-proof.js'

const fixtureRecord: AtribRecord = {
  spec_version: 'atrib/1.0',
  content_id: 'sha256:0a3666a0710c08aa6d0de92ce72beeb5b93124cce1bf3701c9d6cdeb543cb73e',
  creator_key: 'iojj3XQJ8ZX9UtstPLpdcspnCb8dlBIb83SIAbQPb1w',
  chain_root: 'sha256:3ba3f5f43b92602683c19aee62a20342b084dd5971ddd33808d81a328879a547',
  event_type: 'https://atrib.dev/v1/types/tool_call',
  context_id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  timestamp: 1700000000000,
  signature:
    'ZMjtGaUFxp3N4ZA2Vw05NBg8KiymOdNRL3uRB_QJ-zMK7MVOBBqtOA1xLo-DMmeLZfjWjfBFwrHtQemoxXXMBg',
}

function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

function proofForSingleRecord(record: AtribRecord): ProofBundle {
  const leaf = leafHash(canonicalRecord(record))
  return {
    log_index: 0,
    leaf_hash: b64(leaf),
    inclusion_proof: [],
    checkpoint: `atrib.dev/checkpoint/v1\n1\n${b64(leaf)}\n\nsignature`,
  }
}

describe('Cloudflare live Worker proof smoke coverage', () => {
  it('keeps record hashing and inclusion verification pinned', () => {
    expect(recordHash(fixtureRecord)).toBe(
      'sha256:ea6fb413c524ab5767520516ffb8ae38a74391f7892177e0236f5f2de523b9c1',
    )
    expect(verifyProof(proofForSingleRecord(fixtureRecord))).toBe(true)
  })

  it('parses MCP text content and checkpoint bodies defensively', () => {
    expect(parseTextContent({ content: [{ type: 'text', text: '{"ok":true}' }] })).toBe(
      '{"ok":true}',
    )
    expect(() => parseTextContent({ content: [{ type: 'image' }] })).toThrow(
      /did not contain text content/u,
    )

    const checkpoint = parseCheckpoint('atrib.dev/checkpoint/v1\n7\ncm9vdA==\n\nsignature')
    expect(checkpoint).toEqual({ treeSize: 7, rootHash: 'cm9vdA==' })
    expect(() => parseCheckpoint('bad')).toThrow(/Malformed checkpoint/u)
  })

  it('keeps local secret generation URL-safe', () => {
    expect(base64url(new Uint8Array([251, 255, 255]))).toBe('-___')
    expect(base64url(new Uint8Array([1, 2, 3, 4]))).not.toMatch(/[+/=]/u)
  })

  it('declares the executable Worker surface used by the live proof script', async () => {
    const source = await readFile(resolve('src/index.ts'), 'utf8')
    const config = JSON.parse(await readFile(resolve('wrangler.jsonc'), 'utf8')) as {
      compatibility_flags?: string[]
      durable_objects?: { bindings?: Array<{ name?: string; class_name?: string }> }
      migrations?: Array<{ new_sqlite_classes?: string[] }>
      secrets?: { required?: string[] }
      vars?: { ATRIB_LOG_ENDPOINT?: string }
    }

    expect(source).toMatch(/registerTool\(\s*'record_outcome'/u)
    expect(source).toMatch(/registerTool\(\s*'recall_outcomes'/u)
    expect(source).toMatch(/registerTool\(\s*'list_signed_records'/u)
    expect(source).toContain("ProofMcp.serve('/mcp', { binding: 'ProofMcp' })")
    expect(config.compatibility_flags).toContain('nodejs_compat')
    expect(config.durable_objects?.bindings).toContainEqual({
      name: 'ProofMcp',
      class_name: 'ProofMcp',
    })
    expect(config.migrations?.[0]?.new_sqlite_classes).toEqual(['ProofMcp'])
    expect(config.secrets?.required).toEqual(['ATRIB_PRIVATE_KEY'])
    expect(config.vars?.ATRIB_LOG_ENDPOINT).toBe('https://log.atrib.dev/v1/entries')
  })
})
