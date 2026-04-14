/**
 * Tests for `@atrib/log-dev`'s HTTP submission API.
 *
 * Two categories:
 *
 *   1. Wire-format conformance, verify the dev log accepts what spec
 *      §2.6.1 says it should accept and rejects what it should reject.
 *      These tests double-check the dev log against the spec, which
 *      means a regression in the dev log's validation surfaces here
 *      rather than in a customer's first deploy.
 *
 *   2. Real-consumer demonstration for `X-atrib-Priority`, verify the
 *      priority queue actually orders submissions by priority when
 *      `maxConcurrent` is finite. This is the second of the two real
 *      consumers documented in `@atrib/mcp/src/submission.ts`'s file
 *      header (the first is `flush()` retry ordering).
 *
 * The dev log is integration-tested end-to-end by the runnable demo at
 * `packages/integration/examples/end-to-end/`. These unit tests focus on
 * the validation rules and the priority queue mechanics in isolation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { startDevLog, type DevLog } from '../src/index.js'
import { signRecord, getPublicKey, base64urlEncode, genesisChainRoot } from '@atrib/mcp'
import type { AtribRecord } from '@atrib/mcp'

const TEST_KEY = new Uint8Array(32).fill(7)
const TEST_CONTEXT = '4bf92f3577b34da6a3ce929d0e0e4736'

async function makeSignedRecord(overrides: Partial<AtribRecord> = {}): Promise<AtribRecord> {
  const pubKey = await getPublicKey(TEST_KEY)
  const record: AtribRecord = {
    spec_version: 'atrib/1.0',
    content_id: 'sha256:3f8a2b0000000000000000000000000000000000000000000000000000000000',
    creator_key: base64urlEncode(pubKey),
    chain_root: genesisChainRoot(TEST_CONTEXT),
    event_type: 'tool_call',
    context_id: TEST_CONTEXT,
    timestamp: Date.now(),
    signature: '',
    ...overrides,
  } as AtribRecord
  return signRecord(record, TEST_KEY)
}

describe('@atrib/log-dev, HTTP submission API', () => {
  let log: DevLog

  beforeEach(async () => {
    log = await startDevLog({ port: 0 })
  })

  afterEach(async () => {
    await log.close()
  })

  describe('wire format conformance (spec §2.6.1)', () => {
    it('accepts a bare signed record and returns a well-formed proof bundle', async () => {
      const record = await makeSignedRecord()

      const response = await fetch(log.submissionEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(record),
      })

      expect(response.status).toBe(200)
      const proof = (await response.json()) as Record<string, unknown>

      // §2.6.2 fields all present, snake_case
      expect(typeof proof.log_index).toBe('number')
      expect(typeof proof.checkpoint).toBe('string')
      expect(Array.isArray(proof.inclusion_proof)).toBe(true)
      expect(typeof proof.leaf_hash).toBe('string')

      // Checkpoint body shape per §2.4.1: origin\nsize\nrootHash\n
      const checkpointLines = (proof.checkpoint as string).split('\n')
      expect(checkpointLines[0]).toBe('log.atrib.dev/v1')

      // Storage now has the record
      expect(log.size).toBe(1)
      expect(log.entries[0]!.record.context_id).toBe(TEST_CONTEXT)
    })

    it('rejects a non-JSON body with 400', async () => {
      const response = await fetch(log.submissionEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json',
      })
      expect(response.status).toBe(400)
      expect(log.size).toBe(0)
    })

    it('rejects a wrong spec_version with 400 (§2.6.1 Step 2)', async () => {
      const record = await makeSignedRecord()
      const wrongVersion = { ...record, spec_version: 'atrib/0.9' }

      const response = await fetch(log.submissionEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(wrongVersion),
      })
      expect(response.status).toBe(400)
      const body = (await response.json()) as { error: string }
      expect(body.error).toContain('spec_version')
      expect(log.size).toBe(0)
    })

    it('rejects an unknown event_type with 400 (§2.6.1 Step 3)', async () => {
      const record = await makeSignedRecord()
      const wrongEvent = { ...record, event_type: 'banana' as 'tool_call' }

      const response = await fetch(log.submissionEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(wrongEvent),
      })
      expect(response.status).toBe(400)
      const body = (await response.json()) as { error: string }
      expect(body.error).toContain('event_type')
      expect(log.size).toBe(0)
    })

    it('rejects a far-future timestamp with 400 (§2.6.1 Step 4)', async () => {
      // 20 minutes in the future, beyond the 10-minute clock-skew tolerance
      const record = await makeSignedRecord({
        timestamp: Date.now() + 20 * 60 * 1000,
      })

      const response = await fetch(log.submissionEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(record),
      })
      expect(response.status).toBe(400)
      expect(log.size).toBe(0)
    })

    it('rejects a malformed context_id with 400 (§2.6.1 Step 5)', async () => {
      const record = await makeSignedRecord()
      const wrongContext = { ...record, context_id: 'not-a-hex-id' }

      const response = await fetch(log.submissionEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(wrongContext),
      })
      expect(response.status).toBe(400)
      expect(log.size).toBe(0)
    })

    it('idempotent submission: same record_hash returns same proof (§2.6.1 Step 6)', async () => {
      const record = await makeSignedRecord()

      const r1 = await fetch(log.submissionEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(record),
      })
      const proof1 = (await r1.json()) as { log_index: number }

      const r2 = await fetch(log.submissionEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(record),
      })
      const proof2 = (await r2.json()) as { log_index: number }

      expect(r1.status).toBe(200)
      expect(r2.status).toBe(200)
      expect(proof2.log_index).toBe(proof1.log_index)
      // Storage size is 1, the duplicate did not double-admit.
      expect(log.size).toBe(1)
    })

    it('returns 404 for any path other than POST /v1/entries', async () => {
      const r1 = await fetch(`${log.url}/v1/checkpoint`)
      expect(r1.status).toBe(404)

      const r2 = await fetch(`${log.url}/v1/entries`, { method: 'GET' })
      expect(r2.status).toBe(404)

      const r3 = await fetch(`${log.url}/some/other/path`, { method: 'POST' })
      expect(r3.status).toBe(404)
    })
  })

  describe('inspection API', () => {
    it('onSubmit fires for every accepted entry in admission order', async () => {
      const observed: string[] = []
      log.onSubmit((entry) => {
        observed.push(entry.record.event_type)
      })

      const r1 = await makeSignedRecord({ timestamp: Date.now() })
      const r2 = await makeSignedRecord({
        timestamp: Date.now() + 1,
        event_type: 'transaction',
      })

      await fetch(log.submissionEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(r1),
      })
      await fetch(log.submissionEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(r2),
      })

      expect(observed).toEqual(['tool_call', 'transaction'])
    })

    it('clear() resets the log to empty', async () => {
      const record = await makeSignedRecord()
      await fetch(log.submissionEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(record),
      })
      expect(log.size).toBe(1)

      log.clear()
      expect(log.size).toBe(0)
      expect(log.entries.length).toBe(0)
    })
  })
})

describe('@atrib/log-dev, X-atrib-Priority real consumer', () => {
  it('high-priority submissions are admitted before normal under capacity pressure', async () => {
    // maxConcurrent: 1 means only one submission is in-flight at a time.
    // processingDelayMs: 30 makes the in-flight slot held long enough for
    // queued submissions to actually queue (no race conditions).
    const log = await startDevLog({
      port: 0,
      maxConcurrent: 1,
      processingDelayMs: 30,
    })

    try {
      // Build three records with distinct timestamps so each has a unique
      // record_hash (otherwise the idempotent path collapses them).
      const normalA = await makeSignedRecord({ timestamp: Date.now() })
      const normalB = await makeSignedRecord({ timestamp: Date.now() + 1 })
      const highX = await makeSignedRecord({
        timestamp: Date.now() + 2,
        event_type: 'transaction',
      })

      // Track admission order via the onSubmit listener.
      const admissionOrder: string[] = []
      log.onSubmit((entry) => {
        admissionOrder.push(entry.record.event_type)
      })

      // Fire all three submissions concurrently. The first one occupies
      // the only in-flight slot for ~30ms; while it's processing, the
      // other two go into the priority queue. When the slot frees, the
      // priority queue admits HIGH first regardless of arrival order.
      const [, ,] = await Promise.all([
        fetch(log.submissionEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-atrib-Priority': 'normal' },
          body: JSON.stringify(normalA),
        }),
        fetch(log.submissionEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-atrib-Priority': 'normal' },
          body: JSON.stringify(normalB),
        }),
        fetch(log.submissionEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-atrib-Priority': 'high' },
          body: JSON.stringify(highX),
        }),
      ])

      // The first admission is whichever submission won the race to the
      // empty slot, it's not deterministic which of the three got there
      // first. But the SECOND and THIRD admissions ARE deterministic:
      // among the records that had to queue, high goes before normal.
      expect(admissionOrder.length).toBe(3)
      // The transaction record (high) MUST come before at least one of
      // the tool_call records (normal), it cannot have been admitted last.
      const transactionPosition = admissionOrder.indexOf('transaction')
      expect(transactionPosition).toBeLessThanOrEqual(1)
    } finally {
      await log.close()
    }
  })

  it('defaults priority to normal when X-atrib-Priority header is absent', async () => {
    const log = await startDevLog({ port: 0 })
    try {
      const record = await makeSignedRecord()
      const response = await fetch(log.submissionEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(record),
      })
      expect(response.status).toBe(200)
      expect(log.entries[0]!.priority).toBe('normal')
    } finally {
      await log.close()
    }
  })

  it('treats unknown priority values as normal', async () => {
    const log = await startDevLog({ port: 0 })
    try {
      const record = await makeSignedRecord()
      const response = await fetch(log.submissionEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-atrib-Priority': 'banana' },
        body: JSON.stringify(record),
      })
      expect(response.status).toBe(200)
      expect(log.entries[0]!.priority).toBe('normal')
    } finally {
      await log.close()
    }
  })
})
