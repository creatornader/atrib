// SPDX-License-Identifier: Apache-2.0

/**
 * Spec §1.2.3.1 multi-producer chain composition conformance for the
 * @atrib/sdk surface (D067).
 *
 * Loads every case listed in spec/conformance/1.2.3/multi-producer/
 * manifest.json. Pure inputs run through `resolveChainRoot`; mirror_corpus
 * inputs run through `inheritChainContext`. Both functions are re-exported
 * through the consolidated SDK. The precedence cascade under test remains
 * inbound > auto-chain > env-tail > mirror-tail > genesis.
 *
 * Each case supplies its own `env` object which is passed as the env stub
 * (never process.env), so no environment state leaks between cases. JSON
 * nulls in case inputs map to `undefined` arguments.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { genesisChainRoot, inheritChainContext, resolveChainRoot } from '../src/index.js'

const CORPUS = join(__dirname, '../../../spec/conformance/1.2.3/multi-producer')

interface Manifest {
  spec_section: string
  cases: Array<{ file: string; name: string }>
}

interface CaseFile {
  name: string
  spec_section: string
  description: string
  input: {
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
  expected: {
    chain_root: string
    precedence_layer: 'inbound' | 'auto-chain' | 'env-tail' | 'mirror-tail' | 'genesis'
  }
}

const manifest = JSON.parse(readFileSync(join(CORPUS, 'manifest.json'), 'utf8')) as Manifest

function loadCase(file: string): CaseFile {
  return JSON.parse(readFileSync(join(CORPUS, file), 'utf8')) as CaseFile
}

async function resolveCase(c: CaseFile): Promise<string> {
  const corpus = c.input.mirror_corpus
  if (!corpus) {
    return resolveChainRoot({
      contextId: c.input.context_id,
      inboundRecordHashHex: c.input.inbound_record_hash_hex ?? undefined,
      autoChainTailHex: c.input.auto_chain_tail_hex ?? undefined,
      mirrorTailHex: c.input.mirror_tail_hex ?? undefined,
      env: c.input.env as NodeJS.ProcessEnv,
    })
  }

  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'atrib-sdk-conformance-mirror-'))
  try {
    for (const file of corpus.files) {
      const path = join(temporaryDirectory, file.file)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, `${file.lines.map((line) => JSON.stringify(line)).join('\n')}\n`)
    }
    const chain = await inheritChainContext({
      callerContextId: c.input.context_id,
      mirrorPath: join(temporaryDirectory, corpus.effective_file),
      env: c.input.env as NodeJS.ProcessEnv,
      randomContextId: () => 'f'.repeat(32),
    })
    return chain.chainRoot
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true })
  }
}

describe('spec §1.2.3.1 multi-producer conformance (@atrib/sdk)', () => {
  it('manifest enumerates the full twelve-case corpus', () => {
    expect(manifest.spec_section).toBe('1.2.3')
    expect(manifest.cases).toHaveLength(12)
  })

  for (const entry of manifest.cases) {
    it(`${entry.name}: resolveChainRoot matches expected chain_root`, async () => {
      const c = loadCase(entry.file)

      // The case file's self-declared name matches the manifest entry.
      expect(c.name).toBe(entry.name)

      const resolved = await resolveCase(c)

      expect(resolved).toBe(c.expected.chain_root)

      // Cross-check the declared precedence layer where it is structurally
      // derivable: a genesis-layer expectation must equal the synthetic
      // genesis chain_root for the case's context_id (§1.2.3), and any
      // non-genesis layer must not.
      if (c.expected.precedence_layer === 'genesis') {
        expect(c.expected.chain_root).toBe(genesisChainRoot(c.input.context_id))
      } else {
        expect(c.expected.chain_root).not.toBe(genesisChainRoot(c.input.context_id))
      }
    })
  }

  it('genesis-fallback: final fallback equals genesisChainRoot(context_id)', () => {
    const c = loadCase('cases/genesis-fallback.json')

    // No upstream chain context of any kind: the resolver MUST synthesize
    // the genesis anchor "sha256:" + hex(SHA-256(UTF-8(context_id))).
    const resolved = resolveChainRoot({
      contextId: c.input.context_id,
      env: c.input.env as NodeJS.ProcessEnv,
    })

    expect(resolved).toBe(genesisChainRoot(c.input.context_id))
    expect(resolved).toBe(c.expected.chain_root)
    expect(c.expected.precedence_layer).toBe('genesis')
  })
})
