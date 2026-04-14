/**
 * Regenerate the spec §2.6.1 conformance corpus.
 *
 * Run with: pnpm --filter @atrib/log-dev tsx scripts/generate-conformance-corpus.ts
 *
 * The corpus lives at `spec/conformance/2.6.1/` and is consumed by:
 *   - `packages/log-dev/test/conformance.test.ts` (TypeScript)
 *   - the future `services/log/` Go service (planned)
 *
 * The corpus is intentionally a set of static, fully-signed JSON files. The
 * test consumer mocks `Date.now()` to the manifest's `reference_time_ms` so
 * the timestamp-based validation rules (§2.6.1 Step 4) produce stable results
 * regardless of when the test runs. Regenerate the corpus when:
 *   - the spec §2.6.1 validation rules change
 *   - the canonical record format (§1.2) changes
 *   - a new test case is needed
 *
 * The seed (`SEED`) and `REFERENCE_TIME_MS` are hardcoded so successive
 * regenerations produce byte-identical files unless the inputs above change.
 * This makes corpus diffs in PR review trivial to read.
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

// ---------------------------------------------------------------------------
// Fixed inputs, change these only when you intend to invalidate the corpus.
// ---------------------------------------------------------------------------

const SEED = new Uint8Array(32).fill(7)
const REFERENCE_TIME_MS = Date.UTC(2026, 0, 1, 0, 0, 0) // 2026-01-01T00:00:00Z
const CONTEXT_ID = '4bf92f3577b34da6a3ce929d0e0e4736'
const CONTENT_ID = 'sha256:3f8a2b00000000000000000000000000000000000000000000000000000000ff'

const HERE = dirname(fileURLToPath(import.meta.url))
const CORPUS_ROOT = resolve(HERE, '../../../spec/conformance/2.6.1')
const CASES_DIR = join(CORPUS_ROOT, 'cases')
const SEQUENCES_DIR = join(CORPUS_ROOT, 'sequences')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makeBaseRecord(overrides: Partial<AtribRecord> = {}): Promise<AtribRecord> {
  const pubKey = await getPublicKey(SEED)
  const record: AtribRecord = {
    spec_version: 'atrib/1.0',
    content_id: CONTENT_ID,
    creator_key: base64urlEncode(pubKey),
    chain_root: genesisChainRoot(CONTEXT_ID),
    event_type: 'tool_call',
    context_id: CONTEXT_ID,
    timestamp: REFERENCE_TIME_MS,
    signature: '',
    ...overrides,
  } as AtribRecord
  return signRecord(record, SEED)
}

function recordHashHex(record: AtribRecord): string {
  return Array.from(sha256(canonicalRecord(record)), (b) => b.toString(16).padStart(2, '0')).join(
    '',
  )
}

function writeJson(path: string, data: unknown): void {
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf-8')
  // eslint-disable-next-line no-console
  console.log(`  wrote ${path.replace(CORPUS_ROOT + '/', '')}`)
}

interface CaseFile {
  name: string
  spec_section: string
  validation_step: number | null
  description: string
  request: {
    method: 'POST'
    path: '/v1/entries'
    headers: Record<string, string>
    body: unknown // either an object (will be JSON.stringified by consumer) or a raw string for invalid-JSON tests
    body_is_raw_string?: boolean
  }
  expected: {
    status: number
    error_contains?: string
    response_shape?: Record<string, string>
  }
  notes?: string
}

interface SequenceFile {
  name: string
  spec_section: string
  validation_step: number | null
  description: string
  steps: Array<{
    request: CaseFile['request']
    expected: CaseFile['expected'] & {
      capture_log_index_as?: string
      log_index_matches?: string
    }
  }>
  post: {
    log_size: number
  }
}

// ---------------------------------------------------------------------------
// Case generators
// ---------------------------------------------------------------------------

async function generate(): Promise<void> {
  mkdirSync(CASES_DIR, { recursive: true })
  mkdirSync(SEQUENCES_DIR, { recursive: true })

  const standardHeaders = { 'Content-Type': 'application/json' }
  const cases: Array<{ filename: string; data: CaseFile }> = []
  const sequences: Array<{ filename: string; data: SequenceFile }> = []

  // -- ACCEPT cases ----------------------------------------------------------

  const acceptToolCall = await makeBaseRecord()
  cases.push({
    filename: 'accept-tool-call.json',
    data: {
      name: 'accept-tool-call',
      spec_section: '2.6.1',
      validation_step: null,
      description:
        'A well-formed signed tool_call record at the reference time. The log MUST accept it (200) and return a §2.6.2 proof bundle.',
      request: {
        method: 'POST',
        path: '/v1/entries',
        headers: standardHeaders,
        body: acceptToolCall,
      },
      expected: {
        status: 200,
        response_shape: {
          log_index: 'number',
          checkpoint: 'string',
          inclusion_proof: 'array',
          leaf_hash: 'string',
        },
      },
    },
  })

  const acceptTransaction = await makeBaseRecord({ event_type: 'transaction' })
  cases.push({
    filename: 'accept-transaction.json',
    data: {
      name: 'accept-transaction',
      spec_section: '2.6.1',
      validation_step: null,
      description:
        'A well-formed signed transaction record. The log MUST accept it (200). Transaction records are structurally identical to tool_call records aside from the event_type field.',
      request: {
        method: 'POST',
        path: '/v1/entries',
        headers: standardHeaders,
        body: acceptTransaction,
      },
      expected: {
        status: 200,
        response_shape: {
          log_index: 'number',
          checkpoint: 'string',
          inclusion_proof: 'array',
          leaf_hash: 'string',
        },
      },
    },
  })

  // -- REJECT cases ----------------------------------------------------------

  // Step 1, bad signature. Build a valid record, then mutate the signature.
  const badSigRecord = await makeBaseRecord()
  const mutatedSig = base64urlEncode(new Uint8Array(64).fill(1)) // 64 zeros sig is structurally valid base64url but wrong
  const badSigBody = { ...badSigRecord, signature: mutatedSig }
  cases.push({
    filename: 'reject-bad-signature.json',
    data: {
      name: 'reject-bad-signature',
      spec_section: '2.6.1',
      validation_step: 1,
      description:
        'A record whose Ed25519 signature does not verify against creator_key. The log MUST reject with 400.',
      request: {
        method: 'POST',
        path: '/v1/entries',
        headers: standardHeaders,
        body: badSigBody,
      },
      expected: { status: 400 },
      notes:
        '@atrib/log-dev currently SKIPS Step 1 verification to avoid a workspace circular dep on @atrib/verify; this case is documented in the corpus but the dev log consumer skips it. The future services/log/ Tessera service is expected to honor it.',
    },
  })

  // Step 2, wrong spec_version
  const wrongSpecVersion = { ...acceptToolCall, spec_version: 'atrib/0.9' }
  cases.push({
    filename: 'reject-wrong-spec-version.json',
    data: {
      name: 'reject-wrong-spec-version',
      spec_section: '2.6.1',
      validation_step: 2,
      description: 'spec_version is not "atrib/1.0". The log MUST reject with 400.',
      request: {
        method: 'POST',
        path: '/v1/entries',
        headers: standardHeaders,
        body: wrongSpecVersion,
      },
      expected: { status: 400, error_contains: 'spec_version' },
    },
  })

  // Step 3, unknown event_type
  const unknownEventType = { ...acceptToolCall, event_type: 'banana' }
  cases.push({
    filename: 'reject-unknown-event-type.json',
    data: {
      name: 'reject-unknown-event-type',
      spec_section: '2.6.1',
      validation_step: 3,
      description:
        'event_type is neither "tool_call" nor "transaction". The log MUST reject with 400.',
      request: {
        method: 'POST',
        path: '/v1/entries',
        headers: standardHeaders,
        body: unknownEventType,
      },
      expected: { status: 400, error_contains: 'event_type' },
    },
  })

  // Step 4, far-future timestamp (20 minutes ahead of reference_time_ms)
  const futureTimestamp = await makeBaseRecord({
    timestamp: REFERENCE_TIME_MS + 20 * 60 * 1000,
  })
  cases.push({
    filename: 'reject-future-timestamp.json',
    data: {
      name: 'reject-future-timestamp',
      spec_section: '2.6.1',
      validation_step: 4,
      description:
        'timestamp is 20 minutes ahead of the reference time, beyond the 10-minute clock-skew tolerance. The log MUST reject with 400. The test consumer freezes Date.now() to the manifest reference_time_ms before sending this case so the validation outcome is stable across runs.',
      request: {
        method: 'POST',
        path: '/v1/entries',
        headers: standardHeaders,
        body: futureTimestamp,
      },
      expected: { status: 400 },
    },
  })

  // Step 5, malformed context_id
  const malformedContext = { ...acceptToolCall, context_id: 'not-a-valid-hex-id' }
  cases.push({
    filename: 'reject-malformed-context-id.json',
    data: {
      name: 'reject-malformed-context-id',
      spec_section: '2.6.1',
      validation_step: 5,
      description:
        'context_id is not exactly 32 lowercase hex characters. The log MUST reject with 400.',
      request: {
        method: 'POST',
        path: '/v1/entries',
        headers: standardHeaders,
        body: malformedContext,
      },
      expected: { status: 400 },
    },
  })

  // Non-JSON body, pre-Step-1 sanity check
  cases.push({
    filename: 'reject-non-json-body.json',
    data: {
      name: 'reject-non-json-body',
      spec_section: '2.6.1',
      validation_step: 0,
      description:
        'The body is not valid JSON. The log MUST reject with 400 before any §2.6.1 step runs.',
      request: {
        method: 'POST',
        path: '/v1/entries',
        headers: standardHeaders,
        body: 'this is not json',
        body_is_raw_string: true,
      },
      expected: { status: 400 },
    },
  })

  // -- SEQUENCES -------------------------------------------------------------

  // Step 6, idempotency. Submit the same record twice; both calls succeed
  // and return the same log_index, log size stays at 1.
  const idempotentRecord = await makeBaseRecord({
    timestamp: REFERENCE_TIME_MS + 1, // distinct from accept-tool-call so the test files are isolatable
  })
  sequences.push({
    filename: 'idempotent-resubmission.json',
    data: {
      name: 'idempotent-resubmission',
      spec_section: '2.6.1',
      validation_step: 6,
      description:
        'Submitting the same signed record twice MUST return the same proof bundle (same log_index) without double-admitting. record_hash is the idempotency key.',
      steps: [
        {
          request: {
            method: 'POST',
            path: '/v1/entries',
            headers: standardHeaders,
            body: idempotentRecord,
          },
          expected: { status: 200, capture_log_index_as: 'first' },
        },
        {
          request: {
            method: 'POST',
            path: '/v1/entries',
            headers: standardHeaders,
            body: idempotentRecord,
          },
          expected: { status: 200, log_index_matches: 'first' },
        },
      ],
      post: { log_size: 1 },
    },
  })

  // -- Manifest --------------------------------------------------------------

  const manifest = {
    spec_version: 'atrib/1.0',
    spec_section: '§2.6.1 + §2.6.2 (the submission API)',
    description:
      'Conformance corpus for the Atrib log submission API. Implementations of the Atrib log (TS dev stub, Go Tessera service, etc.) MUST produce the expected response status for every case. The corpus is intentionally static, see the generator at packages/log-dev/scripts/generate-conformance-corpus.ts.',
    reference_time_ms: REFERENCE_TIME_MS,
    reference_time_iso: new Date(REFERENCE_TIME_MS).toISOString(),
    signing: {
      // Documented for transparency. The seed is hardcoded so the corpus is
      // byte-deterministic; this seed must NEVER be used in production.
      algorithm: 'ed25519',
      seed_b64url: base64urlEncode(SEED),
      creator_key_b64url: base64urlEncode(await getPublicKey(SEED)),
      context_id: CONTEXT_ID,
      content_id: CONTENT_ID,
    },
    cases: cases.map((c) => ({
      file: `cases/${c.filename}`,
      name: c.data.name,
      spec_section: c.data.spec_section,
      validation_step: c.data.validation_step,
      expected_status: c.data.expected.status,
    })),
    sequences: sequences.map((s) => ({
      file: `sequences/${s.filename}`,
      name: s.data.name,
      spec_section: s.data.spec_section,
      validation_step: s.data.validation_step,
    })),
    record_hash_index: {
      'accept-tool-call': recordHashHex(acceptToolCall),
      'accept-transaction': recordHashHex(acceptTransaction),
      'idempotent-resubmission': recordHashHex(idempotentRecord),
    },
  }

  // -- Write everything ------------------------------------------------------

  for (const c of cases) {
    writeJson(join(CASES_DIR, c.filename), c.data)
  }
  for (const s of sequences) {
    writeJson(join(SEQUENCES_DIR, s.filename), s.data)
  }
  writeJson(join(CORPUS_ROOT, 'manifest.json'), manifest)

  // eslint-disable-next-line no-console
  console.log(
    `\n✓ generated ${cases.length} cases + ${sequences.length} sequences in ${CORPUS_ROOT}`,
  )
}

generate().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('generation failed:', err)
  process.exit(1)
})
