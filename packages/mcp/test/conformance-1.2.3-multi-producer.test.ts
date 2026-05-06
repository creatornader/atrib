// SPDX-License-Identifier: Apache-2.0

/**
 * Reference test for spec §1.2.3 multi-producer chain composition
 * conformance corpus (D067).
 *
 * Each case fixture in spec/conformance/1.2.3/multi-producer/cases/ is
 * exercised against @atrib/mcp's resolveChainRoot. Producers in any
 * language can write their own runner that does the same against their
 * own resolver implementation; passing the corpus is the contract for
 * compliant participation in multi-producer chain composition.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { resolveChainRoot } from '../src/index.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const CORPUS = resolve(HERE, '../../../spec/conformance/1.2.3/multi-producer')

interface CaseInput {
  context_id: string
  inbound_record_hash_hex: string | null
  auto_chain_tail_hex: string | null
  env: Record<string, string>
  mirror_tail_hex: string | null
}

interface CaseFile {
  name: string
  description: string
  input: CaseInput
  expected: { chain_root: string; precedence_layer: string }
}

interface Manifest {
  cases: { file: string; name: string }[]
}

const manifest = JSON.parse(
  readFileSync(join(CORPUS, 'manifest.json'), 'utf-8'),
) as Manifest

describe('§1.2.3 multi-producer corpus', () => {
  for (const entry of manifest.cases) {
    const fixture = JSON.parse(readFileSync(join(CORPUS, entry.file), 'utf-8')) as CaseFile

    it(`${entry.name}: resolveChainRoot returns ${fixture.expected.precedence_layer}`, () => {
      const result = resolveChainRoot({
        contextId: fixture.input.context_id,
        inboundRecordHashHex: fixture.input.inbound_record_hash_hex ?? undefined,
        autoChainTailHex: fixture.input.auto_chain_tail_hex ?? undefined,
        mirrorTailHex: fixture.input.mirror_tail_hex ?? undefined,
        env: fixture.input.env,
      })
      expect(result).toBe(fixture.expected.chain_root)
    })
  }
})
