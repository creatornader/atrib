/**
 * Generate spec §1.9 conformance corpus fixtures.
 *
 * Run with: pnpm --filter @atrib/log-dev tsx scripts/generate-conformance-1.9.ts
 *
 * Output: spec/conformance/1.9/cases/*.json + manifest.json
 *
 * Generates the decision-critical pair: pre-revocation-record (signed before
 * revocation, retains 'signature_valid') + post-revocation-record (signed
 * after, becomes 'revoked_after_revocation'). These two cases exercise
 * the verifier_state flip that is §1.9's central contract.
 *
 * Other cases enumerated in spec/conformance/1.9/README.md (compromise +
 * emergency key, malformed signers, etc.) generate later when the live
 * directory + revocation handling matures past the initial implementation.
 *
 * The seed and timestamps are hardcoded so successive regenerations
 * produce byte-identical files unless the inputs change.
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
const CONTEXT_ID = '11111111111111111111111111111111'

const HERE = dirname(fileURLToPath(import.meta.url))
const CORPUS_ROOT = resolve(HERE, '../../../spec/conformance/1.9')
const CASES_DIR = join(CORPUS_ROOT, 'cases')

mkdirSync(CASES_DIR, { recursive: true })

function recordHash(record: AtribRecord): string {
  return 'sha256:' + Buffer.from(sha256(canonicalRecord(record))).toString('hex')
}

async function main(): Promise<void> {
  const alicePub = await getPublicKey(ALICE_SEED)
  const aliceKey = base64urlEncode(alicePub)
  const successorSeed = new Uint8Array(32).fill(0x22)
  const successorPub = await getPublicKey(successorSeed)
  const successorKey = base64urlEncode(successorPub)

  // The records form a 4-step sequence. log_index ordering is:
  //   0: a tool_call by Alice (pre-revocation)
  //   1: another tool_call by Alice (pre-revocation)
  //   2: key_revocation by Alice (the act of retirement)
  //   3: a tool_call by Alice (post-revocation; should flip)

  const r0 = await signRecord(
    {
      spec_version: 'atrib/1.0',
      content_id: 'sha256:' + 'a0'.repeat(32),
      creator_key: aliceKey,
      chain_root: genesisChainRoot(CONTEXT_ID),
      event_type: 'https://atrib.dev/v1/types/tool_call',
      context_id: CONTEXT_ID,
      timestamp: REFERENCE_TIME_MS + 1000,
      signature: '',
    },
    ALICE_SEED,
  )

  const r1 = await signRecord(
    {
      spec_version: 'atrib/1.0',
      content_id: 'sha256:' + 'a1'.repeat(32),
      creator_key: aliceKey,
      chain_root: genesisChainRoot(CONTEXT_ID),
      event_type: 'https://atrib.dev/v1/types/tool_call',
      context_id: CONTEXT_ID,
      timestamp: REFERENCE_TIME_MS + 2000,
      signature: '',
    },
    ALICE_SEED,
  )

  // §1.9.1 revocation record. extra fields (revoked_key, revocation_reason,
  // successor_key) are part of the canonical body; signRecord canonicalizes
  // the full record including those fields, so the signature covers them.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const revocation = await signRecord(
    {
      spec_version: 'atrib/1.0',
      content_id: 'sha256:' + 'r0'.repeat(32),
      creator_key: aliceKey,
      chain_root: genesisChainRoot(CONTEXT_ID),
      event_type: 'https://atrib.dev/v1/types/key_revocation',
      context_id: CONTEXT_ID,
      timestamp: REFERENCE_TIME_MS + 3000,
      revoked_key: aliceKey,
      revocation_reason: 'rotation',
      successor_key: successorKey,
      signature: '',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    ALICE_SEED,
  )

  const r3 = await signRecord(
    {
      spec_version: 'atrib/1.0',
      content_id: 'sha256:' + 'a3'.repeat(32),
      creator_key: aliceKey,
      chain_root: genesisChainRoot(CONTEXT_ID),
      event_type: 'https://atrib.dev/v1/types/tool_call',
      context_id: CONTEXT_ID,
      timestamp: REFERENCE_TIME_MS + 4000,
      signature: '',
    },
    ALICE_SEED,
  )

  const sequence = [
    { log_index: 0, record: r0, comment: 'pre-revocation tool_call by Alice' },
    { log_index: 1, record: r1, comment: 'pre-revocation tool_call by Alice' },
    { log_index: 2, record: revocation, comment: 'key_revocation by Alice (rotation)' },
    { log_index: 3, record: r3, comment: 'post-revocation tool_call by Alice' },
  ]

  const preCase = {
    name: 'pre-revocation-record',
    spec_section: '1.9',
    description:
      'A record signed by the retired key with log_index < revocation log_index ' +
      'retains its original verification_state. Past attribution remains valid ' +
      'after revocation.',
    input: {
      log_entries: sequence,
      directory_state: { note: 'directory not consulted for this verification step' },
    },
    expected: {
      record_hashes: {
        '0': recordHash(r0),
        '1': recordHash(r1),
        '2': recordHash(revocation),
        '3': recordHash(r3),
      },
      verification_states: {
        '0': 'signature_valid',
        '1': 'signature_valid',
        '2': 'signature_valid',
        '3': 'revoked_after_revocation',
      },
    },
  }

  const postCase = {
    name: 'post-revocation-record',
    spec_section: '1.9',
    description:
      'A record signed by the retired key with log_index > revocation log_index ' +
      'is flagged revoked_after_revocation per §1.9.3. The signature is still ' +
      'valid cryptographically but the record MUST NOT contribute to attribution.',
    input: {
      log_entries: sequence,
      directory_state: { note: 'directory not consulted for this verification step' },
    },
    expected: {
      record_hashes: {
        '0': recordHash(r0),
        '1': recordHash(r1),
        '2': recordHash(revocation),
        '3': recordHash(r3),
      },
      verification_states: {
        '0': 'signature_valid',
        '1': 'signature_valid',
        '2': 'signature_valid',
        '3': 'revoked_after_revocation',
      },
    },
  }

  writeFileSync(join(CASES_DIR, 'pre-revocation-record.json'), JSON.stringify(preCase, null, 2) + '\n')
  writeFileSync(join(CASES_DIR, 'post-revocation-record.json'), JSON.stringify(postCase, null, 2) + '\n')

  const manifest = {
    spec_section: '1.9',
    generated_at: REFERENCE_TIME_MS,
    cases: [
      { file: 'cases/pre-revocation-record.json', name: 'pre-revocation-record' },
      { file: 'cases/post-revocation-record.json', name: 'post-revocation-record' },
    ],
    keys: {
      alice_pubkey: aliceKey,
      successor_pubkey: successorKey,
    },
    note:
      'pre-revocation-record and post-revocation-record share an identical input sequence; ' +
      'they exist as two named cases so an implementation can identify which expected ' +
      'verification_state contract it failed to satisfy. Other cases enumerated in ' +
      'README.md (valid-rotation, valid-retirement, valid-compromise-emergency, ' +
      'invalid-* signers) will be generated when the live directory + revocation handling ' +
      'matures past the initial implementation.',
  }

  writeFileSync(join(CORPUS_ROOT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')

  console.log('Generated spec/conformance/1.9/ corpus:')
  console.log('  cases/pre-revocation-record.json')
  console.log('  cases/post-revocation-record.json')
  console.log('  manifest.json')
}

void main()
