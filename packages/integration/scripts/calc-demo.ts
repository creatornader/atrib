// SPDX-License-Identifier: Apache-2.0

/**
 * calc-demo.ts — exercise the §4.6 calculation algorithm on a real chain.
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
import type { AtribRecord } from '@atrib/mcp'
import { buildGraphFromRecords } from '../src/graph-builder.js'
import { calculate, DEFAULT_POLICY } from '@atrib/verify'

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

function main(): void {
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
    console.log(`determinism: PASS — two runs produced identical distribution`)
  } else {
    console.error(`determinism: FAIL`)
    console.error(`run 1: ${JSON.stringify(dist1)}`)
    console.error(`run 2: ${JSON.stringify(dist2)}`)
    process.exit(1)
  }

  // Sanity: shares should sum to ~1.0 (modulo floating point).
  const total = Object.values(dist1).reduce((s, v) => s + v, 0)
  const sumOk = Math.abs(total - 1) < 1e-9
  console.log(`sum-to-one: ${sumOk ? 'PASS' : 'FAIL'} — total=${total}`)
}

main()
