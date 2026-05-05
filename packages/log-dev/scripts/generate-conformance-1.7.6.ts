/**
 * Generate spec §1.7.6 conformance corpus fixtures (cross-attestation / D052).
 *
 * Run with: pnpm --filter @atrib/log-dev tsx scripts/generate-conformance-1.7.6.ts
 *
 * Output: spec/conformance/1.7.6/cases/*.json + manifest.json
 *
 * §1.7.6 mandates that transaction records carry a `signers` array with
 * at least 2 verified entries (typically agent + counterparty). Verifiers
 * surface a `cross_attestation` annotation: { signers_count, signers_valid,
 * missing }. Per §1.7.6 missing cross-attestation is a SIGNAL, not
 * invalidation: legacy single-signer transaction records remain
 * cryptographically valid via the top-level `signature`.
 *
 * The corpus exercises five cases:
 *
 *   1. legacy-single-signer       — transaction record without signers[]
 *   2. one-signer                 — signers_count=1, missing=true
 *   3. two-signers-valid          — signers_count=2, missing=false (the canonical happy path)
 *   4. three-signers              — signers_count=3, missing=false
 *   5. tampered-second-signature  — one of two sigs is invalid → signers_valid=1, missing=true
 *
 * Each case fixes the cross-attestation canonical bytes plus the expected
 * `cross_attestation` annotation values. Conforming verifiers MUST produce
 * identical detections.
 *
 * Seeds and timestamps are hardcoded so successive regenerations produce
 * byte-identical files. Re-run when:
 *   - §1.7.6 detection invariant changes
 *   - canonical record format (§1.2 / §1.3) changes
 *   - new test cases are needed
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import {
  base64urlEncode,
  canonicalCrossAttestationInput,
  canonicalRecord,
  genesisChainRoot,
  getPublicKey,
  signRecord,
  type AtribRecord,
} from '@atrib/mcp'
import * as ed from '@noble/ed25519'
import { sha256 } from '@noble/hashes/sha2.js'

const REFERENCE_TIME_MS = Date.UTC(2026, 0, 1, 0, 0, 0)
const ALICE_CONTEXT = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

// Three independent signing keys for the multi-party scenarios.
const AGENT_SEED = new Uint8Array(32).fill(0x11)
const COUNTERPARTY_SEED = new Uint8Array(32).fill(0x22)
const FACILITATOR_SEED = new Uint8Array(32).fill(0x33)

const HERE = dirname(fileURLToPath(import.meta.url))
const CORPUS_ROOT = resolve(HERE, '../../../spec/conformance/1.7.6')
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

interface SignerSpec {
  seed: Uint8Array
  label: string
}

async function buildSignedTransaction(
  contentIdByte: string,
  timestampOffsetMs: number,
  signerSpecs: SignerSpec[],
): Promise<AtribRecord> {
  const firstPub = base64urlEncode(await getPublicKey(signerSpecs[0]!.seed))
  const skeleton: AtribRecord = {
    spec_version: 'atrib/1.0',
    content_id: 'sha256:' + contentIdByte.repeat(32),
    creator_key: firstPub,
    chain_root: genesisChainRoot(ALICE_CONTEXT),
    event_type: 'https://atrib.dev/v1/types/transaction',
    context_id: ALICE_CONTEXT,
    timestamp: REFERENCE_TIME_MS + timestampOffsetMs,
    signature: '',
    signers: [],
  } as AtribRecord
  const canonicalBytes = canonicalCrossAttestationInput(skeleton)
  const signers = []
  for (const spec of signerSpecs) {
    const pub = base64urlEncode(await getPublicKey(spec.seed))
    const sig = base64urlEncode(await ed.signAsync(canonicalBytes, spec.seed))
    signers.push({ creator_key: pub, signature: sig })
  }
  return { ...skeleton, signers } as AtribRecord
}

async function main(): Promise<void> {
  // ── Case 1: legacy-single-signer ────────────────────────────────────
  // Transaction record without signers[]. Signed via the top-level
  // signature only (legacy single-signer path). Verifier MUST surface
  // signers_count: 0, missing: true. Per §1.7.6 the record is still
  // cryptographically valid via signature; missing is a signal.
  const r1Unsigned = {
    spec_version: 'atrib/1.0' as const,
    content_id: 'sha256:' + '01'.repeat(32),
    creator_key: base64urlEncode(await getPublicKey(AGENT_SEED)),
    chain_root: genesisChainRoot(ALICE_CONTEXT),
    event_type: 'https://atrib.dev/v1/types/transaction',
    context_id: ALICE_CONTEXT,
    timestamp: REFERENCE_TIME_MS + 1000,
    signature: '',
  }
  const r1 = await signRecord(r1Unsigned as AtribRecord, AGENT_SEED)
  writeCase('legacy-single-signer', {
    name: 'legacy-single-signer',
    spec_section: '1.7.6',
    description:
      "A transaction record with only the top-level signature field (no signers[] array). Per §1.7.6 verifiers MUST surface signers_count: 0, signers_valid: 0, missing: true. The record remains cryptographically valid via the legacy signature; missing is a signal, not invalidation.",
    input: { record: r1, signer_seed_hex: hex(AGENT_SEED) },
    expected: {
      record_hash_hex: recordHashHex(r1),
      cross_attestation: { signers_count: 0, signers_valid: 0, missing: true },
      verifier_signature_ok: true,
      validator_should_accept: true,
      valid_after_signal: true,
    },
  })

  // ── Case 2: one-signer ──────────────────────────────────────────────
  // signers[] has one entry. Below normative minimum of 2.
  const r2 = await buildSignedTransaction('02', 2000, [{ seed: AGENT_SEED, label: 'agent' }])
  writeCase('one-signer', {
    name: 'one-signer',
    spec_section: '1.7.6',
    description:
      "A transaction record with one signer in signers[]. Below the §1.7.6 normative minimum of 2 signers. Verifier MUST surface signers_count: 1, signers_valid: 1, missing: true.",
    input: { record: r2, signer_seed_hex: hex(AGENT_SEED) },
    expected: {
      record_hash_hex: recordHashHex(r2),
      cross_attestation: { signers_count: 1, signers_valid: 1, missing: true },
      validator_should_accept: true,
      valid_after_signal: true,
    },
  })

  // ── Case 3: two-signers-valid (canonical happy path) ────────────────
  const r3 = await buildSignedTransaction('03', 3000, [
    { seed: AGENT_SEED, label: 'agent' },
    { seed: COUNTERPARTY_SEED, label: 'counterparty' },
  ])
  writeCase('two-signers-valid', {
    name: 'two-signers-valid',
    spec_section: '1.7.6',
    description:
      "The canonical happy path: a transaction record signed by two independent parties (agent + counterparty). Verifier MUST surface signers_count: 2, signers_valid: 2, missing: false. Both signers cover the SAME cross-attestation canonical bytes per §1.7.6 (JCS form with signers: [] and top-level signature omitted).",
    input: {
      record: r3,
      signer_seeds_hex: { agent: hex(AGENT_SEED), counterparty: hex(COUNTERPARTY_SEED) },
    },
    expected: {
      record_hash_hex: recordHashHex(r3),
      cross_attestation: { signers_count: 2, signers_valid: 2, missing: false },
      validator_should_accept: true,
    },
  })

  // ── Case 4: three-signers ───────────────────────────────────────────
  const r4 = await buildSignedTransaction('04', 4000, [
    { seed: AGENT_SEED, label: 'agent' },
    { seed: COUNTERPARTY_SEED, label: 'counterparty' },
    { seed: FACILITATOR_SEED, label: 'facilitator' },
  ])
  writeCase('three-signers', {
    name: 'three-signers',
    spec_section: '1.7.6',
    description:
      "A transaction record signed by three independent parties (agent + counterparty + a third facilitator/witness). Verifier MUST surface signers_count: 3, signers_valid: 3, missing: false. Demonstrates that the §1.7.6 minimum of 2 is a floor, not a cap; consumers can require higher thresholds via policy.",
    input: {
      record: r4,
      signer_seeds_hex: {
        agent: hex(AGENT_SEED),
        counterparty: hex(COUNTERPARTY_SEED),
        facilitator: hex(FACILITATOR_SEED),
      },
    },
    expected: {
      record_hash_hex: recordHashHex(r4),
      cross_attestation: { signers_count: 3, signers_valid: 3, missing: false },
      validator_should_accept: true,
    },
  })

  // ── Case 5: tampered-second-signature ──────────────────────────────
  // Two signers attached, but the second signature is invalid (first
  // character flipped). signers_valid: 1, missing: true.
  const r5Pristine = await buildSignedTransaction('05', 5000, [
    { seed: AGENT_SEED, label: 'agent' },
    { seed: COUNTERPARTY_SEED, label: 'counterparty' },
  ])
  const tamperedSig = 'A' + r5Pristine.signers![1]!.signature.slice(1)
  const r5 = {
    ...r5Pristine,
    signers: [
      r5Pristine.signers![0]!,
      { ...r5Pristine.signers![1]!, signature: tamperedSig },
    ],
  } as AtribRecord
  writeCase('tampered-second-signature', {
    name: 'tampered-second-signature',
    spec_section: '1.7.6',
    description:
      "A transaction record with two signers attached but the second signature has been tampered (first base64url char replaced). Verifier MUST surface signers_count: 2, signers_valid: 1, missing: true. Demonstrates that 'count' and 'valid' are independent: a cosigner cannot inflate signers_valid by attaching a bogus signature.",
    input: {
      record: r5,
      signer_seeds_hex: { agent: hex(AGENT_SEED) /* counterparty seed unused; sig was tampered */ },
    },
    expected: {
      record_hash_hex: recordHashHex(r5),
      cross_attestation: { signers_count: 2, signers_valid: 1, missing: true },
      validator_should_accept: true,
      valid_after_signal: true,
    },
  })

  // ── Manifest ───────────────────────────────────────────────────────
  const manifest = {
    spec_section: '1.7.6',
    spec_title: 'Cross-attestation requirement for transaction records',
    decision_link: 'D052',
    generated_at: REFERENCE_TIME_MS,
    generator: 'packages/log-dev/scripts/generate-conformance-1.7.6.ts',
    cases: [
      { file: 'cases/legacy-single-signer.json', name: 'legacy-single-signer' },
      { file: 'cases/one-signer.json', name: 'one-signer' },
      { file: 'cases/two-signers-valid.json', name: 'two-signers-valid' },
      { file: 'cases/three-signers.json', name: 'three-signers' },
      { file: 'cases/tampered-second-signature.json', name: 'tampered-second-signature' },
    ],
    keys: {
      agent_pubkey: base64urlEncode(await getPublicKey(AGENT_SEED)),
      counterparty_pubkey: base64urlEncode(await getPublicKey(COUNTERPARTY_SEED)),
      facilitator_pubkey: base64urlEncode(await getPublicKey(FACILITATOR_SEED)),
    },
    note: 'The five cases collectively exercise the §1.7.6 cross_attestation algorithm: legacy single-sig (case 1), below-minimum signer counts (cases 1-2), the canonical happy path (case 3), above-minimum (case 4), and tamper-detection (case 5). Per §1.7.6 missing cross-attestation is a signal, not invalidation: legacy and tampered records remain cryptographically valid via the underlying signature.',
  }

  writeFileSync(join(CORPUS_ROOT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')

  console.log(`generated ${manifest.cases.length} cases at ${CORPUS_ROOT}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
