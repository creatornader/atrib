// SPDX-License-Identifier: Apache-2.0

/**
 * Thin CLI over `buildCausalBrief`. Reads one TraceDoc JSON file and writes the
 * brief to stdout.
 *
 *   node cli.js <tracedoc.json> --mode atrib|flat
 *
 * The module is a pure function; this CLI adds only file read + stdout write so
 * a language-agnostic harness can call it per trace. It intentionally has no
 * access to any label/annotation source: it reads exactly the one path it is
 * given and emits a brief that is a function of those bytes alone.
 */

import { readFileSync } from 'node:fs'
import { buildCausalBrief, type BriefMode, type TraceDoc } from './build-causal-brief.js'

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const path = args.find((a) => !a.startsWith('--'))
  const modeArg = args.includes('--mode') ? args[args.indexOf('--mode') + 1] : 'atrib'
  if (!path) {
    process.stderr.write('usage: cli.js <tracedoc.json> --mode atrib|flat\n')
    process.exit(2)
  }
  if (modeArg !== 'atrib' && modeArg !== 'flat' && modeArg !== 'atrib_tree') {
    process.stderr.write(`invalid --mode: ${modeArg} (expected flat|atrib_tree|atrib)\n`)
    process.exit(2)
  }
  const doc = JSON.parse(readFileSync(path, 'utf8')) as TraceDoc
  const brief = await buildCausalBrief(doc, modeArg as BriefMode)
  process.stdout.write(brief)
}

main().catch((err) => {
  process.stderr.write(`causal-brief cli error: ${String(err)}\n`)
  process.exit(1)
})
