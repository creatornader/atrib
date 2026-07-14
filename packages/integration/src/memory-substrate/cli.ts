// SPDX-License-Identifier: Apache-2.0
//
// CLI over the memory substrate.
//
//   sign:     node cli.js sign <items.json> --context <label> --out <signed.json>
//             items.json = {"items":[MemoryItem...]} (extractor output)
//   retrieve: node cli.js retrieve <signed.json> --query "<text>" [--budget 2000]
//             [--window-end N] [--no-chains] [--verbose]
//             prints the rendered memory block to stdout.
//
// The retrieve path implements the shipped recall semantics locally (BM25 per
// D086 + revision-chain expansion per trace/recall_revisions); --no-chains
// ablates the chain expansion so a caller can isolate its effect.

import { readFileSync, writeFileSync } from 'node:fs'
import { signMemoryItems, retrieveMemory, type MemoryItem, type SignedMemory } from './build-memory-substrate.js'

function arg(name: string, dflt?: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : dflt
}

async function main(): Promise<void> {
  const cmd = process.argv[2]
  const path = process.argv[3]
  if (cmd === 'sign' && path) {
    const items = (JSON.parse(readFileSync(path, 'utf8')).items ?? JSON.parse(readFileSync(path, 'utf8')).records ?? []) as MemoryItem[]
    const context = arg('--context', 'ctx')!
    const out = arg('--out')
    const signed = await signMemoryItems(items, context)
    const payload = JSON.stringify({ context, count: signed.length, revisions_linked: signed.filter((s) => s.revises).length, records: signed }, null, 1)
    if (out) writeFileSync(out, payload)
    else process.stdout.write(payload)
    process.stderr.write(`signed ${signed.length} records (${signed.filter((s) => s.revises).length} revision-linked)\n`)
    return
  }
  if (cmd === 'retrieve' && path) {
    const records = JSON.parse(readFileSync(path, 'utf8')).records as SignedMemory[]
    const query = arg('--query', '')!
    const budgetTokens = Number(arg('--budget', '2000'))
    const windowEndRaw = arg('--window-end')
    process.stdout.write(
      retrieveMemory(records, query, {
        budgetTokens,
        expandChains: !process.argv.includes('--no-chains'),
        ...(process.argv.includes('--verbose') ? { compact: false } : {}),
        noteForm: process.argv.includes('--note-form'),
        ...(windowEndRaw !== undefined ? { windowEnd: Number(windowEndRaw) } : {}),
      }),
    )
    return
  }
  process.stderr.write('usage: cli.js sign <items.json> --context <label> [--out f] | retrieve <signed.json> --query <q> [--budget N] [--window-end N] [--no-chains] [--verbose]\n')
  process.exit(2)
}

main().catch((err) => {
  process.stderr.write(`memory-substrate cli error: ${String(err)}\n`)
  process.exit(1)
})
