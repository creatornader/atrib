/**
 * Generate spec §6.7 conformance corpus fixtures (capability declarations / D051).
 *
 * Run with: pnpm --filter @atrib/log-dev tsx scripts/generate-conformance-6.7.ts
 *
 * Output: spec/conformance/6.7/cases/*.json + manifest.json
 *
 * §6.7 lets identity claims declare a capability envelope (`event_types`,
 * `tool_names`, `max_amount`, `counterparties`, `expires_at`). Verifiers
 * surface a `capability_check` annotation with `{ envelope, in_envelope,
 * mismatches, unresolvable }` per spec §6.7.2.
 *
 * Per spec §6.7.3 out-of-envelope is a SIGNAL, not invalidation: mismatches
 * do not flip `valid` to false. The corpus exercises every category that
 * shows up in the spec §6.7.2 algorithm:
 *
 *   1. no-envelope-on-claim   , claim with no `capabilities` field
 *   2. empty-envelope         , claim with `capabilities: {}` (per §6.7.1)
 *   3. event-types-hit        , record event_type in allowlist
 *   4. event-types-miss       , record event_type NOT in allowlist
 *   5. expires-at-exceeded    , record timestamp past envelope.expires_at
 *   6. tool-names-unresolvable, tool_call record + tool_names allowlist
 *                                (verifier marks unresolvable per §6.7.2 step 2,
 *                                 since tool_name isn't on the standard record shape)
 *   7. transaction-amount-unresolvable, transaction record + max_amount
 *                                        (verifier marks unresolvable per §6.7.2,
 *                                         since the protocol-event isn't accessible)
 *
 * Each case fixes the input record + identity claim + expected
 * capability_check output, so a third-party verifier can run against the
 * same fixtures and assert the same surface.
 *
 * Seeds and timestamps are hardcoded so successive regenerations produce
 * byte-identical files. Re-run when:
 *   - §6.7 detection algorithm changes
 *   - canonical record format (§1.2 / §1.3) changes
 *   - new test cases are needed
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import {
  base64urlEncode,
  canonicalRecord,
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
const CORPUS_ROOT = resolve(HERE, '../../../spec/conformance/6.7')
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

interface CapabilityEnvelope {
  tool_names?: string[]
  event_types?: string[]
  max_amount?: { currency: string; value: number }
  counterparties?: string[]
  expires_at?: number
}

async function buildRecord(
  contentIdByte: string,
  timestampOffsetMs: number,
  eventType: string,
): Promise<AtribRecord> {
  const aliceKey = base64urlEncode(await getPublicKey(ALICE_SEED))
  const aliceGenesisChainRoot = genesisChainRoot(ALICE_CONTEXT)
  const unsigned = {
    spec_version: 'atrib/1.0' as const,
    content_id: 'sha256:' + contentIdByte.repeat(32),
    creator_key: aliceKey,
    chain_root: aliceGenesisChainRoot,
    event_type: eventType,
    context_id: ALICE_CONTEXT,
    timestamp: REFERENCE_TIME_MS + timestampOffsetMs,
    signature: '',
  }
  return signRecord(unsigned as AtribRecord, ALICE_SEED)
}

async function main(): Promise<void> {
  const aliceKey = base64urlEncode(await getPublicKey(ALICE_SEED))

  // ── Case 1: no-envelope-on-claim ───────────────────────────────────
  // Claim has no `capabilities` field at all. Verifier MUST report
  // `envelope: null, in_envelope: true, mismatches: [], unresolvable: false`.
  const r1 = await buildRecord('01', 1000, 'https://atrib.dev/v1/types/observation')
  writeCase('no-envelope-on-claim', {
    name: 'no-envelope-on-claim',
    spec_section: '6.7',
    description:
      'The signing key\'s identity claim has no `capabilities` field. Verifiers MUST surface envelope: null, in_envelope: true, mismatches: [], unresolvable: false. No constraint declared = trivially in-envelope per §6.7.1.',
    input: {
      record: r1,
      identity_claim: { creator_key: aliceKey },
      signer_seed_hex: hex(ALICE_SEED),
    },
    expected: {
      record_hash_hex: recordHashHex(r1),
      capability_check: {
        envelope: null,
        in_envelope: true,
        mismatches: [],
        unresolvable: false,
      },
      verifier_signature_ok: true,
      validator_should_accept: true,
    },
  })

  // ── Case 2: empty-envelope ─────────────────────────────────────────
  // Claim has `capabilities: {}`. Per §6.7.1: "A claim with capabilities:
  // {} declares no scope." Verifier behavior identical to case 1.
  const r2 = await buildRecord('02', 2000, 'https://atrib.dev/v1/types/observation')
  writeCase('empty-envelope', {
    name: 'empty-envelope',
    spec_section: '6.7',
    description:
      'The signing key\'s claim has `capabilities: {}` (empty envelope). Per §6.7.1 this declares no scope. Verifiers MUST surface envelope: null, in_envelope: true, mismatches: [], unresolvable: false. Behavior identical to no-envelope-on-claim.',
    input: {
      record: r2,
      identity_claim: { creator_key: aliceKey, capabilities: {} as CapabilityEnvelope },
      signer_seed_hex: hex(ALICE_SEED),
    },
    expected: {
      record_hash_hex: recordHashHex(r2),
      capability_check: {
        envelope: null,
        in_envelope: true,
        mismatches: [],
        unresolvable: false,
      },
      verifier_signature_ok: true,
      validator_should_accept: true,
    },
  })

  // ── Case 3: event-types-hit ────────────────────────────────────────
  // Record's event_type is in the allowlist. Verifier MUST surface
  // in_envelope: true, mismatches: [].
  const r3 = await buildRecord('03', 3000, 'https://atrib.dev/v1/types/observation')
  const env3: CapabilityEnvelope = {
    event_types: [
      'https://atrib.dev/v1/types/observation',
      'https://atrib.dev/v1/types/tool_call',
    ],
  }
  writeCase('event-types-hit', {
    name: 'event-types-hit',
    spec_section: '6.7',
    description:
      'Record event_type is in the envelope.event_types allowlist. Verifier MUST surface in_envelope: true, mismatches: [], unresolvable: false. The full envelope is preserved on the result for consumer inspection.',
    input: {
      record: r3,
      identity_claim: { creator_key: aliceKey, capabilities: env3 },
      signer_seed_hex: hex(ALICE_SEED),
    },
    expected: {
      record_hash_hex: recordHashHex(r3),
      capability_check: {
        envelope: env3,
        in_envelope: true,
        mismatches: [],
        unresolvable: false,
      },
      verifier_signature_ok: true,
      validator_should_accept: true,
    },
  })

  // ── Case 4: event-types-miss ───────────────────────────────────────
  // Record's event_type is NOT in the allowlist. Verifier MUST surface
  // in_envelope: false with a mismatch. Per §6.7.3 this is a signal,
  // NOT invalidation: signature stays ok, valid stays true.
  const r4 = await buildRecord('04', 4000, 'https://atrib.dev/v1/types/observation')
  const env4: CapabilityEnvelope = { event_types: ['https://atrib.dev/v1/types/tool_call'] }
  writeCase('event-types-miss', {
    name: 'event-types-miss',
    spec_section: '6.7',
    description:
      "Record event_type is NOT in the envelope.event_types allowlist. Verifier MUST surface in_envelope: false with a mismatch identifying the offending event_type. Per §6.7.3 this is a SIGNAL, not invalidation: the mismatch does NOT flip `valid` to false. Out-of-envelope records remain cryptographically valid; consumers decide policy.",
    input: {
      record: r4,
      identity_claim: { creator_key: aliceKey, capabilities: env4 },
      signer_seed_hex: hex(ALICE_SEED),
    },
    expected: {
      record_hash_hex: recordHashHex(r4),
      capability_check: {
        envelope: env4,
        in_envelope: false,
        mismatches: [
          "event_type 'https://atrib.dev/v1/types/observation' not in allowlist",
        ],
        unresolvable: false,
      },
      verifier_signature_ok: true,
      validator_should_accept: true,
      valid_after_mismatch: true,
    },
  })

  // ── Case 5: expires-at-exceeded ────────────────────────────────────
  // Record timestamp is past envelope.expires_at. Verifier MUST surface
  // in_envelope: false with an `envelope expired` mismatch. Same
  // signal-not-invalidation principle as case 4.
  const r5 = await buildRecord('05', 5000, 'https://atrib.dev/v1/types/observation')
  const env5: CapabilityEnvelope = { expires_at: REFERENCE_TIME_MS + 1000 }
  writeCase('expires-at-exceeded', {
    name: 'expires-at-exceeded',
    spec_section: '6.7',
    description:
      'Record timestamp is past envelope.expires_at. Verifier MUST surface in_envelope: false with an `envelope expired` mismatch. Per §6.7.2: expired envelope is "treated as having no constraint and flagged separately", the mismatch is informational, not invalidating. Signature still ok; valid stays true.',
    input: {
      record: r5,
      identity_claim: { creator_key: aliceKey, capabilities: env5 },
      signer_seed_hex: hex(ALICE_SEED),
    },
    expected: {
      record_hash_hex: recordHashHex(r5),
      capability_check: {
        envelope: env5,
        in_envelope: false,
        mismatches: [
          `envelope expired at ${env5.expires_at}; record timestamp ${REFERENCE_TIME_MS + 5000}`,
        ],
        unresolvable: false,
      },
      verifier_signature_ok: true,
      validator_should_accept: true,
      valid_after_mismatch: true,
    },
  })

  // ── Case 6: tool-names-unresolvable ────────────────────────────────
  // tool_call record + tool_names allowlist. Per §6.7.2 step 2 the
  // tool_names check requires the record's tool_name field, which isn't
  // on the standard AtribRecord shape (current §1.2.1 exposes only the
  // derived content_id). Verifier MUST mark unresolvable: true.
  const r6 = await buildRecord('06', 6000, 'https://atrib.dev/v1/types/tool_call')
  const env6: CapabilityEnvelope = { tool_names: ['allowed_tool', 'another_allowed'] }
  writeCase('tool-names-unresolvable', {
    name: 'tool-names-unresolvable',
    spec_section: '6.7',
    description:
      "A tool_call record with a tool_names envelope constraint. Per §6.7.2 step 2 the constraint requires the record's tool_name field; the standard record shape exposes only the derived content_id (sha256(server_url + tool_name)). Without tool_name on the record, the verifier MUST mark unresolvable: true rather than passing or failing silently. mismatches stays empty (no positive determination either way).",
    input: {
      record: r6,
      identity_claim: { creator_key: aliceKey, capabilities: env6 },
      signer_seed_hex: hex(ALICE_SEED),
    },
    expected: {
      record_hash_hex: recordHashHex(r6),
      capability_check: {
        envelope: env6,
        in_envelope: true,
        mismatches: [],
        unresolvable: true,
      },
      verifier_signature_ok: true,
      validator_should_accept: true,
    },
  })

  // ── Case 7: transaction-amount-unresolvable ─────────────────────────
  // transaction record + max_amount constraint. Per §6.7.2 the verifier
  // MUST resolve the transaction amount from the protocol-specific
  // payment event the record commits to. @atrib/verify doesn't have
  // access to that out-of-band event; mark unresolvable.
  const r7 = await buildRecord('07', 7000, 'https://atrib.dev/v1/types/transaction')
  const env7: CapabilityEnvelope = { max_amount: { currency: 'USD', value: 100 } }
  writeCase('transaction-amount-unresolvable', {
    name: 'transaction-amount-unresolvable',
    spec_section: '6.7',
    description:
      "A transaction record with a max_amount envelope constraint. Per §6.7.2 the verifier MUST resolve the transaction amount from the protocol-specific payment event the record commits to. @atrib/verify doesn't have access to that out-of-band event, so it marks unresolvable: true. Same applies to counterparties constraints on transaction records.",
    input: {
      record: r7,
      identity_claim: { creator_key: aliceKey, capabilities: env7 },
      signer_seed_hex: hex(ALICE_SEED),
    },
    expected: {
      record_hash_hex: recordHashHex(r7),
      capability_check: {
        envelope: env7,
        in_envelope: true,
        mismatches: [],
        unresolvable: true,
      },
      verifier_signature_ok: true,
      validator_should_accept: true,
    },
  })

  // ── Manifest ───────────────────────────────────────────────────────
  const manifest = {
    spec_section: '6.7',
    spec_title: 'Capability declarations (envelope-scoped records)',
    decision_link: 'D051',
    generated_at: REFERENCE_TIME_MS,
    generator: 'packages/log-dev/scripts/generate-conformance-6.7.ts',
    cases: [
      { file: 'cases/no-envelope-on-claim.json', name: 'no-envelope-on-claim' },
      { file: 'cases/empty-envelope.json', name: 'empty-envelope' },
      { file: 'cases/event-types-hit.json', name: 'event-types-hit' },
      { file: 'cases/event-types-miss.json', name: 'event-types-miss' },
      { file: 'cases/expires-at-exceeded.json', name: 'expires-at-exceeded' },
      { file: 'cases/tool-names-unresolvable.json', name: 'tool-names-unresolvable' },
      { file: 'cases/transaction-amount-unresolvable.json', name: 'transaction-amount-unresolvable' },
    ],
    keys: { alice_pubkey: aliceKey },
    note: 'The seven cases collectively exercise the §6.7.2 verifier algorithm: no envelope (cases 1-2), event_types allowlist hit/miss (cases 3-4), expires_at exceeded (case 5), and the two unresolvable categories where the constraint inputs are not accessible to the verifier (cases 6-7). Per §6.7.3 mismatches are signals, not invalidation: out-of-envelope records remain valid.',
  }

  writeFileSync(join(CORPUS_ROOT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')

  console.log(`generated ${manifest.cases.length} cases at ${CORPUS_ROOT}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
