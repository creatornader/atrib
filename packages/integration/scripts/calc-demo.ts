// SPDX-License-Identifier: Apache-2.0

/**
 * calc-demo.ts, exercise the §4.6 calculation algorithm on a real chain.
 *
 * Reads signed records from a jsonl file (defaults to the most recent
 * multi-agent-demo run), groups them by context_id, builds a graph per the
 * §3.2.4 derivation rules, applies the default policy, and runs
 * @atrib/verify's `calculate(graph, policy)`. Asserts determinism by running
 * the calculation twice and checking bit-for-bit equality of the output.
 *
 * Usage:
 *   RECORD_FILE=~/.atrib/records/multi-agent-demo-<stamp>.jsonl \
 *   tsx packages/integration/scripts/calc-demo.ts
 *
 * If RECORD_FILE is not set, picks the most-recently-modified file in
 * ~/.atrib/records/ that begins with "multi-agent-demo-".
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import * as ed from '@noble/ed25519'
import { sha256, sha512 } from '@noble/hashes/sha2.js'
import type { AtribRecord } from '@atrib/mcp'
import { buildGraphFromRecords, recordHashHex } from '../src/graph-builder.js'
import {
  calculate,
  DEFAULT_POLICY,
  signRecommendation,
  verifyRecommendationSignature,
  distributionsMatch,
  type RecommendationDocument,
} from '@atrib/verify'

ed.etc.sha512Sync = (...m: Uint8Array[]) => sha512(ed.etc.concatBytes(...m))

function pickMostRecentRecordFile(): string {
  const dir = join(homedir(), '.atrib', 'records')
  if (!existsSync(dir)) {
    throw new Error(`record dir missing: ${dir}`)
  }
  const candidates = readdirSync(dir)
    .filter((n) => n.startsWith('multi-agent-demo-') && n.endsWith('.jsonl'))
    .map((n) => ({ name: n, path: join(dir, n), mtime: statSync(join(dir, n)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
  if (candidates.length === 0) {
    throw new Error(`no multi-agent-demo-*.jsonl files in ${dir}; run multi-agent-demo first`)
  }
  return candidates[0]!.path
}

function loadRecords(path: string): AtribRecord[] {
  const text = readFileSync(path, 'utf8')
  const records: AtribRecord[] = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    records.push(JSON.parse(trimmed) as AtribRecord)
  }
  return records
}

function distributionsEqual(a: Record<string, number>, b: Record<string, number>): boolean {
  const aKeys = Object.keys(a).sort()
  const bKeys = Object.keys(b).sort()
  if (aKeys.length !== bKeys.length) return false
  for (let i = 0; i < aKeys.length; i++) {
    if (aKeys[i] !== bKeys[i]) return false
    if (a[aKeys[i]!] !== b[bKeys[i]!]) return false
  }
  return true
}

async function main(): Promise<void> {
  const recordFile = process.env.RECORD_FILE ?? pickMostRecentRecordFile()
  console.log(`calc-demo: record_file=${recordFile}`)

  const records = loadRecords(recordFile)
  console.log(`calc-demo: loaded ${records.length} records`)

  // Group by context_id and pick the group containing a transaction record.
  // The §4.6 calculation is anchored on a transaction; a chain with only
  // tool_call records has nothing to settle.
  const byContextId = new Map<string, AtribRecord[]>()
  for (const r of records) {
    if (!byContextId.has(r.context_id)) byContextId.set(r.context_id, [])
    byContextId.get(r.context_id)!.push(r)
  }

  const txGroups = [...byContextId.entries()].filter(([, recs]) =>
    recs.some((r) => r.event_type === 'transaction'),
  )
  if (txGroups.length === 0) {
    console.error('calc-demo: no context_id contains a transaction record. Run multi-agent-demo to produce a chain that ends in a transaction.')
    process.exit(1)
  }

  const [contextId, sessionRecords] = txGroups[0]!
  console.log(`calc-demo: context_id=${contextId} session_records=${sessionRecords.length}`)
  console.log()

  const graph = buildGraphFromRecords(sessionRecords, contextId)
  console.log(`graph: ${graph.nodes.length} nodes, ${graph.edges.length} edges`)
  for (const e of graph.edges) {
    const fromShort = e.source.slice(0, 8)
    const toShort = e.target.slice(0, 8)
    console.log(`  ${e.type.padEnd(18)}  ${fromShort}…  →  ${toShort}…`)
  }
  console.log()

  console.log(`policy: applying DEFAULT_POLICY (spec §4.3)`)
  const dist1 = calculate(graph, DEFAULT_POLICY)
  console.log(`distribution (run 1):`)
  for (const [creatorKey, share] of Object.entries(dist1).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${creatorKey}  ${(share * 100).toFixed(2)}%`)
  }
  console.log()

  // §4.6 INVARIANT: deterministic. Run twice; assert identical output.
  const dist2 = calculate(graph, DEFAULT_POLICY)
  if (distributionsEqual(dist1, dist2)) {
    console.log(`determinism: PASS, two runs produced identical distribution`)
  } else {
    console.error(`determinism: FAIL`)
    console.error(`run 1: ${JSON.stringify(dist1)}`)
    console.error(`run 2: ${JSON.stringify(dist2)}`)
    process.exit(1)
  }

  // Sanity: shares should sum to ~1.0 (modulo floating point).
  const total = Object.values(dist1).reduce((s, v) => s + v, 0)
  const sumOk = Math.abs(total - 1) < 1e-9
  console.log(`sum-to-one: ${sumOk ? 'PASS' : 'FAIL'}, total=${total}`)

  // §4.7: build, sign, and verify a settlement recommendation document.
  await emitSettlementRecommendation(graph, dist1, sessionRecords, contextId)
}

async function emitSettlementRecommendation(
  graph: ReturnType<typeof buildGraphFromRecords>,
  distribution: Record<string, number>,
  sessionRecords: AtribRecord[],
  contextId: string,
): Promise<void> {
  console.log()
  console.log('--- §4.7 settlement recommendation ---')

  const txRecord = sessionRecords.find((r) => r.event_type === 'transaction')
  if (!txRecord) throw new Error('no transaction record in session')
  const transactionId = recordHashHex(txRecord)

  // For the demo, use an ephemeral merchant key to sign the recommendation.
  // In production this would be a known merchant key registered via §5.5.
  const merchantSeed = ed.utils.randomPrivateKey()
  const merchantPub = await ed.getPublicKeyAsync(merchantSeed)
  const merchantKey = Buffer.from(merchantPub).toString('base64url')

  // policy_record_id for the default policy: SHA-256 of a deterministic
  // serialization of DEFAULT_POLICY. In production this would be the
  // record_hash of an on-chain policy record. For the demo, key-sorted
  // JSON.stringify is enough to give a stable identifier.
  const sortedKeys = (obj: unknown): string => {
    if (obj === null || typeof obj !== 'object') return JSON.stringify(obj)
    if (Array.isArray(obj)) return '[' + obj.map(sortedKeys).join(',') + ']'
    const entries = Object.entries(obj as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => JSON.stringify(k) + ':' + sortedKeys(v))
    return '{' + entries.join(',') + '}'
  }
  const policyRecordId = Buffer.from(
    sha256(new TextEncoder().encode(sortedKeys(DEFAULT_POLICY))),
  ).toString('hex')

  // graph_checkpoint + graph_tree_size: snapshot of the log at calc time.
  const cpRes = await fetch('https://log.atrib.dev/v1/checkpoint')
  const cpText = cpRes.ok ? await cpRes.text() : ''
  const cpLines = cpText.split('\n')
  const graphTreeSize = Number(cpLines[1] ?? '0')
  const graphCheckpoint = cpLines[2] ?? ''

  const unsigned: Omit<RecommendationDocument, 'signature'> = {
    spec_version: 'atrib/1.0',
    document_type: 'settlement_recommendation',
    context_id: contextId,
    transaction_id: transactionId,
    policy_record_id: policyRecordId,
    graph_checkpoint: graphCheckpoint,
    graph_tree_size: graphTreeSize,
    calculated_at: Date.now(),
    calculated_by: merchantKey,
    distribution,
    maximum_total_share: null,
    warnings: [],
  }

  const signed = await signRecommendation(unsigned, merchantSeed)
  const sigOk = await verifyRecommendationSignature(signed, merchantKey)
  console.log(`merchant_key: ${merchantKey}`)
  console.log(`transaction_id: ${transactionId}`)
  console.log(`graph_checkpoint: ${graphCheckpoint.slice(0, 24)}…  tree_size=${graphTreeSize}`)
  console.log(`signature: ${sigOk ? 'PASS' : 'FAIL'} (Ed25519 verify under calculated_by)`)

  // §4.7.3 distributionsMatch: confirm a freshly-recomputed dist matches.
  const dist2 = calculate(graph, DEFAULT_POLICY)
  const matches = distributionsMatch(distribution, dist2)
  console.log(`distributionsMatch: ${matches ? 'PASS' : 'FAIL'}`)

  console.log()
  console.log('signed recommendation document (excerpt):')
  console.log(JSON.stringify({
    document_type: signed.document_type,
    context_id: signed.context_id.slice(0, 16) + '…',
    transaction_id: signed.transaction_id.slice(0, 16) + '…',
    policy_record_id: signed.policy_record_id.slice(0, 16) + '…',
    graph_tree_size: signed.graph_tree_size,
    calculated_by: signed.calculated_by,
    distribution: signed.distribution,
    signature: signed.signature.slice(0, 16) + '…',
  }, null, 2))
}

main().catch((err) => {
  console.error('calc-demo: fatal', err)
  process.exit(1)
})
