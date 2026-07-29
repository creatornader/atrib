// Synthesize a signed record against an explicitly selected log, then check
// its graph projection. Public atrib proof runs require a deliberate opt-in.

import * as ed from '@noble/ed25519'
import { sha256, sha512 } from '@noble/hashes/sha2.js'
import { canonicalRecord, signRecord, base64urlEncode } from '@atrib/mcp'

ed.hashes.sha512 = sha512

const logEndpoint = requireLogEndpoint()
const graphEndpoint = process.env.GRAPH_ENDPOINT?.trim() ?? 'http://127.0.0.1:8788/v1'

function requireLogEndpoint() {
  const endpoint = process.env.LOG_ENDPOINT?.trim()
  if (!endpoint) throw new Error('LOG_ENDPOINT is required. Use a local log for ordinary probes.')
  const normalized = endpoint.replace(/\/$/, '')
  if (new URL(normalized).hostname === 'log.atrib.dev' && process.env.ATRIB_PUBLIC_DEMO !== '1') {
    throw new Error('Public probe submission requires ATRIB_PUBLIC_DEMO=1 and a named persistent demo identity.')
  }
  return normalized
}

function probePrivateKey() {
  if (new URL(logEndpoint).hostname !== 'log.atrib.dev') {
    const seed = new Uint8Array(32)
    crypto.getRandomValues(seed)
    return seed
  }
  const configured = process.env.ATRIB_DEMO_PRIVATE_KEY
  const key = configured ? new Uint8Array(Buffer.from(configured, 'base64url')) : null
  if (key?.length !== 32) {
    throw new Error('Public fanout probe requires a 32-byte base64url ATRIB_DEMO_PRIVATE_KEY for its named persistent demo identity.')
  }
  return key
}

const seed = probePrivateKey()
const pubKey = await ed.getPublicKeyAsync(seed)
const creatorKey = base64urlEncode(pubKey)

// Use a fresh context_id so graph won't have it
const ctxBytes = new Uint8Array(16)
crypto.getRandomValues(ctxBytes)
const contextId = Array.from(ctxBytes, b => b.toString(16).padStart(2, '0')).join('')

// Genesis chain_root per §1.2.3
const genesisHash = sha256(new TextEncoder().encode(contextId))
const chainRoot = 'sha256:' + Array.from(genesisHash, b => b.toString(16).padStart(2, '0')).join('')

const record = await signRecord({
  spec_version: 'atrib/1.0',
  content_id: 'sha256:' + 'a'.repeat(64),
  creator_key: creatorKey,
  chain_root: chainRoot,
  event_type: 'https://atrib.dev/v1/types/tool_call',
  context_id: contextId,
  timestamp: Date.now(),
  signature: '',
}, seed)

const submit = await fetch(`${logEndpoint}/entries`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(record),
})
const proof = await submit.json()
const recordHash = 'sha256:' + Array.from(sha256(canonicalRecord(record)), b => b.toString(16).padStart(2, '0')).join('')

console.log('SUBMIT', submit.status, 'log_index', proof.log_index)
console.log('record_hash', recordHash)
console.log('context_id', contextId)
console.log('creator_key', creatorKey)

// Wait for fanout to land
await new Promise(r => setTimeout(r, 1500))

// Check graph
const g = await fetch(`${graphEndpoint}/graph/` + contextId)
console.log('GRAPH', g.status)
if (g.ok) {
  const body = await g.json()
  console.log('  nodes:', body.nodes?.length, 'edges:', body.edges?.length)
}

// Check log /v1/recent picks it up
const r = await fetch(`${logEndpoint}/recent?limit=5`)
const rb = await r.json()
const found = rb.entries.find(e => e.record_hash === recordHash)
console.log('IN /v1/recent:', !!found)
