/**
 * Generate spec §8.2 conformance corpus fixtures (opaque-name posture / D061).
 *
 * Run with: pnpm --filter @atrib/log-dev tsx scripts/generate-conformance-8.2.ts
 *
 * Output: spec/conformance/8.2/cases/*.json + manifest.json
 *
 * §8.2 (per D061) defines `tool_name` as an OPTIONAL field on the §1.2.1
 * canonical record. Verifiers detect form structurally:
 *
 *   - 'hashed' iff value matches `^sha256:[0-9a-f]{64}$` (unambiguous)
 *   - 'plain'  for any other present value (verbatim and opaque-label
 *              forms NOT structurally distinguishable per D061; both
 *              surface as plain)
 *   - null     when the field is absent (the §8.1 default posture)
 *
 * The corpus exercises four cases covering every detection branch:
 *
 *   1. tool-name-omitted  — field absent → null
 *   2. tool-name-verbatim — `book_flight` → 'plain'
 *   3. tool-name-opaque   — `tool_a7f3` → 'plain' (same as verbatim by design)
 *   4. tool-name-hashed   — `sha256:<64 hex>` → 'hashed'
 *
 * Each case fixes the canonical signing input, the expected
 * `tool_name_form` value, and the record signature. Conforming verifiers
 * MUST produce identical detections.
 *
 * Seeds and timestamps are hardcoded so successive regenerations produce
 * byte-identical files. Re-run when:
 *   - §8.2 form-detection invariant changes
 *   - canonical record format (§1.2 / §1.3) changes
 *   - new test cases are needed
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import {
  base64urlEncode,
  canonicalRecord,
  canonicalSigningInput,
  genesisChainRoot,
  getPublicKey,
  signRecord,
  type AtribRecord,
} from '@atrib/mcp'
import { sha256 } from '@noble/hashes/sha2.js'

const ALICE_SEED = new Uint8Array(32).fill(0x11)
const REFERENCE_TIME_MS = Date.UTC(2026, 0, 1, 0, 0, 0)
const ALICE_CONTEXT = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

const HERE = dirname(fileURLToPath(import.meta.url))
const CORPUS_ROOT = resolve(HERE, '../../../spec/conformance/8.2')
const CASES_DIR = join(CORPUS_ROOT, 'cases')

mkdirSync(CASES_DIR, { recursive: true })

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex')
}

function recordHashHex(record: AtribRecord): string {
  return hex(sha256(canonicalRecord(record)))
}

function writeCase(name: string, body: Record<string, unknown>): void {
  const path = join(CASES_DIR, `${name}.json`)
  writeFileSync(path, JSON.stringify(body, null, 2) + '\n')
}

async function buildAndWrite(
  name: string,
  contentIdByte: string,
  timestampOffsetMs: number,
  tool_name: string | undefined,
  expectedForm: 'hashed' | 'plain' | null,
  description: string,
): Promise<void> {
  const aliceKey = base64urlEncode(await getPublicKey(ALICE_SEED))
  const aliceGenesisChainRoot = genesisChainRoot(ALICE_CONTEXT)
  const unsigned = {
    spec_version: 'atrib/1.0' as const,
    content_id: 'sha256:' + contentIdByte.repeat(32),
    creator_key: aliceKey,
    chain_root: aliceGenesisChainRoot,
    event_type: 'https://atrib.dev/v1/types/tool_call',
    context_id: ALICE_CONTEXT,
    timestamp: REFERENCE_TIME_MS + timestampOffsetMs,
    ...(tool_name !== undefined ? { tool_name } : {}),
    signature: '',
  }
  const record = await signRecord(unsigned as AtribRecord, ALICE_SEED)
  const signingInput = canonicalSigningInput(record)

  writeCase(name, {
    name,
    spec_section: '8.2',
    description,
    input: { record, signer_seed_hex: hex(ALICE_SEED) },
    expected: {
      canonical_signing_input_utf8: new TextDecoder().decode(signingInput),
      tool_name_in_canonical_form: tool_name !== undefined,
      record_hash_hex: recordHashHex(record),
      verifier_signature_ok: true,
      validator_should_accept: true,
      tool_name_form: expectedForm,
    },
  })
}

async function main(): Promise<void> {
  // ── Case 1: tool-name-omitted (the §8.1 default posture) ────────────
  await buildAndWrite(
    'tool-name-omitted',
    '01',
    1000,
    undefined,
    null,
    'A record with no `tool_name` field. Verifiers MUST surface tool_name_form: null per the §8.1 default posture (no tool-name disclosure beyond what content_id derives from serverUrl + toolName). The canonical signing input MUST omit the field entirely.',
  )

  // ── Case 2: tool-name-verbatim ──────────────────────────────────────
  await buildAndWrite(
    'tool-name-verbatim',
    '02',
    2000,
    'book_flight',
    'plain',
    "A record carrying a verbatim-style tool_name (`book_flight`). Verifiers MUST surface tool_name_form: 'plain'. Per D061 the verbatim-vs-opaque distinction is NOT structurally detectable: this case and the opaque-label case both surface as 'plain'.",
  )

  // ── Case 3: tool-name-opaque ────────────────────────────────────────
  await buildAndWrite(
    'tool-name-opaque',
    '03',
    3000,
    'tool_a7f3',
    'plain',
    "A record carrying an opaque-label-style tool_name (`tool_a7f3`). Verifiers MUST surface tool_name_form: 'plain', identical to the verbatim case. Per D061 the structural detection cannot distinguish `book_flight` (verbatim) from `tool_a7f3` (opaque) since both match the §8.2 opaque regex `[a-z0-9_-]{1,64}`. Consumers wanting the distinction MUST use out-of-band metadata.",
  )

  // ── Case 4: tool-name-hashed ────────────────────────────────────────
  const hashedName = 'sha256:' + '5'.repeat(64)
  await buildAndWrite(
    'tool-name-hashed',
    '04',
    4000,
    hashedName,
    'hashed',
    "A record carrying a hashed tool_name (`sha256:<64 lowercase hex>`). Verifiers MUST surface tool_name_form: 'hashed'. The regex `^sha256:[0-9a-f]{64}$` is unambiguous. Verifiers configured with a name-mapping can resolve to the verbatim name; others see only the hash.",
  )

  // ── Manifest ───────────────────────────────────────────────────────
  const aliceKey = base64urlEncode(await getPublicKey(ALICE_SEED))
  const manifest = {
    spec_section: '8.2',
    spec_title: 'Opaque-name posture (tool_name field)',
    decision_link: 'D061',
    generated_at: REFERENCE_TIME_MS,
    generator: 'packages/log-dev/scripts/generate-conformance-8.2.ts',
    cases: [
      { file: 'cases/tool-name-omitted.json', name: 'tool-name-omitted' },
      { file: 'cases/tool-name-verbatim.json', name: 'tool-name-verbatim' },
      { file: 'cases/tool-name-opaque.json', name: 'tool-name-opaque' },
      { file: 'cases/tool-name-hashed.json', name: 'tool-name-hashed' },
    ],
    keys: { alice_pubkey: aliceKey },
    note: 'The four cases cover every detection branch: omitted (null), verbatim (plain), opaque (plain), hashed. Per D061 the verbatim-vs-opaque distinction is not structurally detectable; both surface as plain. The corpus does NOT include a `tool_name_form: "verbatim"` or `"opaque"` case because those are not part of the verifier-detectable surface — that distinction lives in producer-side intent and out-of-band metadata.',
  }

  writeFileSync(join(CORPUS_ROOT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')

  console.log(`generated ${manifest.cases.length} cases at ${CORPUS_ROOT}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
