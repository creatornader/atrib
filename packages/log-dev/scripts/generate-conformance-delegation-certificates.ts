/**
 * Generate the delegation-certificates conformance corpus (spec §1.11, P045).
 *
 * Run with:
 *   pnpm --filter @atrib/log-dev exec tsx scripts/generate-conformance-delegation-certificates.ts
 *
 * Output: spec/conformance/delegation-certificates/cases/*.json + manifest.json
 *
 * The corpus exercises the delegation-certificate contract:
 *
 *   A. Certificate canonical form and signing. JCS field order
 *      (cert_type < context_id < not_after < not_before < principal_key
 *      < run_pubkey < scope < signature), absence-not-null for every
 *      optional field, real Ed25519 principal signatures over the JCS
 *      signing input, cert_hash over the signed bytes, self-certificate
 *      and wrong-signer rejection.
 *   B. Verifier walk (record -> run key -> certificate -> principal):
 *      valid depth-1 resolution, expired window, scope mismatch as a
 *      signal (never invalidation, §6.7.3 posture), wrong principal
 *      signature falling back to depth 0, run-key/certificate mismatch
 *      surfacing delegation_unresolved.
 *   C. Depth-0 identity. A principal-signed record with no certificate
 *      verifies byte-for-byte as today. The case embeds the first §1.4
 *      signing vector verbatim so the regression pin is literal byte
 *      identity against spec/conformance/1.4/signing-vectors.json.
 *   D. delegation_cert_hash genesis field. JCS-canonical form slots the
 *      field between creator_key and event_type (c-r < d < e); vectors
 *      with and without the field produce distinct signing inputs,
 *      distinct signatures, distinct record hashes.
 *   E. Run-key revocation extending §1.9. A key_revocation record signed
 *      by the principal, carrying delegation_cert_hash referencing the
 *      certificate that proves the principal-run relationship
 *      (§1.9.2 signing rule 3); plus the rejected case where the
 *      referenced certificate does not cover revoked_key.
 *   F. Multi-producer posture (D067). A certified run key joining a
 *      context whose genesis another producer signed: cert_bound stays
 *      null permanently while every other delegation fact evaluates.
 *
 * All keys derive from fixed seeds and all timestamps are hardcoded so
 * successive regenerations produce byte-identical files.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import * as ed from '@noble/ed25519'
import { sha256, sha512 } from '@noble/hashes/sha2.js'
import {
  base64urlEncode,
  canonicalRecord,
  canonicalSigningInput,
  genesisChainRoot,
  getPublicKey,
  signRecord,
  type AtribRecord,
} from '@atrib/mcp'

// @noble/ed25519 v3 needs sha512 wired via the hashes object (idempotent;
// @atrib/mcp wires the same instance at import time).
ed.hashes.sha512 = sha512
ed.hashes.sha512Async = (m) => Promise.resolve(sha512(m))

// ── Fixed seeds (deterministic; never random) ─────────────────────────
const PRINCIPAL_SEED = new Uint8Array(32).fill(0x01)
const RUN_SEED = new Uint8Array(32).fill(0x02)
const OTHER_PRODUCER_SEED = new Uint8Array(32).fill(0x03)
const ROGUE_SEED = new Uint8Array(32).fill(0x04)
const RUN2_SEED = new Uint8Array(32).fill(0x05)

const REFERENCE_TIME_MS = Date.UTC(2026, 0, 1, 0, 0, 0)
const CERT_NOT_BEFORE = REFERENCE_TIME_MS
const CERT_NOT_AFTER = REFERENCE_TIME_MS + 3_600_000 // one hour window

const TOOL_CALL_URI = 'https://atrib.dev/v1/types/tool_call'
const OBSERVATION_URI = 'https://atrib.dev/v1/types/observation'
const KEY_REVOCATION_URI = 'https://atrib.dev/v1/types/key_revocation'

const HERE = dirname(fileURLToPath(import.meta.url))
const CORPUS_ROOT = resolve(HERE, '../../../spec/conformance/delegation-certificates')
const CASES_DIR = join(CORPUS_ROOT, 'cases')
const SIGNING_VECTORS_1_4 = resolve(HERE, '../../../spec/conformance/1.4/signing-vectors.json')

mkdirSync(CASES_DIR, { recursive: true })

// ── Shapes ────────────────────────────────────────────────────────────

/** D051 / §6.7.1 capability envelope schema, reused verbatim as the cert scope. */
interface CapabilityScope {
  tool_names?: string[]
  max_amount?: { currency: string; value: number }
  counterparties?: string[]
  event_types?: string[]
  expires_at?: number
  cost_policy?: { model_tiers?: string[]; max_tokens?: number }
}

/** Delegation certificate per §1.11.1. Optional fields omitted (not null) when absent. */
interface DelegationCertificate {
  cert_type: 'atrib/delegation-cert/v1'
  context_id?: string
  not_after: number
  not_before?: number
  principal_key: string
  run_pubkey: string
  scope?: CapabilityScope
  signature: string
}

type UnsignedCertificate = Omit<DelegationCertificate, 'signature'>

/** Record shapes carrying the OPTIONAL delegation_cert_hash field. */
type DelegatedRecord = AtribRecord & { delegation_cert_hash?: string }
type KeyRevocationRecord = AtribRecord & {
  revoked_key: string
  revocation_reason: 'rotation' | 'retirement' | 'compromise'
  delegation_cert_hash?: string
}

// ── Helpers ───────────────────────────────────────────────────────────

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex')
}

const utf8Decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes)

/**
 * Certificate signing input: JCS(cert with signature omitted), UTF-8 bytes.
 * Reuses the exact record canonicalization path so no second JCS
 * implementation exists (the cert is not a record; the byte rule is shared).
 */
function certSigningInput(cert: UnsignedCertificate): Uint8Array {
  const withSlot = { ...cert, signature: '' }
  return canonicalSigningInput(withSlot as unknown as AtribRecord)
}

/** cert_hash = "sha256:" + hex(SHA-256(UTF-8(JCS(full signed cert)))) — over the SIGNED bytes. */
function certHash(cert: DelegationCertificate): string {
  return 'sha256:' + hex(sha256(canonicalRecord(cert as unknown as AtribRecord)))
}

/** Sign a certificate with a principal seed (Ed25519 over the JCS signing input). */
async function signCertificate(
  cert: UnsignedCertificate,
  principalSeed: Uint8Array,
): Promise<DelegationCertificate> {
  const sig = await ed.signAsync(certSigningInput(cert), principalSeed)
  return { ...cert, signature: base64urlEncode(sig) }
}

function recordHash(record: AtribRecord): string {
  return 'sha256:' + hex(sha256(canonicalRecord(record)))
}

function writeCase(name: string, body: Record<string, unknown>): void {
  writeFileSync(join(CASES_DIR, `${name}.json`), JSON.stringify(body, null, 2) + '\n')
}

/** Minimal projection of the §1.4 signing-vectors file consumed by the depth-0 case. */
interface SigningVectorFile {
  vectors: {
    name: string
    input: { private_key_seed_hex: string; record: Record<string, unknown> }
    expected: {
      public_key_hex: string
      canonical_signing_input: string
      signature_base64url: string
      record_hash_hex: string
      verification_passes: boolean
    }
  }[]
}

async function main(): Promise<void> {
  const principalKey = base64urlEncode(await getPublicKey(PRINCIPAL_SEED))
  const runKey = base64urlEncode(await getPublicKey(RUN_SEED))
  const otherProducerKey = base64urlEncode(await getPublicKey(OTHER_PRODUCER_SEED))
  const rogueKey = base64urlEncode(await getPublicKey(ROGUE_SEED))
  const run2Key = base64urlEncode(await getPublicKey(RUN2_SEED))

  const SCOPE: CapabilityScope = {
    tool_names: ['search', 'read_email'],
    max_amount: { currency: 'USD', value: 100 },
    event_types: [TOOL_CALL_URI, OBSERVATION_URI],
  }

  // ══ Family A: certificate canonical form and signing ═════════════════

  // ── Case: cert-canonical-full ─────────────────────────────────────
  const ctxA1 = 'a1'.repeat(16)
  const certFull = await signCertificate(
    {
      cert_type: 'atrib/delegation-cert/v1',
      context_id: ctxA1,
      not_after: CERT_NOT_AFTER,
      not_before: CERT_NOT_BEFORE,
      principal_key: principalKey,
      run_pubkey: runKey,
      scope: SCOPE,
    },
    PRINCIPAL_SEED,
  )
  writeCase('cert-canonical-full', {
    name: 'cert-canonical-full',
    spec_section: '1.11',
    description:
      'A delegation certificate with every optional field present (context_id, not_before, scope). Pins the JCS canonical form (cert_type < context_id < not_after < not_before < principal_key < run_pubkey < scope < signature), the Ed25519 principal signature over the signing input, and the cert_hash over the signed bytes. Verifiers MUST accept this certificate as delegation evidence.',
    input: {
      certificate: certFull,
      principal_seed_hex: hex(PRINCIPAL_SEED),
      run_seed_hex: hex(RUN_SEED),
    },
    expected: {
      canonical_signing_input_utf8: utf8Decode(certSigningInput(certFull)),
      canonical_signed_form_utf8: utf8Decode(canonicalRecord(certFull as unknown as AtribRecord)),
      cert_hash: certHash(certFull),
      principal_signature_verifies: true,
      cert_valid: true,
      jcs_field_order: [
        'cert_type',
        'context_id',
        'not_after',
        'not_before',
        'principal_key',
        'run_pubkey',
        'scope',
        'signature',
      ],
    },
  })

  // ── Case: cert-canonical-minimal ──────────────────────────────────
  // Same principal/run pair, no optional fields. Absence-not-null: the
  // canonical form omits context_id/not_before/scope entirely, so the
  // signing input, signature, and cert_hash all differ from the full form.
  const certMinimal = await signCertificate(
    {
      cert_type: 'atrib/delegation-cert/v1',
      not_after: CERT_NOT_AFTER,
      principal_key: principalKey,
      run_pubkey: runKey,
    },
    PRINCIPAL_SEED,
  )
  writeCase('cert-canonical-minimal', {
    name: 'cert-canonical-minimal',
    spec_section: '1.11',
    description:
      'A delegation certificate with every optional field absent. Optional fields MUST be omitted, not null: the canonical signing input contains no context_id, not_before, or scope key, producing a different signature and cert_hash than the full form. not_before defaults to 0 when absent.',
    input: {
      certificate: certMinimal,
      principal_seed_hex: hex(PRINCIPAL_SEED),
    },
    expected: {
      canonical_signing_input_utf8: utf8Decode(certSigningInput(certMinimal)),
      cert_hash: certHash(certMinimal),
      principal_signature_verifies: true,
      cert_valid: true,
      optional_fields_in_canonical_form: false,
      differs_from_full_form_cert_hash: certHash(certFull),
    },
  })

  // ── Case: cert-invalid-self ───────────────────────────────────────
  // The principal certifies its own key. The signature is real and
  // verifies; the certificate is nevertheless invalid as delegation
  // evidence (run_pubkey MUST NOT equal principal_key).
  const certSelf = await signCertificate(
    {
      cert_type: 'atrib/delegation-cert/v1',
      not_after: CERT_NOT_AFTER,
      principal_key: principalKey,
      run_pubkey: principalKey,
    },
    PRINCIPAL_SEED,
  )
  writeCase('cert-invalid-self', {
    name: 'cert-invalid-self',
    spec_section: '1.11',
    description:
      'A self-certificate: run_pubkey equals principal_key, correctly signed by the principal. The signature verifies, but verifiers MUST reject the certificate as delegation evidence with error self_certificate. Records signed by the key remain valid at depth 0.',
    input: { certificate: certSelf },
    expected: {
      cert_hash: certHash(certSelf),
      principal_signature_verifies: true,
      cert_valid: false,
      errors: ['self_certificate'],
    },
  })

  // ── Case: cert-invalid-wrong-signer ───────────────────────────────
  // The certificate names principalKey as principal but was signed by a
  // rogue key. The declared principal's signature does not verify.
  const certWrongSignerUnsigned: UnsignedCertificate = {
    cert_type: 'atrib/delegation-cert/v1',
    not_after: CERT_NOT_AFTER,
    principal_key: principalKey,
    run_pubkey: runKey,
  }
  const certWrongSigner = await signCertificate(certWrongSignerUnsigned, ROGUE_SEED)
  writeCase('cert-invalid-wrong-signer', {
    name: 'cert-invalid-wrong-signer',
    spec_section: '1.11',
    description:
      'A certificate whose signature bytes were produced by a key other than the declared principal_key. Verification under principal_key MUST fail; verifiers MUST reject the certificate as delegation evidence with error principal_signature_invalid.',
    input: { certificate: certWrongSigner, actual_signer_pubkey: rogueKey },
    expected: {
      cert_hash: certHash(certWrongSigner),
      principal_signature_verifies: false,
      cert_valid: false,
      errors: ['principal_signature_invalid'],
    },
  })

  // ══ Family B: verifier walk ══════════════════════════════════════════

  // Helper: build + sign a genesis tool_call record by the run key,
  // optionally committing to a certificate via delegation_cert_hash.
  async function runKeyGenesis(
    contextId: string,
    contentByte: string,
    timestamp: number,
    toolName: string,
    certForHash: DelegationCertificate | null,
    seed: Uint8Array,
    creatorKey: string,
  ): Promise<DelegatedRecord> {
    const unsigned: DelegatedRecord = {
      spec_version: 'atrib/1.0',
      content_id: 'sha256:' + contentByte.repeat(32),
      creator_key: creatorKey,
      chain_root: genesisChainRoot(contextId),
      event_type: TOOL_CALL_URI,
      context_id: contextId,
      timestamp,
      tool_name: toolName,
      signature: '',
      ...(certForHash ? { delegation_cert_hash: certHash(certForHash) } : {}),
    }
    return (await signRecord(unsigned, seed)) as DelegatedRecord
  }

  // ── Case: walk-valid ──────────────────────────────────────────────
  const ctxB1 = 'b1'.repeat(16)
  const certB1 = await signCertificate(
    {
      cert_type: 'atrib/delegation-cert/v1',
      context_id: ctxB1,
      not_after: CERT_NOT_AFTER,
      not_before: CERT_NOT_BEFORE,
      principal_key: principalKey,
      run_pubkey: runKey,
      scope: SCOPE,
    },
    PRINCIPAL_SEED,
  )
  const walkValidRecord = await runKeyGenesis(
    ctxB1,
    'e1',
    REFERENCE_TIME_MS + 60_000,
    'search',
    certB1,
    RUN_SEED,
    runKey,
  )
  writeCase('walk-valid', {
    name: 'walk-valid',
    spec_section: '1.11',
    description:
      'Depth-1 happy path. A genesis tool_call signed by the run key, committing to its own certificate via delegation_cert_hash. The walk resolves record -> run key -> certificate -> principal: cert valid, in window, context-bound, cert-bound, in scope, not revoked. Record signature verification is unchanged by every delegation fact.',
    input: {
      record: walkValidRecord,
      genesis_record: walkValidRecord,
      certificates: [certB1],
    },
    expected: {
      record_signature_valid: true,
      record_hash: recordHash(walkValidRecord),
      delegation: {
        depth: 1,
        principal_key: principalKey,
        cert_hash: certHash(certB1),
        cert_valid: true,
        in_window: true,
        context_bound: true,
        cert_bound: true,
        scope_check: { in_scope: true, attenuation_ok: null, mismatches: [] },
        revoked: false,
        errors: [],
      },
    },
  })

  // ── Case: walk-expired ────────────────────────────────────────────
  const ctxB2 = 'b2'.repeat(16)
  const certB2 = await signCertificate(
    {
      cert_type: 'atrib/delegation-cert/v1',
      context_id: ctxB2,
      not_after: CERT_NOT_AFTER,
      not_before: CERT_NOT_BEFORE,
      principal_key: principalKey,
      run_pubkey: runKey,
      scope: SCOPE,
    },
    PRINCIPAL_SEED,
  )
  const walkExpiredRecord = await runKeyGenesis(
    ctxB2,
    'e2',
    CERT_NOT_AFTER + 60_000, // one minute past the window
    'search',
    certB2,
    RUN_SEED,
    runKey,
  )
  writeCase('walk-expired', {
    name: 'walk-expired',
    spec_section: '1.11',
    description:
      'Out-of-window record: timestamp > not_after. in_window is false; every other delegation fact still evaluates and the record signature remains valid. Window facts are signals, never invalidation.',
    input: {
      record: walkExpiredRecord,
      genesis_record: walkExpiredRecord,
      certificates: [certB2],
    },
    expected: {
      record_signature_valid: true,
      record_hash: recordHash(walkExpiredRecord),
      delegation: {
        depth: 1,
        principal_key: principalKey,
        cert_hash: certHash(certB2),
        cert_valid: true,
        in_window: false,
        context_bound: true,
        cert_bound: true,
        scope_check: { in_scope: true, attenuation_ok: null, mismatches: [] },
        revoked: false,
        errors: [],
      },
    },
  })

  // ── Case: walk-scope-mismatch ─────────────────────────────────────
  const ctxB3 = 'b3'.repeat(16)
  const certB3 = await signCertificate(
    {
      cert_type: 'atrib/delegation-cert/v1',
      context_id: ctxB3,
      not_after: CERT_NOT_AFTER,
      not_before: CERT_NOT_BEFORE,
      principal_key: principalKey,
      run_pubkey: runKey,
      scope: SCOPE,
    },
    PRINCIPAL_SEED,
  )
  const walkScopeMismatchRecord = await runKeyGenesis(
    ctxB3,
    'e3',
    REFERENCE_TIME_MS + 60_000,
    'send_payment', // not in scope.tool_names
    certB3,
    RUN_SEED,
    runKey,
  )
  writeCase('walk-scope-mismatch', {
    name: 'walk-scope-mismatch',
    spec_section: '1.11',
    description:
      "Out-of-scope record: tool_name 'send_payment' is not in the certificate's scope.tool_names. scope_check.in_scope is false with mismatch 'tool_names'. Per the §6.7.3 posture this is a SIGNAL, not invalidation: the record signature stays valid and depth-1 resolution still holds.",
    input: {
      record: walkScopeMismatchRecord,
      genesis_record: walkScopeMismatchRecord,
      certificates: [certB3],
    },
    expected: {
      record_signature_valid: true,
      record_hash: recordHash(walkScopeMismatchRecord),
      signal_not_block: true,
      delegation: {
        depth: 1,
        principal_key: principalKey,
        cert_hash: certHash(certB3),
        cert_valid: true,
        in_window: true,
        context_bound: true,
        cert_bound: true,
        scope_check: { in_scope: false, attenuation_ok: null, mismatches: ['tool_names'] },
        revoked: false,
        errors: [],
      },
    },
  })

  // ── Case: walk-scope-cost-policy ──────────────────────────────────
  const ctxC9 = 'c9'.repeat(16)
  const certC9 = await signCertificate(
    {
      cert_type: 'atrib/delegation-cert/v1',
      context_id: ctxC9,
      not_after: CERT_NOT_AFTER,
      not_before: CERT_NOT_BEFORE,
      principal_key: principalKey,
      run_pubkey: runKey,
      scope: {
        tool_names: ['search', 'read_email'],
        cost_policy: { model_tiers: ['economy', 'standard'], max_tokens: 500_000 },
      },
    },
    PRINCIPAL_SEED,
  )
  const walkCostPolicyRecord = await runKeyGenesis(
    ctxC9,
    'c9',
    REFERENCE_TIME_MS + 60_000,
    'search',
    certC9,
    RUN_SEED,
    runKey,
  )
  writeCase('walk-scope-cost-policy', {
    name: 'walk-scope-cost-policy',
    spec_section: '1.11',
    description:
      'A certificate whose scope carries the D165 cost_policy sub-field (model_tiers allowlist, max_tokens budget). From the record alone the walk reports no cost_policy mismatch: signed records carry neither model tier nor token spend, so cost_policy is evaluable only against caller-supplied usage facts (checkCostPolicy, §6.7.2). The usage_vectors pin that evaluation: within-grant usage is in scope; a tier outside the allowlist plus spend over the budget produce both mismatches. Signals, never invalidation (§6.7.3): the record signature and depth-1 resolution are unaffected.',
    input: {
      record: walkCostPolicyRecord,
      genesis_record: walkCostPolicyRecord,
      certificates: [certC9],
      usage_vectors: [
        {
          name: 'within-grant',
          usage: { model_tier: 'standard', tokens_spent: 120_000 },
          expected: { in_scope: true, mismatches: [] },
        },
        {
          name: 'tier-and-budget-exceeded',
          usage: { model_tier: 'premium', tokens_spent: 500_001 },
          expected: {
            in_scope: false,
            mismatches: ['cost_policy.model_tiers', 'cost_policy.max_tokens'],
          },
        },
      ],
    },
    expected: {
      record_signature_valid: true,
      record_hash: recordHash(walkCostPolicyRecord),
      signal_not_block: true,
      delegation: {
        depth: 1,
        principal_key: principalKey,
        cert_hash: certHash(certC9),
        cert_valid: true,
        in_window: true,
        context_bound: true,
        cert_bound: true,
        scope_check: { in_scope: true, attenuation_ok: null, mismatches: [] },
        revoked: false,
        errors: [],
      },
    },
  })

  // ── Case: walk-wrong-principal-signature ──────────────────────────
  const ctxB4 = 'b4'.repeat(16)
  const certB4Bad = await signCertificate(
    {
      cert_type: 'atrib/delegation-cert/v1',
      context_id: ctxB4,
      not_after: CERT_NOT_AFTER,
      not_before: CERT_NOT_BEFORE,
      principal_key: principalKey,
      run_pubkey: runKey,
      scope: SCOPE,
    },
    ROGUE_SEED, // signature does NOT verify under principal_key
  )
  const walkBadCertRecord = await runKeyGenesis(
    ctxB4,
    'e4',
    REFERENCE_TIME_MS + 60_000,
    'search',
    certB4Bad,
    RUN_SEED,
    runKey,
  )
  writeCase('walk-wrong-principal-signature', {
    name: 'walk-wrong-principal-signature',
    spec_section: '1.11',
    description:
      'The only certificate covering the run key carries a signature that does not verify under its declared principal_key. The certificate is rejected as delegation evidence (principal_signature_invalid) and the record falls back to depth 0: plain attribution to its signing key, signature validity unchanged.',
    input: {
      record: walkBadCertRecord,
      genesis_record: walkBadCertRecord,
      certificates: [certB4Bad],
    },
    expected: {
      record_signature_valid: true,
      record_hash: recordHash(walkBadCertRecord),
      delegation: {
        depth: 0,
        principal_key: null,
        cert_hash: certHash(certB4Bad),
        cert_valid: false,
        in_window: null,
        context_bound: null,
        cert_bound: null,
        scope_check: null,
        revoked: null,
        errors: ['principal_signature_invalid'],
      },
    },
  })

  // ── Case: walk-run-key-mismatch ───────────────────────────────────
  // The available certificate certifies run2Key; the record is signed by
  // runKey and its genesis delegation_cert_hash names that certificate.
  // No certificate covers the signing key -> depth 0, and because the
  // genesis committed to a certificate that did not resolve for its own
  // signer, delegation_unresolved surfaces (signal, D113 posture).
  const ctxB5 = 'b5'.repeat(16)
  const certB5Run2 = await signCertificate(
    {
      cert_type: 'atrib/delegation-cert/v1',
      context_id: ctxB5,
      not_after: CERT_NOT_AFTER,
      not_before: CERT_NOT_BEFORE,
      principal_key: principalKey,
      run_pubkey: run2Key,
      scope: SCOPE,
    },
    PRINCIPAL_SEED,
  )
  const walkMismatchRecord = await runKeyGenesis(
    ctxB5,
    'e5',
    REFERENCE_TIME_MS + 60_000,
    'search',
    certB5Run2, // genesis commits to a cert that does NOT cover runKey
    RUN_SEED,
    runKey,
  )
  writeCase('walk-run-key-mismatch', {
    name: 'walk-run-key-mismatch',
    spec_section: '1.11',
    description:
      "The record's creator_key differs from the certified run_pubkey. The certificate MUST NOT be selected for this record; the walk returns depth 0. Because the genesis carries a delegation_cert_hash that resolved to no certificate covering the signing key, delegation_unresolved is true (signal, not invalidation).",
    input: {
      record: walkMismatchRecord,
      genesis_record: walkMismatchRecord,
      certificates: [certB5Run2],
    },
    expected: {
      record_signature_valid: true,
      record_hash: recordHash(walkMismatchRecord),
      delegation: {
        depth: 0,
        principal_key: null,
        cert_hash: null,
        cert_valid: null,
        in_window: null,
        context_bound: null,
        cert_bound: null,
        scope_check: null,
        revoked: null,
        errors: [],
        delegation_unresolved: true,
      },
    },
  })

  // ══ Family C: depth-0 identity (byte-identity against §1.4) ══════════

  const signingVectors = JSON.parse(readFileSync(SIGNING_VECTORS_1_4, 'utf8')) as SigningVectorFile
  const v0 = signingVectors.vectors[0]
  if (!v0) throw new Error('spec/conformance/1.4/signing-vectors.json has no vectors')
  // The §1.4 vector's input.record carries signature: "" (signing is the
  // exercise there); the signed form is input.record + expected signature.
  const depth0Record = { ...v0.input.record, signature: v0.expected.signature_base64url }
  writeCase('depth0-identity', {
    name: 'depth0-identity',
    spec_section: '1.11',
    description:
      'Depth-0 identity regression pin. A principal-signed record with no delegation certificate verifies EXACTLY as today: the embedded record, canonical signing input, signature, and record hash are copied verbatim from spec/conformance/1.4/signing-vectors.json (first vector) and MUST remain byte-identical to that corpus. Every record ever signed is already valid under the delegation model, by definition.',
    input: {
      source: 'spec/conformance/1.4/signing-vectors.json',
      source_vector_name: v0.name,
      source_vector_index: 0,
      record: depth0Record,
      certificates: [],
    },
    expected: {
      canonical_signing_input: v0.expected.canonical_signing_input,
      signature_base64url: v0.expected.signature_base64url,
      record_hash_hex: v0.expected.record_hash_hex,
      record_signature_valid: v0.expected.verification_passes,
      byte_identical_to_1_4_vector: true,
      delegation: {
        depth: 0,
        principal_key: null,
        cert_hash: null,
        cert_valid: null,
        in_window: null,
        context_bound: null,
        cert_bound: null,
        scope_check: null,
        revoked: null,
        errors: [],
      },
    },
  })

  // ══ Family D: delegation_cert_hash genesis field lex slotting ════════

  const ctxB6 = 'b6'.repeat(16)
  const certB6 = await signCertificate(
    {
      cert_type: 'atrib/delegation-cert/v1',
      context_id: ctxB6,
      not_after: CERT_NOT_AFTER,
      not_before: CERT_NOT_BEFORE,
      principal_key: principalKey,
      run_pubkey: runKey,
      scope: SCOPE,
    },
    PRINCIPAL_SEED,
  )
  const genesisTimestamp = REFERENCE_TIME_MS + 60_000
  const genesisWithField = await runKeyGenesis(
    ctxB6,
    'e6',
    genesisTimestamp,
    'search',
    certB6,
    RUN_SEED,
    runKey,
  )
  const genesisWithoutField = await runKeyGenesis(
    ctxB6,
    'e6',
    genesisTimestamp,
    'search',
    null,
    RUN_SEED,
    runKey,
  )
  writeCase('genesis-field-canonical-form', {
    name: 'genesis-field-canonical-form',
    spec_section: '1.11',
    description:
      'JCS lex-slotting of the OPTIONAL delegation_cert_hash genesis field. Two genesis records identical except for the field: the with-field canonical form slots delegation_cert_hash between creator_key (c-r) and event_type (e); the without-field form omits it entirely (never null). Presence/absence changes the canonical bytes, so the two records carry DISTINCT signatures and DISTINCT record hashes. Records that omit the field are byte-identical to pre-delegation output.',
    input: {
      record_with_field: genesisWithField,
      record_without_field: genesisWithoutField,
      run_seed_hex: hex(RUN_SEED),
      certificate: certB6,
    },
    expected: {
      with_field_canonical_signing_input_utf8: utf8Decode(canonicalSigningInput(genesisWithField)),
      without_field_canonical_signing_input_utf8: utf8Decode(
        canonicalSigningInput(genesisWithoutField),
      ),
      field_slots_after: 'creator_key',
      field_slots_before: 'event_type',
      with_field_record_hash: recordHash(genesisWithField),
      without_field_record_hash: recordHash(genesisWithoutField),
      signatures_distinct: true,
      record_hashes_distinct: true,
      delegation_cert_hash: certHash(certB6),
    },
  })

  // ══ Family E: run-key revocation extending §1.9 ══════════════════════

  // ── Case: revocation-run-key ──────────────────────────────────────
  // Sequence: genesis-with-cert by run key (pre), tool_call by run key
  // (pre), key_revocation signed by the PRINCIPAL carrying
  // delegation_cert_hash (§1.9.2 signing rule 3), tool_call by run key
  // (post; flips to revoked_after_revocation per §1.9.3).
  const ctxB7 = 'b7'.repeat(16)
  const certB7 = await signCertificate(
    {
      cert_type: 'atrib/delegation-cert/v1',
      context_id: ctxB7,
      not_after: CERT_NOT_AFTER,
      not_before: CERT_NOT_BEFORE,
      principal_key: principalKey,
      run_pubkey: runKey,
      scope: SCOPE,
    },
    PRINCIPAL_SEED,
  )
  const rev0 = await runKeyGenesis(
    ctxB7,
    'f0',
    REFERENCE_TIME_MS + 1_000,
    'search',
    certB7,
    RUN_SEED,
    runKey,
  )
  const rev1 = (await signRecord(
    {
      spec_version: 'atrib/1.0',
      content_id: 'sha256:' + 'f1'.repeat(32),
      creator_key: runKey,
      chain_root: genesisChainRoot(ctxB7),
      event_type: TOOL_CALL_URI,
      context_id: ctxB7,
      timestamp: REFERENCE_TIME_MS + 2_000,
      tool_name: 'search',
      signature: '',
    },
    RUN_SEED,
  )) as AtribRecord
  const revocationUnsigned: KeyRevocationRecord = {
    spec_version: 'atrib/1.0',
    content_id: 'sha256:' + 'f2'.repeat(32),
    creator_key: principalKey,
    chain_root: genesisChainRoot(ctxB7),
    delegation_cert_hash: certHash(certB7),
    event_type: KEY_REVOCATION_URI,
    context_id: ctxB7,
    timestamp: REFERENCE_TIME_MS + 3_000,
    revoked_key: runKey,
    revocation_reason: 'compromise',
    signature: '',
  }
  const revocation = (await signRecord(revocationUnsigned, PRINCIPAL_SEED)) as KeyRevocationRecord
  const rev3 = (await signRecord(
    {
      spec_version: 'atrib/1.0',
      content_id: 'sha256:' + 'f3'.repeat(32),
      creator_key: runKey,
      chain_root: genesisChainRoot(ctxB7),
      event_type: TOOL_CALL_URI,
      context_id: ctxB7,
      timestamp: REFERENCE_TIME_MS + 4_000,
      tool_name: 'search',
      signature: '',
    },
    RUN_SEED,
  )) as AtribRecord

  writeCase('revocation-run-key', {
    name: 'revocation-run-key',
    spec_section: '1.11',
    description:
      'Principal-signed run-key revocation per §1.9.2 signing rule 3. The key_revocation record is signed by the principal key of the delegation certificate covering revoked_key and carries delegation_cert_hash referencing that certificate. Verifiers MUST resolve the certificate before accepting the principal as an authorized revoker. JCS-canonical form slots delegation_cert_hash between creator_key and event_type. Run-key records at log_index >= the revocation flip to revoked_after_revocation per §1.9.3; earlier records keep their state.',
    input: {
      log_entries: [
        { log_index: 0, record: rev0, comment: 'pre-revocation genesis-with-cert by run key' },
        { log_index: 1, record: rev1, comment: 'pre-revocation tool_call by run key' },
        {
          log_index: 2,
          record: revocation,
          comment: 'key_revocation signed by principal (rule 3)',
        },
        { log_index: 3, record: rev3, comment: 'post-revocation tool_call by run key' },
      ],
      certificates: [certB7],
    },
    expected: {
      revocation_canonical_signing_input_utf8: utf8Decode(
        canonicalSigningInput(revocation),
      ),
      revocation_signature_valid: true,
      revoker_authorized: true,
      revoker_rule: 'principal_via_delegation_certificate',
      field_slots_after: 'creator_key',
      field_slots_before: 'event_type',
      record_hashes: {
        '0': recordHash(rev0),
        '1': recordHash(rev1),
        '2': recordHash(revocation),
        '3': recordHash(rev3),
      },
      verification_states: {
        '0': 'signature_valid',
        '1': 'signature_valid',
        '2': 'signature_valid',
        '3': 'revoked_after_revocation',
      },
    },
  })

  // ── Case: revocation-cert-not-covering ────────────────────────────
  // The principal signs a revocation for run2Key but references the
  // certificate covering runKey. The referenced certificate does not
  // cover revoked_key, so the revoker is NOT authorized; the revocation
  // is invalid per §1.9.2 and run2 records keep their state.
  const ctxB8 = 'b8'.repeat(16)
  const run2Record0 = (await signRecord(
    {
      spec_version: 'atrib/1.0',
      content_id: 'sha256:' + 'f5'.repeat(32),
      creator_key: run2Key,
      chain_root: genesisChainRoot(ctxB8),
      event_type: TOOL_CALL_URI,
      context_id: ctxB8,
      timestamp: REFERENCE_TIME_MS + 1_000,
      tool_name: 'search',
      signature: '',
    },
    RUN2_SEED,
  )) as AtribRecord
  const badRevocationUnsigned: KeyRevocationRecord = {
    spec_version: 'atrib/1.0',
    content_id: 'sha256:' + 'f6'.repeat(32),
    creator_key: principalKey,
    chain_root: genesisChainRoot(ctxB8),
    delegation_cert_hash: certHash(certB7), // covers runKey, NOT run2Key
    event_type: KEY_REVOCATION_URI,
    context_id: ctxB8,
    timestamp: REFERENCE_TIME_MS + 2_000,
    revoked_key: run2Key,
    revocation_reason: 'compromise',
    signature: '',
  }
  const badRevocation = (await signRecord(
    badRevocationUnsigned,
    PRINCIPAL_SEED,
  )) as KeyRevocationRecord
  const run2Record2 = (await signRecord(
    {
      spec_version: 'atrib/1.0',
      content_id: 'sha256:' + 'f7'.repeat(32),
      creator_key: run2Key,
      chain_root: genesisChainRoot(ctxB8),
      event_type: TOOL_CALL_URI,
      context_id: ctxB8,
      timestamp: REFERENCE_TIME_MS + 3_000,
      tool_name: 'search',
      signature: '',
    },
    RUN2_SEED,
  )) as AtribRecord

  writeCase('revocation-cert-not-covering', {
    name: 'revocation-cert-not-covering',
    spec_section: '1.11',
    description:
      'A key_revocation signed by a principal whose referenced certificate does NOT cover revoked_key (cert.run_pubkey differs). The revoker is not authorized; per §1.9.2 the revocation is invalid and MUST be rejected by verifiers. Records signed by revoked_key keep their verification state.',
    input: {
      log_entries: [
        { log_index: 0, record: run2Record0, comment: 'tool_call by run2 key' },
        {
          log_index: 1,
          record: badRevocation,
          comment: 'invalid key_revocation: referenced cert covers a different run key',
        },
        { log_index: 2, record: run2Record2, comment: 'later tool_call by run2 key (unaffected)' },
      ],
      certificates: [certB7],
    },
    expected: {
      revocation_signature_valid: true,
      revoker_authorized: false,
      rejection_reason: 'certificate_does_not_cover_revoked_key',
      verification_states: {
        '0': 'signature_valid',
        '1': 'signature_valid',
        '2': 'signature_valid',
      },
    },
  })

  // ══ Family F: multi-producer cert_bound: null posture (D067) ═════════

  const ctxMulti = 'ab'.repeat(16)
  const certMulti = await signCertificate(
    {
      cert_type: 'atrib/delegation-cert/v1',
      context_id: ctxMulti, // substitute session binding for a joining run key
      not_after: CERT_NOT_AFTER,
      not_before: CERT_NOT_BEFORE,
      principal_key: principalKey,
      run_pubkey: runKey,
      scope: SCOPE,
    },
    PRINCIPAL_SEED,
  )
  // Producer A (a different key entirely) signs the context genesis.
  const multiGenesis = (await signRecord(
    {
      spec_version: 'atrib/1.0',
      content_id: 'sha256:' + 'e8'.repeat(32),
      creator_key: otherProducerKey,
      chain_root: genesisChainRoot(ctxMulti),
      event_type: OBSERVATION_URI,
      context_id: ctxMulti,
      timestamp: REFERENCE_TIME_MS + 1_000,
      signature: '',
    },
    OTHER_PRODUCER_SEED,
  )) as AtribRecord
  // The certified run key joins the existing chain (§1.2.3.1 precedence:
  // inbound token / mirror tail -> chain_root = hash of A's genesis).
  // It signs no genesis, so no record of its own may carry
  // delegation_cert_hash; the certificate travels out-of-band.
  const multiJoinRecord = (await signRecord(
    {
      spec_version: 'atrib/1.0',
      content_id: 'sha256:' + 'e9'.repeat(32),
      creator_key: runKey,
      chain_root: recordHash(multiGenesis),
      event_type: TOOL_CALL_URI,
      context_id: ctxMulti,
      timestamp: REFERENCE_TIME_MS + 2_000,
      tool_name: 'search',
      signature: '',
    },
    RUN_SEED,
  )) as AtribRecord

  writeCase('multi-producer-cert-bound-null', {
    name: 'multi-producer-cert-bound-null',
    spec_section: '1.11',
    description:
      "D067 multi-producer posture. A certified run key joins a context whose genesis a DIFFERENT producer key signed. The run key owns no record permitted to carry delegation_cert_hash, so the certificate is supplied out-of-band and cert_bound remains null permanently. Every other fact evaluates: cert_valid, in_window, context_bound (the certificate's context_id is the substitute session binding), scope, revocation.",
    input: {
      record: multiJoinRecord,
      genesis_record: multiGenesis,
      certificates: [certMulti],
    },
    expected: {
      record_signature_valid: true,
      record_hash: recordHash(multiJoinRecord),
      genesis_creator_key: otherProducerKey,
      genesis_signed_by_record_creator: false,
      delegation: {
        depth: 1,
        principal_key: principalKey,
        cert_hash: certHash(certMulti),
        cert_valid: true,
        in_window: true,
        context_bound: true,
        cert_bound: null,
        scope_check: { in_scope: true, attenuation_ok: null, mismatches: [] },
        revoked: false,
        errors: [],
      },
    },
  })

  // ── Edge vectors: malformed keys, ambiguity, and depth limit ──────
  const malformedRunKeyCert = { ...certB1, run_pubkey: 'not-a-base64url-ed25519-key' }
  writeCase('cert-malformed-run-key', {
    name: 'cert-malformed-run-key',
    spec_section: '1.11',
    description:
      'A certificate with a malformed run_pubkey. The verifier reports the named key-format error before attempting signature interpretation.',
    input: { certificate: malformedRunKeyCert },
    expected: { errors: ['run_pubkey_malformed'] },
  })

  const ambiguousCert = await signCertificate(
    {
      cert_type: 'atrib/delegation-cert/v1',
      context_id: ctxB1,
      not_after: CERT_NOT_AFTER,
      not_before: CERT_NOT_BEFORE,
      principal_key: rogueKey,
      run_pubkey: runKey,
      scope: SCOPE,
    },
    ROGUE_SEED,
  )
  writeCase('walk-ambiguous-principals', {
    name: 'walk-ambiguous-principals',
    spec_section: '1.11',
    description:
      'Two valid, overlapping certificates from different principals cover the same run key. The verifier must surface both candidates and resolve neither principal.',
    input: { record: walkValidRecord, genesis_record: walkValidRecord, certificates: [certB1, ambiguousCert] },
    expected: { delegation_ambiguous: true, candidate_count: 2, depth: 0 },
  })

  const ctxDepth = 'd1'.repeat(16)
  const parentCert = await signCertificate(
    {
      cert_type: 'atrib/delegation-cert/v1',
      context_id: ctxDepth,
      not_after: CERT_NOT_AFTER,
      not_before: CERT_NOT_BEFORE,
      principal_key: principalKey,
      run_pubkey: runKey,
      scope: SCOPE,
    },
    PRINCIPAL_SEED,
  )
  const nestedCert = await signCertificate(
    {
      cert_type: 'atrib/delegation-cert/v1',
      context_id: ctxDepth,
      not_after: CERT_NOT_AFTER,
      not_before: CERT_NOT_BEFORE,
      principal_key: runKey,
      run_pubkey: run2Key,
      scope: SCOPE,
    },
    RUN_SEED,
  )
  const depthRecord = await runKeyGenesis(
    ctxDepth,
    'f8',
    REFERENCE_TIME_MS + 60_000,
    'search',
    nestedCert,
    RUN2_SEED,
    run2Key,
  )
  writeCase('walk-depth-limit', {
    name: 'walk-depth-limit',
    spec_section: '1.11',
    description:
      'A would-be two-hop delegation: principal -> run key -> run2 key. §1.11 accepts one delegation hop only, so the covering nested certificate is rejected with delegation_depth_exceeded.',
    input: { record: depthRecord, genesis_record: depthRecord, certificates: [parentCert, nestedCert] },
    expected: { depth: 0, cert_valid: false, errors: ['delegation_depth_exceeded'] },
  })

  // ── Manifest ──────────────────────────────────────────────────────
  const caseNames = [
    'cert-canonical-full',
    'cert-canonical-minimal',
    'cert-invalid-self',
    'cert-invalid-wrong-signer',
    'walk-valid',
    'walk-expired',
    'walk-scope-mismatch',
    'walk-scope-cost-policy',
    'walk-wrong-principal-signature',
    'walk-run-key-mismatch',
    'depth0-identity',
    'genesis-field-canonical-form',
    'revocation-run-key',
    'revocation-cert-not-covering',
    'multi-producer-cert-bound-null',
    'cert-malformed-run-key',
    'walk-ambiguous-principals',
    'walk-depth-limit',
  ]
  const manifest = {
    spec_section: '1.11',
    spec_title: 'Delegation certificates (principal keys certify ephemeral run keys)',
    decision_link: 'P045',
    generated_at: REFERENCE_TIME_MS,
    generator: 'packages/log-dev/scripts/generate-conformance-delegation-certificates.ts',
    cases: caseNames.map((name) => ({ file: `cases/${name}.json`, name })),
    keys: {
      principal_pubkey: principalKey,
      run_pubkey: runKey,
      run2_pubkey: run2Key,
      other_producer_pubkey: otherProducerKey,
      rogue_pubkey: rogueKey,
    },
    note:
      'Six case families: certificate canonical form + signing (4), verifier walk (6), ' +
      'depth-0 byte-identity against spec/conformance/1.4/signing-vectors.json (1), ' +
      'delegation_cert_hash genesis lex-slotting (1), run-key revocation extending ' +
      'spec/conformance/1.9/ (2), D067 multi-producer cert_bound: null posture (1). ' +
      'The principal seed (0x01 fill) deliberately matches the §1.4 corpus signer, so ' +
      'the depth-0 case is literally a principal signing directly. Edge cases pin malformed keys, ' +
      'multiple principal candidates, and the one-hop depth limit.',
  }
  writeFileSync(join(CORPUS_ROOT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')

  console.log(`generated ${manifest.cases.length} cases at ${CORPUS_ROOT}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
