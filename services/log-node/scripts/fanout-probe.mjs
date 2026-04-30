// Synthesize a signed record, submit to log.atrib.dev, then check
// graph.atrib.dev. Also assert the dashboard's session view will work.

import * as ed from '@noble/ed25519'
import { sha256, sha512 } from '@noble/hashes/sha2.js'
import { canonicalRecord, signRecord, base64urlEncode } from '@atrib/mcp'

ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m))

const seed = new Uint8Array(32)
crypto.getRandomValues(seed)
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

const submit = await fetch('https://log.atrib.dev/v1/entries', {
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
const g = await fetch('https://graph.atrib.dev/v1/graph/' + contextId)
console.log('GRAPH', g.status)
if (g.ok) {
  const body = await g.json()
  console.log('  nodes:', body.nodes?.length, 'edges:', body.edges?.length)
}

// Check log /v1/recent picks it up
const r = await fetch('https://log.atrib.dev/v1/recent?limit=5')
const rb = await r.json()
const found = rb.entries.find(e => e.record_hash === recordHash)
console.log('IN /v1/recent:', !!found)
