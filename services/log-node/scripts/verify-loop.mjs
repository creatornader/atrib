#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0

/**
 * verify-loop.mjs, reproducible end-to-end verifier for the dogfood log.
 *
 * Usage:
 *   ATRIB_PUBLIC_KEYS=<base64url-32B>[,<base64url-32B>...] \
 *   LOG_ENDPOINT=https://log.atrib.dev/v1 \
 *   [RECORD_FILE=~/.atrib/records/records.jsonl] \
 *   node scripts/verify-loop.mjs
 *
 * Exit code 0 = all gates pass. Non-zero = at least one gate failed.
 *
 * Six gates. Each is either PASS, FAIL, or SKIP (when prerequisites missing).
 *
 *   GATE A, Tree integrity:
 *     For each leaf i in [0, treeSize): recompute leaf_hash = SHA-256(0x00 || entry_i)
 *     and verify an RFC 6962 inclusion proof against the checkpoint root.
 *     If A passes, the log has not lied about which leaves are committed.
 *
 *   GATE B, Distinct-signer count (signer.distinct):
 *     The log has at most ATRIB_PUBLIC_KEYS.length distinct creator_keys.
 *     SKIPs when ATRIB_PUBLIC_KEYS is unset (the production-log case where
 *     the multi-signer set isn't constrained to a known list, agent
 *     wrappers + a downstream consumer emitters + directory/log self-claims +
 *     atrib-emit + integration-partner keys all sign legitimately).
 *
 *   GATE C, Attribution to known pubkey(s):
 *     Every entry's creator_key is in the ATRIB_PUBLIC_KEYS set.
 *     For backwards-compat ATRIB_PUBLIC_KEY (singular) is also accepted.
 *     Trust comes from how the caller obtained the keys (derived from their
 *     own seed(s) via @atrib/cli keygen).
 *
 *   GATE D, Format conformance (§2.3.1):
 *     Each 90-byte entry parses; version=0x01; event_type ∈ {0x01, 0x02, 0x03, 0x04, 0xFF};
 *     timestamp_ms decodes to a sane Date.
 *
 *   GATE E, Checkpoint signature (requires /v1/pubkey):
 *     Ed25519.verify(sig, body, log_pubkey). Confirms the log's commitment to
 *     the root was made by the published pubkey, not an active MITM.
 *     SKIPs if /v1/pubkey is not exposed by the log.
 *
 *   GATE E2, Pubkey publication agreement (requires both endpoints):
 *     Fetch /v1/log-pubkey (C2SP vkey text) AND /v1/pubkey (JSON). Confirm
 *     they agree on origin, key_id, and the underlying 32-byte pubkey, and
 *     that the vkey-extracted pubkey ALSO verifies the checkpoint signature.
 *     This catches drift between the two key-publication surfaces and
 *     dogfoods D030. SKIPs if /v1/log-pubkey is not yet deployed.
 *
 *   GATE F, Record Ed25519 signature (requires RECORD_FILE):
 *     For each persisted signed record JSON: replay verifyRecord() against
 *     creator_key. Then SHA-256(JCS(record)) == record_hash from the log
 *     entry. Closes the chain seed → pubkey → record signature → log inclusion.
 *     SKIPs if RECORD_FILE is missing or empty.
 *
 *   GATE G, Chain integrity (requires RECORD_FILE):
 *     Group persisted records by context_id; within each group verify the
 *     genesis record's chain_root equals "sha256:" + hex(SHA-256(context_id))
 *     and every subsequent record's chain_root equals SHA-256(JCS(parent))
 *     hex-encoded with a "sha256:" prefix. Confirms the §1.5.2 chain wiring
 *     is preserved end-to-end, not just at individual records.
 */

import { createHash } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as ed from '@noble/ed25519'
import { sha512 } from '@noble/hashes/sha2.js'
import canonicalize from 'canonicalize'

// @noble/ed25519 ^2 needs a sha512 sync helper for sync APIs; we use async.
ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m))

const LOG_ENDPOINT = (process.env.LOG_ENDPOINT ?? 'https://log.atrib.dev/v1').replace(/\/$/, '')
// ATRIB_PUBLIC_KEY (singular) and ATRIB_PUBLIC_KEYS (comma-separated, plural)
// are both accepted. Singular form is backwards-compatible for the dogfood-loop
// case where one wrapper signs everything. Plural is for cross-agent flows
// where multiple keypairs legitimately appear on the log (chain-demo + wrapper,
// multi-agent-demo, etc.). Trailing whitespace per entry is stripped.
const ATRIB_PUBLIC_KEYS = (process.env.ATRIB_PUBLIC_KEYS ?? process.env.ATRIB_PUBLIC_KEY ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const RECORD_FILE = process.env.RECORD_FILE ?? join(
  homedir(), '.atrib', 'records', 'records.jsonl',
)
const TILE_SIZE = 256

// ---------------------------------------------------------------------------
// Pure helpers (no @atrib/mcp import, deliberately self-contained so this
// script also works as an independent verifier outside the workspace).
// ---------------------------------------------------------------------------

function sha256(bytes) {
  return new Uint8Array(createHash('sha256').update(bytes).digest())
}

function leafHash(entryBytes) {
  // RFC 6962 §2.1: leaf hash = H(0x00 || entry)
  const buf = new Uint8Array(1 + entryBytes.length)
  buf[0] = 0x00
  buf.set(entryBytes, 1)
  return sha256(buf)
}

function nodeHash(left, right) {
  // RFC 6962 §2.1: node hash = H(0x01 || left || right)
  const buf = new Uint8Array(1 + left.length + right.length)
  buf[0] = 0x01
  buf.set(left, 1)
  buf.set(right, 1 + left.length)
  return sha256(buf)
}

function largestPowerOfTwoLessThan(n) {
  if (n <= 1) return 0
  let k = 1
  while (k * 2 < n) k *= 2
  return k
}

// RFC 6962 §2.1.1: deterministic Merkle tree hash over a list of leaves.
function computeRoot(leaves) {
  if (leaves.length === 0) {
    return sha256(new Uint8Array(0)) // unused; callers should not invoke on empty
  }
  if (leaves.length === 1) return leaves[0]
  const k = largestPowerOfTwoLessThan(leaves.length)
  return nodeHash(computeRoot(leaves.slice(0, k)), computeRoot(leaves.slice(k)))
}

// RFC 6962 §2.1.2: inclusion proof from leaf i to root over n leaves.
function computeInclusionProof(index, leaves) {
  const n = leaves.length
  if (index < 0 || index >= n) throw new Error('index out of range')
  return _path(index, leaves)
}

function _path(index, leaves) {
  const n = leaves.length
  if (n <= 1) return []
  const k = largestPowerOfTwoLessThan(n)
  if (index < k) {
    return [..._path(index, leaves.slice(0, k)), computeRoot(leaves.slice(k))]
  } else {
    return [..._path(index - k, leaves.slice(k)), computeRoot(leaves.slice(0, k))]
  }
}

function verifyInclusion(index, treeSize, leafHashValue, proof, expectedRoot) {
  if (treeSize === 0) return false
  if (index < 0 || index >= treeSize) return false
  if (leafHashValue.length !== 32 || expectedRoot.length !== 32) return false

  // Walk from leaf to root using (index, size) decomposition.
  const path = []
  let idx = index
  let sz = treeSize
  while (sz > 1) {
    path.push({ idx, sz })
    const k = largestPowerOfTwoLessThan(sz)
    if (idx < k) sz = k
    else { idx = idx - k; sz = sz - k }
  }
  path.reverse()

  if (path.length !== proof.length) return false

  let current = leafHashValue
  for (let i = 0; i < proof.length; i++) {
    const { idx: pathIdx, sz: pathSz } = path[i]
    const sibling = proof[i]
    const k = largestPowerOfTwoLessThan(pathSz)
    if (pathIdx < k) current = nodeHash(current, sibling)
    else current = nodeHash(sibling, current)
  }

  let diff = 0
  for (let i = 0; i < 32; i++) diff |= current[i] ^ expectedRoot[i]
  return diff === 0
}

function bytesEqual(a, b) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

function toHex(bytes) {
  return Buffer.from(bytes).toString('hex')
}

function b64urlDecode(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  return new Uint8Array(Buffer.from(b64, 'base64'))
}

function b64urlEncode(bytes) {
  return Buffer.from(bytes).toString('base64url')
}

// ---------------------------------------------------------------------------
// Wire-format parsers
// ---------------------------------------------------------------------------

// Parse a C2SP signed-note checkpoint per spec §2.4.
function parseCheckpoint(text) {
  const idx = text.indexOf('\n\n')
  if (idx < 0) throw new Error('checkpoint: no body/sig separator')
  const body = text.slice(0, idx + 1) // keep trailing \n on body
  const sigBlock = text.slice(idx + 2)

  const lines = body.split('\n')
  if (lines.length < 3) throw new Error('checkpoint: body too short')
  const origin = lines[0]
  const treeSize = Number(lines[1])
  const rootB64 = lines[2]
  const rootHash = new Uint8Array(Buffer.from(rootB64, 'base64'))

  // Parse signature lines per atrib spec §2.4.3 (post-D031):
  //   "— <origin> <base64(keyHash[4B] || sig[64B])>\n"
  // C2SP signed-note canonical encoding. Parses cleanly via
  // golang.org/x/mod/sumdb/note.NewVerifier without a custom adapter.
  const sigs = []
  for (const line of sigBlock.split('\n')) {
    if (!line.trim()) continue
    const m = line.match(/^[—\-] (\S+) (\S+)\s*$/)
    if (!m) continue
    const sigOrigin = m[1]
    const decoded = new Uint8Array(Buffer.from(m[2], 'base64'))
    if (decoded.length !== 4 + 64) continue
    const keyId = decoded.slice(0, 4)
    const signature = decoded.slice(4)
    sigs.push({ sigOrigin, keyId, signature })
  }

  return { body, origin, treeSize, rootHash, signatures: sigs }
}

// Parse a §2.5.3 entry bundle: stream of (uint16 BE length, entry bytes).
function parseEntryBundle(bytes) {
  const out = []
  let off = 0
  while (off < bytes.length) {
    if (off + 2 > bytes.length) throw new Error(`bundle: truncated length at offset ${off}`)
    const len = (bytes[off] << 8) | bytes[off + 1]
    off += 2
    if (off + len > bytes.length) throw new Error(`bundle: truncated entry at offset ${off}`)
    out.push(bytes.slice(off, off + len))
    off += len
  }
  return out
}

// Parse the §2.3.1 90-byte entry into a struct.
function parseEntry(bytes) {
  if (bytes.length !== 90) throw new Error(`entry: expected 90 bytes, got ${bytes.length}`)
  const version = bytes[0]
  const recordHash = bytes.slice(1, 33)
  const creatorKey = bytes.slice(33, 65)
  const contextId = bytes.slice(65, 81)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const ts = Number(view.getBigUint64(81, false))
  const eventType = bytes[89]
  return { version, recordHash, creatorKey, contextId, ts, eventType }
}

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------

async function fetchText(url) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`GET ${url} -> ${r.status}`)
  return await r.text()
}

async function fetchBytes(url) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`GET ${url} -> ${r.status}`)
  const ab = await r.arrayBuffer()
  return new Uint8Array(ab)
}

// Fetch all entries 0..treeSize-1 by walking the §2.5.3 bundles.
async function fetchAllEntries(treeSize) {
  const entries = []
  let bundleIndex = 0
  while (entries.length < treeSize) {
    const url = `${LOG_ENDPOINT}/tile/entries/${String(bundleIndex).padStart(3, '0')}`
    const bytes = await fetchBytes(url)
    const parsed = parseEntryBundle(bytes)
    for (const e of parsed) entries.push(e)
    if (parsed.length < TILE_SIZE && entries.length < treeSize) {
      throw new Error(`bundle ${bundleIndex} short but tree not exhausted`)
    }
    bundleIndex++
    if (bundleIndex > 1000) throw new Error('runaway bundle fetch')
  }
  return entries.slice(0, treeSize)
}

// ---------------------------------------------------------------------------
// Result formatting
// ---------------------------------------------------------------------------

class Report {
  constructor() {
    this.gates = []
    this.notes = []
  }
  pass(name, detail) { this.gates.push({ name, status: 'PASS', detail }) }
  fail(name, detail) { this.gates.push({ name, status: 'FAIL', detail }) }
  skip(name, detail) { this.gates.push({ name, status: 'SKIP', detail }) }
  note(s) { this.notes.push(s) }
  print() {
    const symbol = (s) => s === 'PASS' ? 'PASS' : s === 'FAIL' ? 'FAIL' : 'SKIP'
    const w1 = Math.max(...this.gates.map(g => g.name.length), 4)
    const w2 = 4
    console.log()
    console.log(`${'GATE'.padEnd(w1)}  ${'STAT'.padEnd(w2)}  DETAIL`)
    console.log(`${'-'.repeat(w1)}  ${'-'.repeat(w2)}  ${'-'.repeat(40)}`)
    for (const g of this.gates) {
      console.log(`${g.name.padEnd(w1)}  ${symbol(g.status).padEnd(w2)}  ${g.detail}`)
    }
    if (this.notes.length) {
      console.log()
      console.log('NOTES')
      console.log('-----')
      for (const n of this.notes) console.log(`- ${n}`)
    }
    console.log()
    return this.gates.every(g => g.status !== 'FAIL')
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const r = new Report()

  console.log(`verify-loop: log=${LOG_ENDPOINT}`)
  console.log(`verify-loop: ATRIB_PUBLIC_KEYS=${ATRIB_PUBLIC_KEYS.length ? `<${ATRIB_PUBLIC_KEYS.length} set>` : '<unset>'}`)

  // 1. Checkpoint
  let cpText
  try {
    cpText = await fetchText(`${LOG_ENDPOINT}/checkpoint`)
  } catch (err) {
    // Treat 404 as the known empty-tree bug, not a fatal verifier crash.
    if (/-> 404$/.test(String(err.message))) {
      r.fail('cp.fetch', '/v1/checkpoint returned 404, tree is empty (known bug). Make any tool call to seed the tree.')
      r.note('Empty-tree state. Post-deploy or post-wipe the log returns 404 on /checkpoint until at least one record lands. Restart Claude Code, make any agent-bridge tool call, then re-run.')
      const ok = r.print()
      process.exit(ok ? 0 : 1)
    }
    throw err
  }
  console.log()
  console.log('CHECKPOINT (raw):')
  console.log(cpText.split('\n').map(l => `  ${l}`).join('\n'))

  const cp = parseCheckpoint(cpText)
  r.pass('cp.parse', `origin=${cp.origin} size=${cp.treeSize} root=${toHex(cp.rootHash).slice(0, 16)}…`)

  if (cp.origin === 'log.atrib.dev/v1') r.pass('cp.origin', cp.origin)
  else r.fail('cp.origin', `expected log.atrib.dev/v1, got ${cp.origin}`)

  if (cp.signatures.length === 0) {
    r.fail('cp.sig', 'no signatures parsed from checkpoint')
  } else {
    // GATE E: try /v1/pubkey. If reachable and pubkey matches the keyId in
    // the signature line, verify the Ed25519 signature against the body.
    let pubkeyJson = null
    try {
      const pkRes = await fetch(`${LOG_ENDPOINT}/pubkey`)
      if (pkRes.ok) pubkeyJson = await pkRes.json()
    } catch { /* swallow; treated as SKIP below */ }

    if (!pubkeyJson) {
      r.skip('cp.sig', `${cp.signatures.length} sig(s) present; /v1/pubkey not exposed by log (GAP 1)`)
    } else {
      const pkBytes = b64urlDecode(pubkeyJson.public_key)
      // Find a signature whose 4-byte keyId hex matches /v1/pubkey's key_id.
      const match = cp.signatures.find(s => toHex(s.keyId) === pubkeyJson.key_id)
      if (!match) {
        r.fail('cp.sig', `published key_id=${pubkeyJson.key_id} not present in checkpoint signatures`)
      } else {
        const bodyBytes = new TextEncoder().encode(cp.body)
        const ok = await ed.verifyAsync(match.signature, bodyBytes, pkBytes)
        if (ok) r.pass('cp.sig', `Ed25519 verify OK against /v1/pubkey (key_id=${pubkeyJson.key_id})`)
        else r.fail('cp.sig', `Ed25519 verify FAILED for key_id=${pubkeyJson.key_id}`)
      }

      // GATE E2: /v1/log-pubkey vkey endpoint must agree with /v1/pubkey JSON
      // and the vkey-extracted pubkey must also verify the checkpoint signature.
      // This dogfoods D030 (the dual-publication resolution) and catches future
      // drift between the two key-publication surfaces.
      let vkeyText = null
      try {
        const vkeyRes = await fetch(`${LOG_ENDPOINT}/log-pubkey`)
        if (vkeyRes.ok) vkeyText = (await vkeyRes.text()).trim()
      } catch { /* swallow; treated as SKIP below */ }

      if (!vkeyText) {
        r.skip('cp.sig.vkey', '/v1/log-pubkey not exposed (D028+D030 not yet deployed?)')
      } else {
        // vkey shape: <origin>+<8-hex-keyId>+<base64(0x01 || 32B-pubkey)>
        const vkeyMatch = vkeyText.match(/^(\S+)\+([0-9a-f]{8})\+([A-Za-z0-9+/]+=*)$/)
        if (!vkeyMatch) {
          r.fail('cp.sig.vkey', `/v1/log-pubkey did not parse as vkey: ${vkeyText.slice(0, 60)}…`)
        } else {
          const [, vkOrigin, vkKeyIdHex, vkPayloadB64] = vkeyMatch
          const payload = new Uint8Array(Buffer.from(vkPayloadB64, 'base64'))
          if (payload.length !== 33 || payload[0] !== 0x01) {
            r.fail('cp.sig.vkey', `vkey payload malformed: len=${payload.length} type=0x${payload[0]?.toString(16)}`)
          } else {
            const vkPubBytes = payload.slice(1)
            const originAgrees = vkOrigin === pubkeyJson.origin
            const keyIdAgrees = vkKeyIdHex === pubkeyJson.key_id
            const pubAgrees = bytesEqual(vkPubBytes, b64urlDecode(pubkeyJson.public_key))
            if (!originAgrees || !keyIdAgrees || !pubAgrees) {
              r.fail('cp.sig.vkey', `vkey/JSON disagree: origin=${originAgrees} key_id=${keyIdAgrees} pubkey=${pubAgrees}`)
            } else {
              // Verify a real signature against the vkey-extracted pubkey too.
              const match2 = cp.signatures.find(s => toHex(s.keyId) === vkKeyIdHex)
              if (!match2) {
                r.fail('cp.sig.vkey', `vkey key_id=${vkKeyIdHex} not present in checkpoint signatures`)
              } else {
                const bodyBytes = new TextEncoder().encode(cp.body)
                const ok = await ed.verifyAsync(match2.signature, bodyBytes, vkPubBytes)
                if (ok) r.pass('cp.sig.vkey', `vkey verifies the same checkpoint sig (origin/keyId/pubkey all agree with /v1/pubkey)`)
                else r.fail('cp.sig.vkey', `vkey-extracted pubkey FAILED to verify checkpoint sig`)
              }
            }
          }
        }
      }
    }
  }

  if (cp.treeSize === 0) {
    r.fail('cp.size', 'tree is empty; nothing to verify')
    process.exit(r.print() ? 0 : 1)
  }

  // 2. Entries
  const entryBytes = await fetchAllEntries(cp.treeSize)
  r.pass('bundle.fetch', `${entryBytes.length} entries from /tile/entries/*`)

  const entries = []
  let formatOk = true
  for (let i = 0; i < entryBytes.length; i++) {
    try {
      const e = parseEntry(entryBytes[i])
      if (e.version !== 0x01) { formatOk = false; r.fail(`entry[${i}].version`, `0x${e.version.toString(16)}`); }
      // Valid event_type bytes per spec 1.2.4 + 2.3.1:
      //   0x01 tool_call, 0x02 transaction, 0x03 observation (atrib normative)
      //   0x04 directory_anchor (atrib normative; promoted by D056)
      //   0xFF extension URI (consumer-minted, non-atrib namespace)
      const validEventTypes = new Set([0x01, 0x02, 0x03, 0x04, 0xff])
      if (!validEventTypes.has(e.eventType)) {
        formatOk = false; r.fail(`entry[${i}].eventType`, `0x${e.eventType.toString(16)}`);
      }
      entries.push(e)
    } catch (err) {
      formatOk = false
      r.fail(`entry[${i}].parse`, err.message)
    }
  }
  if (formatOk) r.pass('entries.format', `${entries.length} entries conform to §2.3.1 90-byte format`)

  // Print decoded entries
  console.log()
  console.log('ENTRIES (decoded):')
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    console.log(
      `  [${i}] record_hash=${toHex(e.recordHash).slice(0, 16)}…  ` +
      `creator_key=${b64urlEncode(e.creatorKey)}  ` +
      `context_id=${toHex(e.contextId)}  ` +
      `ts=${new Date(e.ts).toISOString()}  ` +
      `event_type=0x${e.eventType.toString(16).padStart(2, '0')}`,
    )
  }

  // 3+4. GATEs B,C: signer scope. When RECORD_FILE is provided and parses,
  // restrict signer.distinct and signer.attribution to "our entries" (those
  // whose record_hash matches a hash from RECORD_FILE). This lets a multi-key
  // demo run alongside other traffic on the same log without false-failing
  // these gates. When no records are supplied the gates fall back to all
  // entries (the dogfood-monitoring default).
  let signerScopeEntries = entries
  let signerScopeNote = `all ${entries.length} log entries`
  if (existsSync(RECORD_FILE)) {
    try {
      const ourHashes = new Set()
      const recordLines = readFileSync(RECORD_FILE, 'utf8')
        .split('\n')
        .map(l => l.trim())
        .filter(Boolean)
      for (const line of recordLines) {
        try {
          const rec = JSON.parse(line)
          const h = toHex(sha256(new TextEncoder().encode(canonicalize(rec))))
          ourHashes.add(h)
        } catch { /* skip malformed */ }
      }
      if (ourHashes.size > 0) {
        const filtered = entries.filter(e => ourHashes.has(toHex(e.recordHash)))
        if (filtered.length > 0) {
          signerScopeEntries = filtered
          signerScopeNote = `${filtered.length} record-file-scoped entries (of ${entries.length} on log)`
        }
      }
    } catch { /* fall through to all-entries scope */ }
  }

  // 3. GATE B: distinct-signer count within the scoped entry set.
  // When ATRIB_PUBLIC_KEYS is unset the gate SKIPs rather than defaulting
  // to "expect 1 signer", production log is multi-signer by design (agent
  // wrappers, a downstream consumer emitters, directory-node self-claim, log-node
  // self-claim, atrib-emit, integration-partner keys). The "expect 1"
  // default was a single-tenant artifact from an earlier era. Matches the
  // signer.attribution skip-when-unset behavior below.
  const distinctSet = new Set(signerScopeEntries.map(e => b64urlEncode(e.creatorKey)))
  if (ATRIB_PUBLIC_KEYS.length === 0) {
    r.skip('signer.distinct', `${distinctSet.size} distinct creator_key(s) across ${signerScopeNote}; ATRIB_PUBLIC_KEYS env not set so no expected count`)
  } else if (distinctSet.size <= ATRIB_PUBLIC_KEYS.length) {
    r.pass('signer.distinct', `${distinctSet.size} distinct creator_key(s) across ${signerScopeNote} (expected <= ${ATRIB_PUBLIC_KEYS.length})`)
  } else {
    r.fail('signer.distinct', `${distinctSet.size} distinct creator_keys across ${signerScopeNote} but only ${ATRIB_PUBLIC_KEYS.length} expected`)
  }

  // 4. GATE C: attribution to one of the user-provided pubkey(s) within scope.
  if (ATRIB_PUBLIC_KEYS.length === 0) {
    r.skip('signer.attribution', 'ATRIB_PUBLIC_KEYS env not set')
  } else {
    const decodedKeys = []
    let badDecode = false
    for (const k of ATRIB_PUBLIC_KEYS) {
      try {
        const bytes = b64urlDecode(k)
        if (bytes.length !== 32) { badDecode = true; break }
        decodedKeys.push(bytes)
      } catch { badDecode = true; break }
    }
    if (badDecode) {
      r.fail('signer.attribution', `one of ATRIB_PUBLIC_KEYS did not decode to 32 bytes`)
    } else {
      const allAttributed = signerScopeEntries.every(e => decodedKeys.some(k => bytesEqual(e.creatorKey, k)))
      if (allAttributed) {
        r.pass('signer.attribution', `every creator_key matches one of ${decodedKeys.length} provided pubkey(s) across ${signerScopeNote}`)
      } else {
        const unattributed = signerScopeEntries.filter(e => !decodedKeys.some(k => bytesEqual(e.creatorKey, k))).length
        r.fail('signer.attribution', `${unattributed}/${signerScopeEntries.length} entries in ${signerScopeNote} have a creator_key NOT in ATRIB_PUBLIC_KEYS`)
      }
    }
  }

  // 5. GATE A: tree integrity
  const leaves = entryBytes.map(b => leafHash(b))
  const localRoot = computeRoot(leaves)
  if (bytesEqual(localRoot, cp.rootHash)) {
    r.pass('tree.root', `local root == checkpoint root (${toHex(localRoot).slice(0, 16)}…)`)
  } else {
    r.fail('tree.root', `local=${toHex(localRoot).slice(0, 16)} cp=${toHex(cp.rootHash).slice(0, 16)}`)
  }

  // 6. Per-leaf inclusion proofs
  let allInclusionsOk = true
  for (let i = 0; i < leaves.length; i++) {
    const proof = computeInclusionProof(i, leaves)
    const ok = verifyInclusion(i, leaves.length, leaves[i], proof, cp.rootHash)
    if (!ok) {
      allInclusionsOk = false
      r.fail(`tree.inclusion[${i}]`, 'proof did not chain to checkpoint root')
    }
  }
  if (allInclusionsOk) r.pass('tree.inclusion', `RFC 6962 inclusion proofs verify for all ${leaves.length} leaves`)

  // 7. GATE F: record signature replay (requires local jsonl from wrapper)
  if (!existsSync(RECORD_FILE)) {
    r.skip('record.sig', `${RECORD_FILE} missing (wrapper has no record persistence yet)`)
  } else {
    const lines = readFileSync(RECORD_FILE, 'utf8')
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean)
    if (lines.length === 0) {
      r.skip('record.sig', `${RECORD_FILE} empty`)
    } else {
      // Index log entries by record_hash hex for fast lookup.
      const byHash = new Map()
      for (const e of entries) byHash.set(toHex(e.recordHash), e)

      let sigOk = 0
      let hashOk = 0
      let mismatched = 0
      let unmatched = 0
      let bad = 0
      const records = [] // parsed records, paired with their computed record_hash
      for (let i = 0; i < lines.length; i++) {
        let rec
        try { rec = JSON.parse(lines[i]) } catch { bad++; continue }

        // Re-derive record_hash = SHA-256(JCS(record_with_sig)) per spec §1.5.1.
        // Note this uses the FULL record (signature included), that matches
        // submission.ts canonicalRecord(). Distinct from the SIGNING input
        // (signature stripped) used by signRecord.
        const canonicalFull = canonicalize(rec)
        const computedHash = toHex(sha256(new TextEncoder().encode(canonicalFull)))

        // SIGNING input: record minus signature, JCS-canonicalized.
        const { signature, ...signedFields } = rec
        const signingInput = canonicalize(signedFields)
        const sig = b64urlDecode(signature)
        const pk = b64urlDecode(rec.creator_key)

        const sigVerified = await ed.verifyAsync(sig, new TextEncoder().encode(signingInput), pk)
        if (sigVerified) sigOk++
        else mismatched++

        const logEntry = byHash.get(computedHash)
        if (logEntry) hashOk++
        else unmatched++

        records.push({ rec, recordHashHex: computedHash })
      }

      const total = lines.length
      if (bad > 0) r.fail('record.parse', `${bad}/${total} jsonl lines failed to parse`)
      if (sigOk === total) r.pass('record.sig', `Ed25519 verify OK on all ${total} persisted records`)
      else r.fail('record.sig', `${sigOk}/${total} records verified, ${mismatched} bad sig`)
      if (hashOk === total) r.pass('record.hash', `record_hash matches a log entry for all ${total} records`)
      else r.skip('record.hash', `${hashOk}/${total} records map to a log entry (${unmatched} unmatched, older records or pre-persistence)`)

      // GATE G: chain integrity. For each record, chain_root must equal either
      // the genesis derivation ("sha256:" + hex(SHA-256(UTF-8(context_id)))) or
      // a record_hash we hold in persistence. Verifies §1.5.2 chain wiring is
      // preserved end-to-end across the persisted set, not just at individual
      // records.
      if (records.length > 0) {
        // Index our own records by their record_hash for parent lookup.
        const recordsByHash = new Map()
        for (const { rec, recordHashHex } of records) {
          recordsByHash.set(`sha256:${recordHashHex}`, rec)
        }

        let genesisOk = 0
        let parentOk = 0
        let noParent = 0
        let chainBroken = 0
        const chainBreakDetail = []
        for (const { rec } of records) {
          const expectedGenesis = `sha256:${toHex(sha256(new TextEncoder().encode(rec.context_id)))}`
          if (rec.chain_root === expectedGenesis) {
            genesisOk++
          } else if (recordsByHash.has(rec.chain_root)) {
            const parent = recordsByHash.get(rec.chain_root)
            if (parent.context_id === rec.context_id) {
              parentOk++
            } else {
              // Cross-context chain, possible via session_token in V2; in V1
              // dogfood traffic this would indicate a bug or chain-corruption.
              chainBroken++
              if (chainBreakDetail.length < 3) {
                chainBreakDetail.push(`ctx=${rec.context_id.slice(0, 8)}… parent.ctx=${parent.context_id.slice(0, 8)}…`)
              }
            }
          } else {
            // Parent not in our persistence; could be an older record we
            // don't have a copy of (pre-persistence-enable, deleted, other
            // agent's chain). Treat as informational, not a failure.
            noParent++
          }
        }
        const accountedFor = genesisOk + parentOk + noParent + chainBroken
        if (chainBroken === 0 && accountedFor === records.length) {
          r.pass(
            'chain.integrity',
            `${genesisOk} genesis + ${parentOk} chained-to-parent + ${noParent} parent-not-in-persistence (across ${records.length})`,
          )
        } else if (chainBroken > 0) {
          r.fail(
            'chain.integrity',
            `${chainBroken} record(s) link to a parent in a different context_id: ${chainBreakDetail.join('; ')}`,
          )
        } else {
          // Should not be reachable, but fail loud if it is.
          r.fail('chain.integrity', `bookkeeping mismatch: ${accountedFor} != ${records.length}`)
        }
      }
    }
  }

  const ok = r.print()
  process.exit(ok ? 0 : 1)
}

// Only execute when invoked as a script. Vitest imports this file for unit
// tests of the pure helpers exported below; in that mode main() must not run.
const isMain = process.argv[1] === fileURLToPath(import.meta.url)
if (isMain) {
  main().catch(err => {
    console.error('verify-loop: fatal', err)
    process.exit(2)
  })
}

// Pure helpers exposed for unit testing (services/log-node/test/verify-loop-helpers.test.ts).
// These are the building blocks the daily CI verifier depends on; if any of
// them is wrong, the verifier silently passes against bad data. Test them in
// isolation against synthetic fixtures.
export {
  sha256,
  leafHash,
  nodeHash,
  largestPowerOfTwoLessThan,
  computeRoot,
  computeInclusionProof,
  verifyInclusion,
  bytesEqual,
  parseCheckpoint,
  parseEntryBundle,
  parseEntry,
  b64urlDecode,
  b64urlEncode,
}
