#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0

/**
 * chain-demo.mjs, exercise §1.5 chain wiring against a deployed atrib log.
 *
 * Generates a single ephemeral Ed25519 keypair and submits a chain of N records
 * where each record's chain_root points at the prior record's record_hash. The
 * first record uses the §1.2.3 genesis derivation. All records share one
 * context_id so the chain stays within a single trace.
 *
 * Records are also appended to a local jsonl so the dogfood verifier can
 * exercise gate F (record sig replay) and chain.integrity (parent linkage).
 *
 * Why: the wrapped agent-bridge produces records, but Claude Code does not
 * propagate the atrib token between tool calls, so every record currently lands
 * with chain_root = genesis. The verifier's chain.integrity gate reports
 * "0 chained-to-parent" against that population. This script demonstrates the
 * chain primitive works when explicitly exercised.
 *
 * Usage:
 *   LOG_ENDPOINT=https://log.atrib.dev/v1 \
 *   CHAIN_LENGTH=5 \
 *   node scripts/chain-demo.mjs
 *
 * After running, point the verifier at the demo's record file:
 *   RECORD_FILE=~/.atrib/records/chain-demo-<timestamp>.jsonl \
 *   pnpm --filter @atrib/log-node verify-log
 */

import * as ed from '@noble/ed25519'
import { sha256, sha512 } from '@noble/hashes/sha2.js'
import { randomBytes } from 'node:crypto'
import { mkdirSync, appendFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import canonicalize from 'canonicalize'

ed.hashes.sha512 = sha512

const LOG_ENDPOINT = (process.env.LOG_ENDPOINT ?? 'https://log.atrib.dev/v1').replace(/\/$/, '')
const CHAIN_LENGTH = Number(process.env.CHAIN_LENGTH ?? 5)
const DEMO_SERVER_URL = process.env.DEMO_SERVER_URL ?? 'demo://chain-demo.atrib.dev'
// Comma-separated list of 0-indexed step numbers that should emit a
// transaction record (event_type URI https://atrib.dev/v1/types/transaction)
// instead of a tool_call record. Spec §1.7. The 90-byte log entry encodes
// the URI as a byte (§2.3.1): 0x01=tool_call, 0x02=transaction,
// 0x03=observation, 0xFF=extension URI in a non-atrib namespace.
const TRANSACTION_AT_STEPS = new Set(
  (process.env.TRANSACTION_AT_STEPS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number),
)
const STAMP = new Date().toISOString().replace(/[:.]/g, '-')
const RECORD_FILE = process.env.RECORD_FILE ?? join(
  homedir(), '.atrib', 'records', `chain-demo-${STAMP}.jsonl`,
)

function toHex(bytes) {
  return Buffer.from(bytes).toString('hex')
}
function b64url(bytes) {
  return Buffer.from(bytes).toString('base64url')
}
function utf8(s) {
  return new TextEncoder().encode(s)
}
function jcsBytes(obj) {
  return new TextEncoder().encode(canonicalize(obj))
}

// §1.2.2: content_id is the SHA-256 of (server_url + tool_name + args canonical),
// "sha256:" prefix. We synthesize per-step values for the demo.
function computeContentId(serverUrl, toolName) {
  return `sha256:${toHex(sha256(utf8(`${serverUrl}/${toolName}`)))}`
}

// §1.2.3: genesis chain_root = "sha256:" + hex(SHA-256(UTF-8(context_id))).
function genesisChainRoot(contextId) {
  return `sha256:${toHex(sha256(utf8(contextId)))}`
}

// §1.5.1: record_hash = SHA-256 over JCS canonical of the FULL record (with signature).
function computeRecordHash(signedRecord) {
  return toHex(sha256(jcsBytes(signedRecord)))
}

// §1.4.3: signing input is the record minus the signature field, JCS-canonical.
async function signRecord(unsigned, privateKey) {
  const { signature: _omit, ...signedFields } = unsigned
  const signingInput = jcsBytes(signedFields)
  const sigBytes = await ed.signAsync(signingInput, privateKey)
  return { ...unsigned, signature: b64url(sigBytes) }
}

async function submitRecord(record) {
  const res = await fetch(`${LOG_ENDPOINT}/entries`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(record),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`POST /v1/entries -> ${res.status}: ${body}`)
  }
  return await res.json()
}

function persist(record) {
  mkdirSync(dirname(RECORD_FILE), { recursive: true })
  appendFileSync(RECORD_FILE, JSON.stringify(record) + '\n')
}

async function main() {
  console.log(`chain-demo: log=${LOG_ENDPOINT} chain_length=${CHAIN_LENGTH}`)
  console.log(`record_file=${RECORD_FILE}`)
  console.log()

  const privateKey = ed.utils.randomSecretKey()
  const publicKeyBytes = await ed.getPublicKeyAsync(privateKey)
  const creatorKey = b64url(publicKeyBytes)
  const contextId = toHex(randomBytes(16))
  console.log(`creator_key (ephemeral): ${creatorKey}`)
  console.log(`context_id:              ${contextId}`)
  console.log()
  console.log(`step  chain_root           record_hash          log_index  tree_size`)
  console.log(`----  -------------------  -------------------  ---------  ---------`)

  let priorRecordHash = null
  for (let i = 0; i < CHAIN_LENGTH; i++) {
    const chainRoot = priorRecordHash
      ? `sha256:${priorRecordHash}`
      : genesisChainRoot(contextId)

    const eventType = TRANSACTION_AT_STEPS.has(i)
      ? 'https://atrib.dev/v1/types/transaction'
      : 'https://atrib.dev/v1/types/tool_call'
    const unsigned = {
      spec_version: 'atrib/1.0',
      content_id: computeContentId(DEMO_SERVER_URL, `step-${i}`),
      creator_key: creatorKey,
      chain_root: chainRoot,
      event_type: eventType,
      context_id: contextId,
      timestamp: Date.now(),
      signature: '',
    }

    const signed = await signRecord(unsigned, privateKey)
    const recordHash = computeRecordHash(signed)
    persist(signed)

    const proof = await submitRecord(signed)
    const treeSize = proof.checkpoint.split('\n')[1]
    const evMark =
      eventType === 'https://atrib.dev/v1/types/transaction' ? ' [tx]' : ''
    console.log(
      `[${i}]   ${chainRoot.slice(7, 23)}…  ${recordHash.slice(0, 16)}…  ${String(proof.log_index).padStart(9)}  ${String(treeSize).padStart(9)}${evMark}`,
    )

    priorRecordHash = recordHash
  }

  console.log()
  console.log(`Submitted ${CHAIN_LENGTH} records. To verify chain integrity:`)
  console.log()
  console.log(`  ATRIB_PUBLIC_KEY=${creatorKey} \\`)
  console.log(`  RECORD_FILE=${RECORD_FILE} \\`)
  console.log(`  pnpm --filter @atrib/log-node verify-log`)
  console.log()
  console.log(`Expected: chain.integrity reports "1 genesis + ${CHAIN_LENGTH - 1} chained-to-parent" for these records.`)
}

main().catch((err) => {
  console.error('chain-demo: fatal', err)
  process.exit(1)
})
