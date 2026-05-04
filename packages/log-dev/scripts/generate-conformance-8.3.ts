/**
 * Generate spec §8.3 conformance corpus fixtures (salted-commitment posture / D045).
 *
 * Run with: pnpm --filter @atrib/log-dev tsx scripts/generate-conformance-8.3.ts
 *
 * Output: spec/conformance/8.3/cases/*.json + manifest.json
 *
 * §8.3 introduces optional `args_salt` and `result_salt` fields on records.
 * Verifiers detect commitment form structurally per §8.3 final paragraph:
 * presence of `args_salt` indicates the salted-sha256 scheme for args;
 * absence indicates the default plain-sha256. Same for `result_salt`. The
 * §8.3 hmac-sha256 variant is signaled out-of-band per spec and is NOT
 * structurally detectable.
 *
 * The corpus exercises four cases covering every salt-presence combination
 * a verifier will see in production records:
 *
 *   1. default-posture       — neither salt present, both forms = plain-sha256
 *   2. args-salted           — args_salt only, args = salted-sha256
 *   3. result-salted         — result_salt only, result = salted-sha256
 *   4. both-salted           — both present, both forms = salted-sha256
 *
 * Each case fixes the canonical signing input so implementations can verify
 * (a) presence/absence affects JCS canonical form, (b) signature round-trips
 * with the salts in place, (c) verifier posture detection produces the
 * expected `args_commitment_form` / `result_commitment_form` values.
 *
 * Seeds and timestamps are hardcoded so successive regenerations produce
 * byte-identical files. Re-run when:
 *   - §8.3 detection invariant changes
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

// Hand-picked salts: 16 bytes each, base64url-encoded (22 chars, no padding).
// Distinct values so the canonical signing input differs between cases 2/3/4.
const ARGS_SALT_B64 = 'AQIDBAUGBwgJCgsMDQ4PEA' // bytes 0x01..0x10
const RESULT_SALT_B64 = 'EQ8NCwkHBQMBAgQGCAoMDg' // arbitrary distinct salt

const HERE = dirname(fileURLToPath(import.meta.url))
const CORPUS_ROOT = resolve(HERE, '../../../spec/conformance/8.3')
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

interface SaltConfig {
  args_salt?: string
  result_salt?: string
}

async function buildAndWrite(
  name: string,
  contentIdByte: string,
  timestampOffsetMs: number,
  salts: SaltConfig,
  expectedArgsForm: 'plain-sha256' | 'salted-sha256',
  expectedResultForm: 'plain-sha256' | 'salted-sha256',
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
    ...salts,
    signature: '',
  }
  const record = await signRecord(unsigned as AtribRecord, ALICE_SEED)
  const signingInput = canonicalSigningInput(record)

  writeCase(name, {
    name,
    spec_section: '8.3',
    description,
    input: { record, signer_seed_hex: hex(ALICE_SEED) },
    expected: {
      canonical_signing_input_utf8: new TextDecoder().decode(signingInput),
      args_salt_in_canonical_form: typeof salts.args_salt === 'string',
      result_salt_in_canonical_form: typeof salts.result_salt === 'string',
      record_hash_hex: recordHashHex(record),
      verifier_signature_ok: true,
      validator_should_accept: true,
      args_commitment_form: expectedArgsForm,
      result_commitment_form: expectedResultForm,
    },
  })
}

async function main(): Promise<void> {
  // ── Case 1: default-posture (neither salt present) ─────────────────
  await buildAndWrite(
    'default-posture',
    '01',
    1000,
    {},
    'plain-sha256',
    'plain-sha256',
    'A record with neither args_salt nor result_salt. Verifiers MUST detect args_commitment_form = "plain-sha256" and result_commitment_form = "plain-sha256" per §8.3 (absence of salt indicates the default plain-sha256 scheme). The canonical signing input MUST omit both salt fields entirely (not null, not empty string); presence/absence affects JCS canonical form and therefore the signature.',
  )

  // ── Case 2: args-salted (args_salt only) ───────────────────────────
  await buildAndWrite(
    'args-salted',
    '02',
    2000,
    { args_salt: ARGS_SALT_B64 },
    'salted-sha256',
    'plain-sha256',
    'A record carrying args_salt but no result_salt. Verifiers MUST detect args_commitment_form = "salted-sha256" (per §8.3: presence of args_salt indicates the salted-sha256 scheme) and result_commitment_form = "plain-sha256" (absence of result_salt indicates default). JCS canonical form sorts args_salt between annotates ("a-n") and chain_root ("c"), since "a-r" lies between them.',
  )

  // ── Case 3: result-salted (result_salt only) ───────────────────────
  await buildAndWrite(
    'result-salted',
    '03',
    3000,
    { result_salt: RESULT_SALT_B64 },
    'plain-sha256',
    'salted-sha256',
    'A record carrying result_salt but no args_salt. Mirror of case 2: args_commitment_form = "plain-sha256", result_commitment_form = "salted-sha256". JCS canonical form sorts result_salt between provenance_token ("p") and revises ("r-e-v"), since "r-e-s" lies between them.',
  )

  // ── Case 4: both-salted (both salts present) ───────────────────────
  await buildAndWrite(
    'both-salted',
    '04',
    4000,
    { args_salt: ARGS_SALT_B64, result_salt: RESULT_SALT_B64 },
    'salted-sha256',
    'salted-sha256',
    'A record carrying both args_salt and result_salt. Verifiers MUST detect both forms as salted-sha256. The two salt fields are independent dials per §8.3; an issuer can pick salted commitments for one and plain for the other freely. The canonical signing input contains both fields in their JCS-sorted positions.',
  )

  // ── Manifest ───────────────────────────────────────────────────────
  const aliceKey = base64urlEncode(await getPublicKey(ALICE_SEED))
  const manifest = {
    spec_section: '8.3',
    spec_title: 'Salted-commitment posture (args_salt / result_salt)',
    decision_link: 'D045',
    generated_at: REFERENCE_TIME_MS,
    generator: 'packages/log-dev/scripts/generate-conformance-8.3.ts',
    cases: [
      { file: 'cases/default-posture.json', name: 'default-posture' },
      { file: 'cases/args-salted.json', name: 'args-salted' },
      { file: 'cases/result-salted.json', name: 'result-salted' },
      { file: 'cases/both-salted.json', name: 'both-salted' },
    ],
    keys: { alice_pubkey: aliceKey },
    salts: { args_salt_b64: ARGS_SALT_B64, result_salt_b64: RESULT_SALT_B64 },
    note: 'The four cases cover every salt-presence combination a §8.3 verifier will see: neither, args-only, result-only, both. Each case fixes the canonical signing input + expected commitment-form values. The §8.3 hmac-sha256 variant is signaled out-of-band per spec and is not structurally detectable, so it is not represented in this corpus.',
  }

  writeFileSync(join(CORPUS_ROOT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')

  console.log(`generated ${manifest.cases.length} cases at ${CORPUS_ROOT}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
