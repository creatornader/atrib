// SPDX-License-Identifier: Apache-2.0
//
// Build + verify + render an atrib continuation packet from a facts document.
//   node cli.js <facts.json> --render full|no_lineage|hashes_only
// Prints the rendered packet (what a session-2 agent reads) to stdout. The facts
// doc may be the eval's incident.json (it carries facts + chain_fact_ids).

import { readFileSync } from 'node:fs'
import {
  buildSession1Records,
  assemblePacket,
  verifyPacket,
  renderPacket,
  forgePacket,
  type FactsDoc,
  type PacketRender,
} from './build-continuation-packet.js'

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const path = args.find((a) => !a.startsWith('--'))
  const render = (args.includes('--render') ? args[args.indexOf('--render') + 1] : 'full') as PacketRender
  // --no-verify omits the "N records accepted, hash-checked" line, so a caller can
  // isolate whether the crypto verification signal (not just the structure) drives
  // a downstream reader's trust.
  const showVerify = !args.includes('--no-verify')
  // --forge corrupts signatures so the packet fails §5.5.5 verification: a
  // structured-looking fake that only the signature check can distinguish.
  const forge = args.includes('--forge')
  if (!path) {
    process.stderr.write('usage: cli.js <facts.json> --render full|no_lineage|hashes_only [--no-verify] [--forge]\n')
    process.exit(2)
  }
  const raw = JSON.parse(readFileSync(path, 'utf8'))
  const doc: FactsDoc = {
    context_label: raw.context_label ?? raw.incident_id ?? 'ctx',
    facts: raw.facts,
    chain_fact_ids: raw.chain_fact_ids,
  }
  const built = await buildSession1Records(doc)
  const { records, bodyByHash } = forge
    ? forgePacket(built.records, built.bodyByHash)
    : { records: built.records, bodyByHash: built.bodyByHash }
  const verify = showVerify ? await verifyPacket(assemblePacket(records, bodyByHash)) : undefined
  process.stdout.write(renderPacket(render, records, bodyByHash, built.contextId, built.chainTail, verify))
}

main().catch((err) => {
  process.stderr.write(`continuation cli error: ${String(err)}\n`)
  process.exit(1)
})
