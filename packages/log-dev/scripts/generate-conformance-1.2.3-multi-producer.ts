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
 * The corpus exercises resolveChainRoot directly. inheritChainContext
 * (which orchestrates context_id inheritance + mirror file I/O) is an
 * implementation-level convenience tested in @atrib/mcp's mirror.test.ts;
 * its decision tree is documented in the corpus README.
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
import { genesisChainRoot, resolveChainRoot } from '@atrib/mcp'

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
}

interface CaseBody {
  name: string
  spec_section: string
  description: string
  input: CaseInput
  expected: { chain_root: string; precedence_layer: string }
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
  expectedLayer:
    | 'inbound'
    | 'auto-chain'
    | 'env-tail'
    | 'mirror-tail'
    | 'genesis'
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

function main(): void {
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
    note:
      'Seven cases covering the precedence cascade (inbound > auto-chain > env-tail > mirror-tail > genesis), env-var malformation fall-through, and env-var namespace isolation. Producers in any language may consume this corpus by serializing their resolveChainRoot equivalent against each case input and asserting the chain_root output matches.',
  }
  writeFileSync(join(CORPUS_ROOT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')

  // genesisChainRoot is referenced for documentation completeness of the
  // resolved layer; suppress unused-import warnings on stricter tsc.
  void genesisChainRoot

  console.log(`generated ${cases.length} cases at ${CORPUS_ROOT}`)
}

main()
