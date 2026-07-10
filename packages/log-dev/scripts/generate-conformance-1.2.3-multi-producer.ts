/**
 * Generate spec §1.2.3 multi-producer chain composition conformance corpus.
 *
 * Run with:
 *   pnpm --filter @atrib/log-dev exec tsx scripts/generate-conformance-1.2.3-multi-producer.ts
 *
 * Output: spec/conformance/1.2.3/multi-producer/cases/*.json + manifest.json
 *
 * The corpus exercises the chain-root resolution precedence ordering
 * documented in spec §1.2.3 and D067. Producers participating in
 * multi-producer chain composition (e.g., mcp-wrap signing tool calls
 * alongside atrib-emit signing cognitive primitives in the same agent
 * session) MUST honor the ordering or replicate it bit-for-bit.
 *
 * Precedence (highest to lowest):
 *   1. Inbound atrib propagation token (spec §1.5.2 token decoding result)
 *   2. autoChain in-memory tail (within-process continuity)
 *   3. Cross-producer env-var handoff: ATRIB_CHAIN_TAIL_<context_id>
 *   4. Cross-producer mirror-file inheritance (caller pre-filters by ctx)
 *   5. Synthetic genesis: sha256:hex(SHA-256(UTF-8(context_id)))
 *
 * The precedence cases exercise resolveChainRoot directly. Corpus-backed
 * cases exercise inheritChainContext so the mirror I/O boundary is also
 * pinned for other implementations.
 *
 * Seeds and timestamps are hardcoded so successive regenerations produce
 * byte-identical files. Re-run when:
 *   - The precedence ordering changes
 *   - A new precedence layer is added
 *   - The env-var name format changes
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import {
  canonicalRecord,
  genesisChainRoot,
  hexEncode,
  resolveChainRoot,
  sha256,
  type AtribRecord,
} from '@atrib/mcp'

const REFERENCE_TIME_MS = Date.UTC(2026, 0, 1, 0, 0, 0)
const CONTEXT_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const TAIL_INBOUND = '1'.repeat(64)
const TAIL_AUTOCHAIN = '2'.repeat(64)
const TAIL_ENV = '3'.repeat(64)
const TAIL_MIRROR = '4'.repeat(64)
const ENV_VAR_NAME_FOR_A = `ATRIB_CHAIN_TAIL_${CONTEXT_A}`

const HERE = dirname(fileURLToPath(import.meta.url))
const CORPUS_ROOT = resolve(HERE, '../../../spec/conformance/1.2.3/multi-producer')
const CASES_DIR = join(CORPUS_ROOT, 'cases')

mkdirSync(CASES_DIR, { recursive: true })

interface CaseInput {
  context_id: string
  inbound_record_hash_hex: string | null
  auto_chain_tail_hex: string | null
  env: Record<string, string>
  mirror_tail_hex: string | null
  mirror_corpus?: MirrorCorpusFixture
}

interface MirrorCorpusFixture {
  effective_file: string
  files: Array<{ file: string; lines: unknown[] }>
}

interface CaseBody {
  name: string
  spec_section: string
  description: string
  input: CaseInput
  expected: { chain_root: string; precedence_layer: string; mirror_source_file?: string }
}

function writeCase(name: string, body: CaseBody): void {
  writeFileSync(join(CASES_DIR, `${name}.json`), JSON.stringify(body, null, 2) + '\n')
}

function buildCase(opts: {
  name: string
  description: string
  inbound?: string
  autoChain?: string
  envTail?: string
  mirror?: string
  expectedLayer: 'inbound' | 'auto-chain' | 'env-tail' | 'mirror-tail' | 'genesis'
}): CaseBody {
  const env: Record<string, string> = opts.envTail
    ? { [ENV_VAR_NAME_FOR_A]: `sha256:${opts.envTail}` }
    : {}
  const expectedChainRoot = resolveChainRoot({
    contextId: CONTEXT_A,
    inboundRecordHashHex: opts.inbound,
    autoChainTailHex: opts.autoChain,
    mirrorTailHex: opts.mirror,
    env,
  })
  return {
    name: opts.name,
    spec_section: '1.2.3',
    description: opts.description,
    input: {
      context_id: CONTEXT_A,
      inbound_record_hash_hex: opts.inbound ?? null,
      auto_chain_tail_hex: opts.autoChain ?? null,
      env,
      mirror_tail_hex: opts.mirror ?? null,
    },
    expected: { chain_root: expectedChainRoot, precedence_layer: opts.expectedLayer },
  }
}

function fixtureRecord(opts: {
  contextId: string
  timestamp: number
  contentDigit: string
}): AtribRecord {
  return {
    spec_version: 'atrib/1.0',
    content_id: `sha256:${opts.contentDigit.repeat(64)}`,
    creator_key: 'A'.repeat(43),
    chain_root: genesisChainRoot(opts.contextId),
    event_type: 'https://atrib.dev/v1/types/tool_call',
    context_id: opts.contextId,
    timestamp: opts.timestamp,
    signature: 'B'.repeat(86),
  }
}

function buildMirrorCorpusCase(opts: {
  name: string
  description: string
  effectiveFile: string
  files: MirrorCorpusFixture['files']
  expectedTail: AtribRecord
  expectedSourceFile: string
}): CaseBody {
  const mirrorTailHex = hexEncode(sha256(canonicalRecord(opts.expectedTail)))
  return {
    name: opts.name,
    spec_section: '1.2.3',
    description: opts.description,
    input: {
      context_id: CONTEXT_A,
      inbound_record_hash_hex: null,
      auto_chain_tail_hex: null,
      env: {},
      mirror_tail_hex: null,
      mirror_corpus: {
        effective_file: opts.effectiveFile,
        files: opts.files,
      },
    },
    expected: {
      chain_root: resolveChainRoot({ contextId: CONTEXT_A, mirrorTailHex, env: {} }),
      precedence_layer: 'mirror-tail',
      mirror_source_file: opts.expectedSourceFile,
    },
  }
}

function main(): void {
  const crossFileOlder = fixtureRecord({
    contextId: CONTEXT_A,
    timestamp: REFERENCE_TIME_MS,
    contentDigit: '8',
  })
  const crossFileNewer = fixtureRecord({
    contextId: CONTEXT_A,
    timestamp: REFERENCE_TIME_MS + 1,
    contentDigit: '9',
  })
  const singleFileOlder = fixtureRecord({
    contextId: CONTEXT_A,
    timestamp: REFERENCE_TIME_MS + 2,
    contentDigit: 'a',
  })
  const singleFileNewer = fixtureRecord({
    contextId: CONTEXT_A,
    timestamp: REFERENCE_TIME_MS + 3,
    contentDigit: 'b',
  })
  const foreignContextRecord = fixtureRecord({
    contextId: 'b'.repeat(32),
    timestamp: REFERENCE_TIME_MS + 4,
    contentDigit: 'c',
  })
  const cases: CaseBody[] = [
    buildCase({
      name: 'inbound-wins',
      description:
        'All four resolution sources are present. The inbound propagation token (spec §1.5.2) MUST take precedence: it carries the explicit cross-process handoff from the upstream record. Ignoring it would re-genesis a chain the caller explicitly extended.',
      inbound: TAIL_INBOUND,
      autoChain: TAIL_AUTOCHAIN,
      envTail: TAIL_ENV,
      mirror: TAIL_MIRROR,
      expectedLayer: 'inbound',
    }),
    buildCase({
      name: 'auto-chain-wins',
      description:
        "Without an inbound token, the producer's own in-memory tail (autoChain) wins. This is within-process continuity: the producer signed a previous record under the same context in this process and remembers its hash.",
      autoChain: TAIL_AUTOCHAIN,
      envTail: TAIL_ENV,
      mirror: TAIL_MIRROR,
      expectedLayer: 'auto-chain',
    }),
    buildCase({
      name: 'env-tail-wins',
      description:
        'Cross-producer env-var handoff. With no inbound token and no within-process autoChain, the parent-set ATRIB_CHAIN_TAIL_<context_id> env var is the explicit cross-producer signal and wins over a mirror file (which may lag).',
      envTail: TAIL_ENV,
      mirror: TAIL_MIRROR,
      expectedLayer: 'env-tail',
    }),
    buildCase({
      name: 'mirror-tail-wins',
      description:
        'Cross-producer mirror-file inheritance is the lowest-priority non-genesis source. The caller pre-reads the mirror, filters to records matching this context_id, and passes the canonical hash. Used when env-var handoff is unavailable (e.g., a producer started independently of the wrapper).',
      mirror: TAIL_MIRROR,
      expectedLayer: 'mirror-tail',
    }),
    buildCase({
      name: 'genesis-fallback',
      description:
        'No upstream chain context exists. chain_root MUST be the synthetic genesis per §1.2.3: sha256:hex(SHA-256(UTF-8(context_id))).',
      expectedLayer: 'genesis',
    }),
    buildCase({
      name: 'env-tail-malformed-falls-through',
      description:
        'When ATRIB_CHAIN_TAIL_<context_id> is set but malformed (not matching /^sha256:[0-9a-f]{64}$/), the resolver MUST fall through to the next layer rather than treating the malformed value as a chain anchor. Here mirror tail is the next available signal.',
      mirror: TAIL_MIRROR,
      expectedLayer: 'mirror-tail',
    }),
    buildCase({
      name: 'env-tail-namespace-isolation',
      description:
        'The env var name is namespaced per context_id. ATRIB_CHAIN_TAIL_<other_context> set in the env MUST NOT be consulted when resolving for <this_context>. With no other signals, this falls through to genesis for the requested context.',
      expectedLayer: 'genesis',
    }),
    buildCase({
      name: 'race-inbound-over-stale-auto-chain',
      description:
        'Race vector: an inbound handoff and a local autoChain tail disagree after interleaved emissions. The inbound handoff is the explicit upstream call edge and MUST win over the stale local tail.',
      inbound: '5'.repeat(64),
      autoChain: TAIL_AUTOCHAIN,
      envTail: TAIL_ENV,
      mirror: TAIL_MIRROR,
      expectedLayer: 'inbound',
    }),
    buildCase({
      name: 'race-auto-chain-over-stale-env',
      description:
        "Race vector: a producer's in-process autoChain tail and a parent-set env tail disagree. With no inbound handoff, the in-memory tail is fresher and MUST win over the stale env var.",
      autoChain: '6'.repeat(64),
      envTail: TAIL_ENV,
      mirror: TAIL_MIRROR,
      expectedLayer: 'auto-chain',
    }),
    buildCase({
      name: 'race-env-over-stale-mirror',
      description:
        'Race vector: no inbound handoff and no local autoChain tail are present, while env and mirror tails disagree. The parent-set env handoff MUST win over the mirror file because the mirror may lag pending writes.',
      envTail: '7'.repeat(64),
      mirror: TAIL_MIRROR,
      expectedLayer: 'env-tail',
    }),
    buildMirrorCorpusCase({
      name: 'mirror-corpus-cross-file-tail',
      description:
        "The effective mirror belongs to producer A, but producer B's sibling file contains the newer record on the same context_id. Mirror inheritance MUST use producer B's canonical record hash as the corpus tail.",
      effectiveFile: 'producer-a.jsonl',
      files: [
        { file: 'producer-a.jsonl', lines: [crossFileOlder] },
        { file: 'producer-b.jsonl', lines: [{ record: crossFileNewer }] },
      ],
      expectedTail: crossFileNewer,
      expectedSourceFile: 'producer-b.jsonl',
    }),
    buildMirrorCorpusCase({
      name: 'mirror-corpus-single-file-tail',
      description:
        'A corpus with one mirror file preserves append-order tail selection and context_id filtering. The later matching envelope wins even though a foreign-context record appears after it.',
      effectiveFile: 'producer-only.jsonl',
      files: [
        {
          file: 'producer-only.jsonl',
          lines: [singleFileOlder, { record: singleFileNewer }, foreignContextRecord],
        },
      ],
      expectedTail: singleFileNewer,
      expectedSourceFile: 'producer-only.jsonl',
    }),
  ]
  // Special-case: env-tail-malformed-falls-through needs a malformed env var
  // injected directly (buildCase only synthesizes valid sha256: prefixes).
  cases[5]!.input.env = { [ENV_VAR_NAME_FOR_A]: 'not-a-valid-hash' }
  // Special-case: env-tail-namespace-isolation needs the env var on a
  // different context_id than the resolution target.
  const otherCtx = 'b'.repeat(32)
  cases[6]!.input.env = { [`ATRIB_CHAIN_TAIL_${otherCtx}`]: `sha256:${TAIL_ENV}` }

  for (const c of cases) writeCase(c.name, c)

  const manifest = {
    spec_section: '1.2.3',
    spec_title: 'chain_root resolution / multi-producer composition',
    decision_link: 'D067',
    generated_at: REFERENCE_TIME_MS,
    generator: 'packages/log-dev/scripts/generate-conformance-1.2.3-multi-producer.ts',
    cases: cases.map((c) => ({ file: `cases/${c.name}.json`, name: c.name })),
    constants: {
      context_id_a: CONTEXT_A,
      tail_inbound: TAIL_INBOUND,
      tail_auto_chain: TAIL_AUTOCHAIN,
      tail_env: TAIL_ENV,
      tail_mirror: TAIL_MIRROR,
    },
    note: 'Twelve cases covering the precedence cascade (inbound > auto-chain > env-tail > mirror-tail > genesis), env-var malformation fall-through, env-var namespace isolation, three multi-producer race vectors with conflicting tails, cross-file corpus tail selection, and preserved single-file behavior. Producers in any language may consume the pure cases through resolveChainRoot and the mirror_corpus cases through their mirror-inheritance boundary.',
  }
  writeFileSync(join(CORPUS_ROOT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')

  // genesisChainRoot is referenced for documentation completeness of the
  // resolved layer; suppress unused-import warnings on stricter tsc.
  void genesisChainRoot

  console.log(`generated ${cases.length} cases at ${CORPUS_ROOT}`)
}

main()
