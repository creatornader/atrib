// SPDX-License-Identifier: Apache-2.0

/**
 * Generate spec §1.4 adversarial signing conformance vectors.
 *
 * Run with:
 *   pnpm --filter @atrib/log-dev exec tsx scripts/generate-conformance-1.4-adversarial.ts
 *
 * Output: spec/conformance/1.4/adversarial-vectors.json
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import {
  base64urlEncode,
  canonicalSigningInput,
  genesisChainRoot,
  getPublicKey,
  hexEncode,
  sha256,
  signRecord,
  type AtribRecord,
} from '@atrib/mcp'

const SEED = new Uint8Array(32).fill(0x44)
const OTHER_SEED = new Uint8Array(32).fill(0x55)
const REFERENCE_TIME_MS = Date.UTC(2026, 0, 1, 0, 0, 0)
const CONTEXT_ID = 'a'.repeat(32)

const HERE = dirname(fileURLToPath(import.meta.url))
const CORPUS_ROOT = resolve(HERE, '../../../spec/conformance/1.4')

interface Vector {
  name: string
  spec_section: '1.4'
  description: string
  input: {
    record: Partial<AtribRecord>
  }
  expected: {
    verification_passes: boolean
    submission_validation_passes?: boolean
    canonical_signing_input?: string
    signing_input_sha256_hex?: string
  }
}

function contentId(label: string): string {
  return `sha256:${label.padEnd(64, '0')}`
}

async function baseRecord(overrides: Partial<AtribRecord> = {}): Promise<AtribRecord> {
  const pubkey = await getPublicKey(SEED)
  return {
    spec_version: 'atrib/1.0',
    content_id: contentId('aa'),
    creator_key: base64urlEncode(pubkey),
    chain_root: genesisChainRoot(CONTEXT_ID),
    event_type: 'https://atrib.dev/v1/types/tool_call',
    context_id: CONTEXT_ID,
    timestamp: REFERENCE_TIME_MS,
    signature: '',
    ...overrides,
  } as AtribRecord
}

function flipBase64urlChar(input: string): string {
  return `${input[0] === 'A' ? 'B' : 'A'}${input.slice(1)}`
}

function canonicalText(record: AtribRecord): string {
  return new TextDecoder().decode(canonicalSigningInput(record))
}

function canonicalDigest(record: AtribRecord): string {
  return hexEncode(sha256(canonicalSigningInput(record)))
}

async function main(): Promise<void> {
  mkdirSync(CORPUS_ROOT, { recursive: true })

  const valid = await signRecord(await baseRecord(), SEED)
  const bitFlipped = { ...valid, signature: flipBase64urlChar(valid.signature) }
  const truncatedSignature = { ...valid, signature: valid.signature.slice(0, -1) }
  const otherPubkey = base64urlEncode(await getPublicKey(OTHER_SEED))
  const wrongCreatorKey = { ...valid, creator_key: otherPubkey }

  const malformedContext = await signRecord(
    await baseRecord({
      context_id: 'A'.repeat(32),
      chain_root: genesisChainRoot('A'.repeat(32)),
      content_id: contentId('ab'),
    } as Partial<AtribRecord>),
    SEED,
  )

  const invalidEventType = await signRecord(
    await baseRecord({
      event_type: 'tool_call',
      content_id: contentId('ac'),
    }),
    SEED,
  )

  const canonicalEdge = await signRecord(
    await baseRecord({
      annotates: `sha256:${'11'.repeat(32)}`,
      args_hash: `sha256:${'22'.repeat(32)}`,
      args_salt: 'AQIDBAUGBwgJCgsMDQ4PEA',
      content_id: contentId('ad'),
      event_type: 'https://atrib.dev/v1/types/annotation',
      informed_by: [`sha256:${'33'.repeat(32)}`],
      provenance_token: 'AAAAAAAAAAAAAAAAAAAAAA',
      result_hash: `sha256:${'44'.repeat(32)}`,
      result_salt: 'ERITFBUWFxgZGhscHR4fIA',
      session_token: 'canonical-session-token',
      timestamp_granularity: 'ms',
      tool_name: `sha256:${'55'.repeat(32)}`,
    } as Partial<AtribRecord>),
    SEED,
  )

  const vectors: Vector[] = [
    {
      name: 'valid-baseline',
      spec_section: '1.4',
      description:
        'A valid minimal tool_call record. Anchors the negative cases with the same key, timestamp, context_id, and content_id shape.',
      input: { record: valid },
      expected: {
        verification_passes: true,
        submission_validation_passes: true,
        canonical_signing_input: canonicalText(valid),
        signing_input_sha256_hex: canonicalDigest(valid),
      },
    },
    {
      name: 'bit-flipped-signature',
      spec_section: '1.4',
      description:
        'The first base64url character of a valid Ed25519 signature is changed. Structure remains acceptable, but signature verification MUST fail.',
      input: { record: bitFlipped },
      expected: {
        verification_passes: false,
        submission_validation_passes: true,
      },
    },
    {
      name: 'truncated-signature',
      spec_section: '1.4',
      description:
        'A valid signature with the final base64url character removed. The decoded signature is no longer 64 bytes and verification MUST fail.',
      input: { record: truncatedSignature },
      expected: {
        verification_passes: false,
        submission_validation_passes: true,
      },
    },
    {
      name: 'wrong-creator-key',
      spec_section: '1.4',
      description:
        'A valid signed record whose creator_key was replaced with another 32-byte Ed25519 public key. Verification MUST fail because the signature no longer matches the declared creator.',
      input: { record: wrongCreatorKey },
      expected: {
        verification_passes: false,
        submission_validation_passes: true,
      },
    },
    {
      name: 'malformed-context-id',
      spec_section: '1.4',
      description:
        'A record signed over an uppercase context_id. The signature matches those bytes, but §1.4.3 step 8 and §2.6.1 validation reject non-lowercase trace IDs.',
      input: { record: malformedContext },
      expected: {
        verification_passes: false,
        submission_validation_passes: false,
      },
    },
    {
      name: 'invalid-event-type-uri',
      spec_section: '1.4',
      description:
        'A record signed over a bare event_type token rather than an absolute URI. Signature bytes match, but URI validation MUST reject it.',
      input: { record: invalidEventType },
      expected: {
        verification_passes: false,
        submission_validation_passes: false,
      },
    },
    {
      name: 'jcs-optional-field-order',
      spec_section: '1.4',
      description:
        'A signed annotation record carrying optional fields whose names sort before, between, and after the base fields. The expected canonical string pins JCS lexicographic ordering.',
      input: { record: canonicalEdge },
      expected: {
        verification_passes: true,
        submission_validation_passes: true,
        canonical_signing_input: canonicalText(canonicalEdge),
        signing_input_sha256_hex: canonicalDigest(canonicalEdge),
      },
    },
  ]

  const body = {
    spec_section: '1.4',
    spec_title: 'Signing and verification adversarial vectors',
    decision_link: 'D101',
    generated_at: REFERENCE_TIME_MS,
    generator: 'packages/log-dev/scripts/generate-conformance-1.4-adversarial.ts',
    source_model:
      'Wycheproof-style adversarial corpus: malformed records, truncated bytes, bit-flipped signatures, wrong-key signatures, and JCS canonicalization edge cases.',
    keys: {
      creator_pubkey: base64urlEncode(await getPublicKey(SEED)),
      other_pubkey: otherPubkey,
    },
    vectors,
  }

  writeFileSync(join(CORPUS_ROOT, 'adversarial-vectors.json'), JSON.stringify(body, null, 2) + '\n')
  console.log(`generated ${vectors.length} vectors at ${CORPUS_ROOT}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
