/**
 * Generate spec §1.2.6 conformance corpus fixtures (provenance_token / D044).
 *
 * Run with: pnpm --filter @atrib/log-dev tsx scripts/generate-conformance-1.2.6.ts
 *
 * Output: spec/conformance/1.2.6/cases/*.json + manifest.json
 *
 * §1.2.6 introduces the provenance_token field for cross-session causal
 * anchoring. The corpus exercises four load-bearing properties:
 *
 *   1. Canonical form with provenance_token (genesis record). Confirms the
 *      JCS field-order invariant — provenance_token sorts after informed_by
 *      and before session_token (i < p < s).
 *   2. Token derivation from upstream record. Confirms the §1.2.6
 *      derivation rule: token = base64url(sha256(JCS(upstream-record))[:16]).
 *   3. Genesis-record-only invariant. A record carrying provenance_token on
 *      a non-genesis chain_root MUST be rejected by both validators (§2.6.1
 *      log-side admission) and verifiers (§5.5 consumer-side audit).
 *   4. Absence is canonical. provenance_token MUST be omitted (not null,
 *      not empty) when not anchoring; presence/absence affects JCS
 *      canonical form per §1.3.
 *
 * Seeds and timestamps are hardcoded so successive regenerations produce
 * byte-identical files. Re-run when:
 *   - §1.2.6 derivation invariant changes
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
const BOB_SEED = new Uint8Array(32).fill(0x22)
const REFERENCE_TIME_MS = Date.UTC(2026, 0, 1, 0, 0, 0)
const ALICE_CONTEXT = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const BOB_CONTEXT = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

const HERE = dirname(fileURLToPath(import.meta.url))
const CORPUS_ROOT = resolve(HERE, '../../../spec/conformance/1.2.6')
const CASES_DIR = join(CORPUS_ROOT, 'cases')

mkdirSync(CASES_DIR, { recursive: true })

const utf8 = new TextEncoder()

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex')
}

function recordHashHex(record: AtribRecord): string {
  return hex(sha256(canonicalRecord(record)))
}

function deriveProvenanceToken(upstream: AtribRecord): string {
  return base64urlEncode(sha256(canonicalRecord(upstream)).slice(0, 16))
}

function writeCase(name: string, body: Record<string, unknown>): void {
  const path = join(CASES_DIR, `${name}.json`)
  writeFileSync(path, JSON.stringify(body, null, 2) + '\n')
}

async function main(): Promise<void> {
  const alicePub = await getPublicKey(ALICE_SEED)
  const aliceKey = base64urlEncode(alicePub)
  const bobPub = await getPublicKey(BOB_SEED)
  const bobKey = base64urlEncode(bobPub)

  const aliceGenesisChainRoot = genesisChainRoot(ALICE_CONTEXT)
  const bobGenesisChainRoot = genesisChainRoot(BOB_CONTEXT)

  // ── Case 1: genesis-with-provenance ────────────────────────────────
  // Alice's session-genesis record carrying a hand-constructed
  // provenance_token. This is the canonical-form check: implementations
  // MUST canonicalize the record with provenance_token sorted between
  // informed_by and session_token.
  const HAND_TOKEN = 'AAAAAAAAAAAAAAAAAAAAAA' // valid base64url, 22 chars (16 bytes)
  const r1Unsigned = {
    spec_version: 'atrib/1.0' as const,
    content_id: 'sha256:' + 'c1'.repeat(32),
    creator_key: aliceKey,
    chain_root: aliceGenesisChainRoot,
    event_type: 'https://atrib.dev/v1/types/observation',
    context_id: ALICE_CONTEXT,
    timestamp: REFERENCE_TIME_MS + 1000,
    provenance_token: HAND_TOKEN,
    signature: '',
  }
  const r1 = await signRecord(r1Unsigned as AtribRecord, ALICE_SEED)
  const r1SigningInput = canonicalSigningInput(r1)

  writeCase('genesis-with-provenance', {
    name: 'genesis-with-provenance',
    spec_section: '1.2.6',
    description:
      'A session-genesis record carrying provenance_token. Verifies (a) the JCS field-order invariant (provenance_token sorts between informed_by and session_token), (b) the signature round-trips with the field present. Validators and verifiers MUST accept this record.',
    input: { record: r1, signer_seed_hex: hex(ALICE_SEED) },
    expected: {
      canonical_signing_input_utf8: new TextDecoder().decode(r1SigningInput),
      record_hash_hex: recordHashHex(r1),
      validator_should_accept: true,
      verifier_signature_ok: true,
    },
  })

  // ── Case 2: upstream-derivation ────────────────────────────────────
  // Bob's session-genesis record claims ancestry from Alice's r1 via
  // provenance_token = base64url(sha256(JCS(r1))[:16]). This is the
  // canonical derivation case — implementations producing a downstream
  // record MUST derive the token from the upstream's canonical-form hash.
  const derivedToken = deriveProvenanceToken(r1)
  const r2Unsigned = {
    spec_version: 'atrib/1.0' as const,
    content_id: 'sha256:' + 'c2'.repeat(32),
    creator_key: bobKey,
    chain_root: bobGenesisChainRoot,
    event_type: 'https://atrib.dev/v1/types/observation',
    context_id: BOB_CONTEXT,
    timestamp: REFERENCE_TIME_MS + 2000,
    provenance_token: derivedToken,
    signature: '',
  }
  const r2 = await signRecord(r2Unsigned as AtribRecord, BOB_SEED)

  writeCase('upstream-derivation', {
    name: 'upstream-derivation',
    spec_section: '1.2.6',
    description:
      "Bob's session-genesis record carries a provenance_token derived from Alice's upstream record per §1.2.6: token = base64url(sha256(JCS(upstream))[:16]). Verifies the derivation invariant. Implementations consuming the downstream record MUST be able to reproduce the token by hashing the upstream record's canonical form.",
    input: {
      upstream_record: r1,
      downstream_record: r2,
      downstream_signer_seed_hex: hex(BOB_SEED),
    },
    expected: {
      derived_provenance_token: derivedToken,
      upstream_full_record_hash: 'sha256:' + recordHashHex(r1),
      downstream_signature_verifies: true,
      validator_should_accept: true,
    },
  })

  // ── Case 3: non-genesis-with-provenance (REJECT) ────────────────────
  // A non-genesis record (chain_root != genesisChainRoot(context_id))
  // carrying provenance_token. Per §1.2.6, both validators and verifiers
  // MUST reject this case. We sign it anyway (signing is mechanical;
  // validation is policy) so implementations can exercise their reject path.
  const fakeNonGenesisChainRoot = 'sha256:' + 'ff'.repeat(32)
  const r3Unsigned = {
    spec_version: 'atrib/1.0' as const,
    content_id: 'sha256:' + 'c3'.repeat(32),
    creator_key: aliceKey,
    chain_root: fakeNonGenesisChainRoot,
    event_type: 'https://atrib.dev/v1/types/observation',
    context_id: ALICE_CONTEXT,
    timestamp: REFERENCE_TIME_MS + 3000,
    provenance_token: HAND_TOKEN,
    signature: '',
  }
  const r3 = await signRecord(r3Unsigned as AtribRecord, ALICE_SEED)

  writeCase('non-genesis-with-provenance', {
    name: 'non-genesis-with-provenance',
    spec_section: '1.2.6',
    description:
      'A NON-genesis record carrying provenance_token. chain_root is not genesisChainRoot(context_id). Per §1.2.6 ("provenance_token MUST appear ONLY on the genesis record"), both validators (§2.6.1) and verifiers (§5.5) MUST reject this record. Signature itself is valid; rejection is at the policy layer.',
    input: { record: r3, signer_seed_hex: hex(ALICE_SEED) },
    expected: {
      genesis_chain_root_for_context: aliceGenesisChainRoot,
      record_chain_root: fakeNonGenesisChainRoot,
      record_hash_hex: recordHashHex(r3),
      validator_should_accept: false,
      verifier_signature_ok: true,
      verifier_should_flag: true,
      rejection_reason: 'provenance_token on non-genesis record',
    },
  })

  // ── Case 4: omits-when-absent ──────────────────────────────────────
  // A record without provenance_token. The field MUST be omitted (not
  // null, not empty string) per §1.3. Confirms the canonical form differs
  // from a record that includes provenance_token: ""; an implementation
  // that emits an empty string instead of omission produces a different
  // canonical bytes and a different signature.
  const r4Unsigned = {
    spec_version: 'atrib/1.0' as const,
    content_id: 'sha256:' + 'c4'.repeat(32),
    creator_key: aliceKey,
    chain_root: aliceGenesisChainRoot,
    event_type: 'https://atrib.dev/v1/types/observation',
    context_id: ALICE_CONTEXT,
    timestamp: REFERENCE_TIME_MS + 4000,
    signature: '',
  }
  const r4 = await signRecord(r4Unsigned as AtribRecord, ALICE_SEED)
  const r4SigningInput = canonicalSigningInput(r4)

  writeCase('omits-when-absent', {
    name: 'omits-when-absent',
    spec_section: '1.2.6',
    description:
      'A record without provenance_token. The canonical signing input MUST omit the field entirely (not null, not empty string). Implementations that emit `provenance_token: ""` produce a different canonical bytes and a different signature; this case fixes the omission contract by hashing.',
    input: { record: r4, signer_seed_hex: hex(ALICE_SEED) },
    expected: {
      canonical_signing_input_utf8: new TextDecoder().decode(r4SigningInput),
      provenance_token_in_canonical_form: false,
      record_hash_hex: recordHashHex(r4),
      validator_should_accept: true,
      verifier_signature_ok: true,
    },
  })

  // ── Manifest ───────────────────────────────────────────────────────
  const manifest = {
    spec_section: '1.2.6',
    spec_title: 'provenance_token (cross-session causal anchor)',
    decision_link: 'D044',
    generated_at: REFERENCE_TIME_MS,
    generator: 'packages/log-dev/scripts/generate-conformance-1.2.6.ts',
    cases: [
      { file: 'cases/genesis-with-provenance.json', name: 'genesis-with-provenance' },
      { file: 'cases/upstream-derivation.json', name: 'upstream-derivation' },
      { file: 'cases/non-genesis-with-provenance.json', name: 'non-genesis-with-provenance' },
      { file: 'cases/omits-when-absent.json', name: 'omits-when-absent' },
    ],
    keys: { alice_pubkey: aliceKey, bob_pubkey: bobKey },
    note: 'The four cases collectively exercise the §1.2.6 contract: canonical-form invariance with the field present (case 1), derivation rule from upstream record (case 2), genesis-only rejection (case 3), and absence-not-null canonicalization (case 4).',
  }

  writeFileSync(join(CORPUS_ROOT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')

  // Touch utf8 so it's not flagged as unused on stricter tsc settings.
  void utf8

  console.log(`generated ${manifest.cases.length} cases at ${CORPUS_ROOT}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
