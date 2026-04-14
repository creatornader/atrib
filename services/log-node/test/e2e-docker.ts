// SPDX-License-Identifier: Apache-2.0

/**
 * E2E test against a running log-node container or remote deployment.
 *
 * Usage:
 *   # Against local Docker container:
 *   docker run -d -p 3100:3100 -e ATRIB_LOG_KEY=<key> atrib-log-node
 *   npx tsx services/log-node/test/e2e-docker.ts
 *
 *   # Against live deployment:
 *   LOG_URL=https://atrib-log.fly.dev npx tsx services/log-node/test/e2e-docker.ts
 *
 * Expects a fresh (empty) log. Restart the container between runs.
 */

import { signRecord } from '../../../packages/mcp/src/signing.js'
import { hexEncode } from '../../../packages/mcp/src/hash.js'
import type { AtribRecord } from '../../../packages/mcp/src/types.js'
import { sha256 } from '@noble/hashes/sha2.js'
import * as ed from '@noble/ed25519'
import crypto from 'crypto'

const LOG_URL = process.env.LOG_URL ?? 'http://localhost:3100'

async function createSignedRecord(privateKey: Uint8Array, creatorKey: string) {
  const contextId = hexEncode(crypto.getRandomValues(new Uint8Array(16)))
  const chainRoot = `sha256:${hexEncode(sha256(new TextEncoder().encode(contextId)))}`
  const contentId = `sha256:${hexEncode(sha256(new TextEncoder().encode('e2e-test-' + Date.now())))}`

  const unsigned = {
    spec_version: 'atrib/1.0' as const,
    event_type: 'tool_call' as const,
    timestamp: Date.now(),
    context_id: contextId,
    creator_key: creatorKey,
    chain_root: chainRoot,
    content_id: contentId,
    signature: '',
  }

  return signRecord(unsigned as AtribRecord, privateKey)
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    console.error('FAIL:', message)
    process.exit(1)
  }
}

async function main() {
  console.log(`Testing against ${LOG_URL}\n`)

  const privateKey = ed.utils.randomPrivateKey()
  const publicKeyBytes = await ed.getPublicKeyAsync(privateKey)
  const creatorKey = Buffer.from(publicKeyBytes).toString('base64url')

  // Test 1: Empty checkpoint
  console.log('=== Test 1: Empty checkpoint ===')
  const cp0 = await fetch(`${LOG_URL}/v1/checkpoint`)
  console.log('Status:', cp0.status, '| Body:', await cp0.text())

  // Test 2: Submit a signed record
  console.log('\n=== Test 2: Submit signed record ===')
  const record1 = await createSignedRecord(privateKey, creatorKey)
  const res = await fetch(`${LOG_URL}/v1/entries`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(record1),
  })
  console.log('Status:', res.status)
  const body = await res.json()
  console.log('log_index:', body.log_index)
  console.log('leaf_hash present:', !!body.leaf_hash)
  console.log('checkpoint present:', !!body.checkpoint)
  console.log('inclusion_proof length:', body.inclusion_proof?.length, '(expected: 0 for first entry)')

  assert(res.status === 200, 'expected 200')
  assert(body.log_index === 0, 'expected log_index 0')
  assert(body.inclusion_proof?.length === 0, 'expected empty proof for tree size 1')
  console.log('PASS')

  // Test 3: Checkpoint after 1 entry (C2SP signed-note format)
  console.log('\n=== Test 3: Checkpoint after 1 entry ===')
  const cp1 = await fetch(`${LOG_URL}/v1/checkpoint`)
  const cpText = await cp1.text()
  console.log('Checkpoint:\n' + cpText)
  assert(cpText.includes('log.atrib'), 'checkpoint missing log.atrib origin')
  console.log('PASS')

  // Test 4: Second record, tree grows
  console.log('\n=== Test 4: Second record + tree growth ===')
  const record2 = await createSignedRecord(privateKey, creatorKey)
  const res2 = await fetch(`${LOG_URL}/v1/entries`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(record2),
  })
  const body2 = await res2.json()
  console.log('Status:', res2.status)
  console.log('log_index:', body2.log_index, '(expected: 1)')
  console.log('inclusion_proof length:', body2.inclusion_proof?.length, '(expected: 1 for tree size 2)')

  assert(body2.log_index === 1, 'expected log_index 1')
  assert(body2.inclusion_proof?.length === 1, 'expected 1 proof element')
  console.log('PASS')

  // Test 5: Duplicate submission returns same proof (idempotency)
  console.log('\n=== Test 5: Duplicate submission (idempotency) ===')
  const res3 = await fetch(`${LOG_URL}/v1/entries`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(record2),
  })
  const body3 = await res3.json()
  console.log('Status:', res3.status)
  console.log('log_index:', body3.log_index, '(expected: 1, same as before)')

  assert(body3.log_index === 1, 'duplicate should return same log_index')
  console.log('PASS')

  // Test 6: Invalid record rejected
  console.log('\n=== Test 6: Invalid record rejected ===')
  const res4 = await fetch(`${LOG_URL}/v1/entries`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ spec_version: 'wrong' }),
  })
  console.log('Status:', res4.status, '(expected: 400)')
  assert(res4.status === 400, 'expected 400')
  console.log('PASS')

  console.log('\n=== All 6 E2E tests passed ===')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
