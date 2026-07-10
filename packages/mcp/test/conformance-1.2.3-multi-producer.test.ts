// SPDX-License-Identifier: Apache-2.0

/**
 * Reference test for spec §1.2.3 multi-producer chain composition
 * conformance corpus (D067).
 *
 * Each pure fixture is exercised against @atrib/mcp's resolveChainRoot.
 * Fixtures with mirror_corpus input run through inheritChainContext so the
 * file boundary is covered too. Producers in any language can write the
 * same two-part runner against their implementation.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { inheritChainContext, resolveChainRoot } from '../src/index.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const CORPUS = resolve(HERE, '../../../spec/conformance/1.2.3/multi-producer')

interface CaseInput {
  context_id: string
  inbound_record_hash_hex: string | null
  auto_chain_tail_hex: string | null
  env: Record<string, string>
  mirror_tail_hex: string | null
  mirror_corpus?: {
    effective_file: string
    files: Array<{ file: string; lines: unknown[] }>
  }
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

const manifest = JSON.parse(readFileSync(join(CORPUS, 'manifest.json'), 'utf-8')) as Manifest

async function resolveCase(fixture: CaseFile): Promise<string> {
  const corpus = fixture.input.mirror_corpus
  if (!corpus) {
    return resolveChainRoot({
      contextId: fixture.input.context_id,
      inboundRecordHashHex: fixture.input.inbound_record_hash_hex ?? undefined,
      autoChainTailHex: fixture.input.auto_chain_tail_hex ?? undefined,
      mirrorTailHex: fixture.input.mirror_tail_hex ?? undefined,
      env: fixture.input.env,
    })
  }

  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'atrib-conformance-mirror-'))
  try {
    for (const file of corpus.files) {
      const path = join(temporaryDirectory, file.file)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, `${file.lines.map((line) => JSON.stringify(line)).join('\n')}\n`)
    }
    const chain = await inheritChainContext({
      callerContextId: fixture.input.context_id,
      mirrorPath: join(temporaryDirectory, corpus.effective_file),
      env: fixture.input.env,
      randomContextId: () => 'f'.repeat(32),
    })
    return chain.chainRoot
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true })
  }
}

describe('§1.2.3 multi-producer corpus', () => {
  for (const entry of manifest.cases) {
    const fixture = JSON.parse(readFileSync(join(CORPUS, entry.file), 'utf-8')) as CaseFile

    it(`${entry.name}: resolveChainRoot returns ${fixture.expected.precedence_layer}`, async () => {
      const result = await resolveCase(fixture)
      expect(result).toBe(fixture.expected.chain_root)
    })
  }
})
