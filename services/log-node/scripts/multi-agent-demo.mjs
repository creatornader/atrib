#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0

/**
 * multi-agent-demo.mjs, exercise cross-key chain attribution.
 *
 * Two ephemeral Ed25519 keypairs (agent A and agent B) submit records to a
 * deployed atrib log. Agent A signs a 3-record chain. Agent B then signs a
 * 3-record chain whose FIRST record's chain_root points at agent A's LAST
 * record's record_hash. The result is a 6-record chain where attribution
 * crosses creator_keys without a break in the chain_root linkage.
 *
 * This demonstrates §1.5.2 chain semantics across signers and is the
 * structural prerequisite for §3.2.4 CHAIN_PRECEDES edges that span keys
 * and §4.6 calculation flowing attribution credit between agents.
 *
 * Usage:
 *   LOG_ENDPOINT=https://log.atrib.dev/v1 \
 *   PER_AGENT=3 \
 *   node scripts/multi-agent-demo.mjs
 *
 * Verify with:
 *   RECORD_FILE=<printed path> \
 *   pnpm --filter @atrib/log-node verify-log
 */

import * as ed from '@noble/ed25519'
import { sha256, sha512 } from '@noble/hashes/sha2.js'
import { randomBytes } from 'node:crypto'
import { mkdirSync, appendFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import canonicalize from 'canonicalize'

ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m))

const LOG_ENDPOINT = (process.env.LOG_ENDPOINT ?? 'https://log.atrib.dev/v1').replace(/\/$/, '')
const PER_AGENT = Number(process.env.PER_AGENT ?? 3)
const STAMP = new Date().toISOString().replace(/[:.]/g, '-')
const RECORD_FILE = process.env.RECORD_FILE ?? join(
  homedir(), '.atrib', 'records', `multi-agent-demo-${STAMP}.jsonl`,
)

const toHex = (b) => Buffer.from(b).toString('hex')
const b64url = (b) => Buffer.from(b).toString('base64url')
const utf8 = (s) => new TextEncoder().encode(s)
const jcsBytes = (o) => new TextEncoder().encode(canonicalize(o))

const computeContentId = (serverUrl, toolName) =>
  `sha256:${toHex(sha256(utf8(`${serverUrl}/${toolName}`)))}`

const genesisChainRoot = (contextId) =>
  `sha256:${toHex(sha256(utf8(contextId)))}`

const computeRecordHash = (signed) => toHex(sha256(jcsBytes(signed)))

async function signRecord(unsigned, privateKey) {
  const { signature: _omit, ...signedFields } = unsigned
  const sig = await ed.signAsync(jcsBytes(signedFields), privateKey)
  return { ...unsigned, signature: b64url(sig) }
}

async function submitRecord(record) {
  const res = await fetch(`${LOG_ENDPOINT}/entries`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(record),
  })
  if (!res.ok) throw new Error(`POST -> ${res.status}: ${await res.text()}`)
  return await res.json()
}

function persist(record) {
  mkdirSync(dirname(RECORD_FILE), { recursive: true })
  appendFileSync(RECORD_FILE, JSON.stringify(record) + '\n')
}

async function makeAgent(label) {
  const privateKey = ed.utils.randomPrivateKey()
  const publicKey = await ed.getPublicKeyAsync(privateKey)
  return { label, privateKey, publicKey, creatorKey: b64url(publicKey) }
}

async function emitRecord(
  agent,
  contextId,
  toolName,
  chainRoot,
  eventType = 'https://atrib.dev/v1/types/tool_call',
) {
  const unsigned = {
    spec_version: 'atrib/1.0',
    content_id: computeContentId('demo://multi-agent.atrib.dev', toolName),
    creator_key: agent.creatorKey,
    chain_root: chainRoot,
    event_type: eventType,
    context_id: contextId,
    timestamp: Date.now(),
    signature: '',
  }
  const signed = await signRecord(unsigned, agent.privateKey)
  const recordHash = computeRecordHash(signed)
  persist(signed)
  const proof = await submitRecord(signed)
  return { signed, recordHash, proof }
}

async function main() {
  console.log(`multi-agent-demo: log=${LOG_ENDPOINT} per_agent=${PER_AGENT}`)
  console.log(`record_file=${RECORD_FILE}`)
  console.log()

  const agentA = await makeAgent('A')
  const agentB = await makeAgent('B')
  // §1.5.5: a session_token would link cross-trace; here we keep one
  // context_id so the chain is structurally a single trace shared by A and B.
  const contextId = toHex(randomBytes(16))

  console.log(`agent A creator_key: ${agentA.creatorKey}`)
  console.log(`agent B creator_key: ${agentB.creatorKey}`)
  console.log(`shared context_id:   ${contextId}`)
  console.log()
  console.log(`step  agent  chain_root           record_hash          log_index`)
  console.log(`----  -----  -------------------  -------------------  ---------`)

  let priorRecordHash = null
  let stepIndex = 0

  // Agent B's final record is a transaction (event_type 0x02). This gives the
  // calculation algorithm (§4.6) a settlement event to attribute against,
  // and exercises §1.7 / §5.4.5 transaction emission inside a multi-agent
  // chain.
  const totalSteps = PER_AGENT * 2
  for (const agent of [agentA, agentB]) {
    for (let i = 0; i < PER_AGENT; i++) {
      const chainRoot = priorRecordHash
        ? `sha256:${priorRecordHash}`
        : genesisChainRoot(contextId)
      const toolName = `agent-${agent.label.toLowerCase()}/step-${i}`
      const isFinal = stepIndex === totalSteps - 1
      const eventType = isFinal
        ? 'https://atrib.dev/v1/types/transaction'
        : 'https://atrib.dev/v1/types/tool_call'
      const { recordHash, proof } = await emitRecord(agent, contextId, toolName, chainRoot, eventType)
      const evMark =
        eventType === 'https://atrib.dev/v1/types/transaction' ? ' [tx]' : ''
      console.log(
        `[${String(stepIndex).padStart(2)}]   ${agent.label}      ${chainRoot.slice(7, 23)}…  ${recordHash.slice(0, 16)}…  ${String(proof.log_index).padStart(9)}${evMark}`,
      )
      priorRecordHash = recordHash
      stepIndex++
    }
  }

  const total = PER_AGENT * 2
  console.log()
  console.log(`Submitted ${total} records across 2 agents. Cross-key transition is between step ${PER_AGENT - 1} and step ${PER_AGENT}.`)
  console.log()
  console.log(`To verify chain integrity (ignoring signer.attribution which expects single key):`)
  console.log()
  console.log(`  RECORD_FILE=${RECORD_FILE} \\`)
  console.log(`  pnpm --filter @atrib/log-node verify-log`)
  console.log()
  console.log(`Expected: chain.integrity reports "1 genesis + ${total - 1} chained-to-parent"`)
  console.log(`(the one cross-key link from A's last to B's first is included in chained-to-parent).`)
}

main().catch((err) => {
  console.error('multi-agent-demo: fatal', err)
  process.exit(1)
})
