// SPDX-License-Identifier: Apache-2.0

/**
 * Unit tests for the producer-side anchor plurality surface
 * (src/anchors.ts; D138, spec §2.11.7-§2.11.13).
 *
 * The §2.11.12 posture precedence and the §2.11.10 claim construction are
 * additionally pinned end-to-end by the shared corpus at
 * spec/conformance/2.11/anchors/ (reference test in @atrib/verify). These
 * tests cover the library behaviors the corpus cannot: fan-out
 * non-blocking semantics (§5.3.5), per-leg failure isolation (§5.8), the
 * atrib-log transport's reuse of the existing submission path, and stub
 * transports for the not-yet-shipped anchor types.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import * as ed from '@noble/ed25519'
import {
  ANCHOR_CLAIM_KIND,
  ANCHOR_CLAIM_PREFIX,
  BUILT_IN_DEFAULT_ANCHOR_SET,
  anchorClaimArtifact,
  buildAnchoringClaim,
  canonicalRecordHash,
  createAnchorFanout,
  createAtribLogAnchorTransport,
  createOpenTimestampsAnchorTransport,
  createRekorAnchorTransport,
  createRfc3161AnchorTransport,
  createStubAnchorTransport,
  rfc3161TimestampQuery,
  resolveAnchorPosture,
  resolveEffectiveAnchors,
  submitToAnchors,
  verifyAnchoringClaim,
} from '../src/anchors.js'
import type {
  AnchorSubmissionOutcome,
  AnchorSubmissionRequest,
  AnchorTransport,
} from '../src/anchors.js'
import { getPublicKey, signRecord } from '../src/signing.js'
import { base64urlEncode, base64urlDecode } from '../src/base64url.js'
import { canonicalRecord } from '../src/canon.js'
import type { AtribRecord } from '../src/types.js'
import type { SubmissionQueue } from '../src/submission.js'

const utf8Decode = new TextDecoder()

const CREATOR_SEED = new Uint8Array(32).fill(7)
const ANCHORING_SEED = new Uint8Array(32).fill(9)

async function makeSignedRecord(overrides?: Partial<AtribRecord>): Promise<AtribRecord> {
  const publicKey = await getPublicKey(CREATOR_SEED)
  const record: AtribRecord = {
    spec_version: 'atrib/1.0',
    content_id: 'sha256:3f8a2b0000000000000000000000000000000000000000000000000000000000',
    creator_key: base64urlEncode(publicKey),
    chain_root: 'sha256:7e1f4a0000000000000000000000000000000000000000000000000000000000',
    event_type: 'https://atrib.dev/v1/types/tool_call',
    context_id: '4bf92f3577b34da6a3ce929d0e0e4736',
    timestamp: 1743850000000,
    signature: '',
    ...overrides,
  } as AtribRecord
  return signRecord(record, CREATOR_SEED)
}

function fakeQueue(): SubmissionQueue & {
  submitted: Array<{ record: AtribRecord; priority: 'high' | 'normal' }>
} {
  const submitted: Array<{ record: AtribRecord; priority: 'high' | 'normal' }> = []
  return {
    submitted,
    submit(record, priority) {
      submitted.push({ record, priority })
    },
    getProof() {
      return undefined
    },
    async flush() {},
  }
}

function recordingTransport(
  anchorType: AnchorTransport['anchorType'],
  anchorId: string,
  behavior?: (request: AnchorSubmissionRequest) => AnchorSubmissionOutcome | Promise<AnchorSubmissionOutcome>,
): AnchorTransport & { requests: AnchorSubmissionRequest[] } {
  const requests: AnchorSubmissionRequest[] = []
  return {
    anchorType,
    anchorId,
    requests,
    submit(request) {
      requests.push(request)
      if (behavior) return behavior(request)
      return { anchor_type: anchorType, anchor_id: anchorId, status: 'queued' }
    },
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

// ── §2.11.12 posture resolution ──────────────────────────────────────

describe('resolveAnchorPosture (§2.11.12 precedence)', () => {
  it('rule 1: no anchor config resolves to the built-in default set (plurality without opting in)', () => {
    expect(resolveAnchorPosture()).toEqual({
      effective_anchor_count: 2,
      used_default_set: true,
      warn: false,
      sidecar_anchor_config: null,
    })
    expect(resolveAnchorPosture({})).toEqual(resolveAnchorPosture())
    expect(BUILT_IN_DEFAULT_ANCHOR_SET).toHaveLength(2)
  })

  it('rule 2: explicit config with >= 2 entries is used as given', () => {
    const posture = resolveAnchorPosture({
      anchors: [
        { anchor_type: 'atrib-log', url: 'https://log.atrib.dev/v1' },
        { anchor_type: 'opentimestamps', calendars: ['https://a.pool.opentimestamps.org'] },
      ],
    })
    expect(posture).toEqual({
      effective_anchor_count: 2,
      used_default_set: false,
      warn: false,
      sidecar_anchor_config: null,
    })
  })

  it('rule 3: one anchor with allow_single_anchor true is deliberate, no warning', () => {
    const posture = resolveAnchorPosture({
      anchors: [{ anchor_type: 'atrib-log', url: 'https://log.atrib.dev/v1' }],
      allow_single_anchor: true,
    })
    expect(posture).toEqual({
      effective_anchor_count: 1,
      used_default_set: false,
      warn: false,
      sidecar_anchor_config: null,
    })
  })

  it('rule 4: sub-plurality without the flag warns and carries the §5.9.3 sidecar marker', () => {
    expect(
      resolveAnchorPosture({ anchors: [{ anchor_type: 'atrib-log', url: 'https://log.atrib.dev/v1' }] }),
    ).toEqual({
      effective_anchor_count: 1,
      used_default_set: false,
      warn: true,
      sidecar_anchor_config: { configured: 1, allow_single_anchor: false },
    })
    expect(resolveAnchorPosture({ anchors: [] })).toEqual({
      effective_anchor_count: 0,
      used_default_set: false,
      warn: true,
      sidecar_anchor_config: { configured: 0, allow_single_anchor: false },
    })
  })

  it('never throws: a malformed config resolves as zero-config (§5.8)', () => {
    expect(
      resolveAnchorPosture({ anchors: 'nope' as unknown as [] }),
    ).toEqual(resolveAnchorPosture())
  })

  it('resolveEffectiveAnchors returns the default set only when no anchors were configured', () => {
    expect(resolveEffectiveAnchors()).toEqual(BUILT_IN_DEFAULT_ANCHOR_SET)
    const one = [{ anchor_type: 'atrib-log' as const, url: 'https://log.example.test/v1' }]
    expect(resolveEffectiveAnchors({ anchors: one })).toEqual(one)
    expect(resolveEffectiveAnchors({ anchors: [] })).toEqual([])
  })
})

// ── §2.11.10 anchoring-claim artifact ────────────────────────────────

describe('anchoring-claim artifact (§2.11.10)', () => {
  it('anchorClaimArtifact builds the domain-separated UTF-8 bytes', async () => {
    const record = await makeSignedRecord()
    const recordHash = canonicalRecordHash(record)
    const artifact = anchorClaimArtifact(recordHash)
    expect(utf8Decode.decode(artifact)).toBe(ANCHOR_CLAIM_PREFIX + recordHash)
    expect(utf8Decode.decode(artifact).startsWith('atrib-anchor/v1:sha256:')).toBe(true)
  })

  it('rejects a non-canonical record hash', () => {
    expect(() => anchorClaimArtifact('sha256:ABCDEF')).toThrow(TypeError)
    expect(() => anchorClaimArtifact('c0ffee')).toThrow(TypeError)
    expect(() =>
      anchorClaimArtifact(
        // uppercase hex is not canonical §1.2.3 form
        'sha256:' + 'A'.repeat(64),
      ),
    ).toThrow(TypeError)
  })

  it('buildAnchoringClaim signs the artifact with a FRESH anchoring key and pins the corpus entry-body construction', async () => {
    const record = await makeSignedRecord()
    const recordHash = canonicalRecordHash(record)
    const claim = await buildAnchoringClaim(recordHash, ANCHORING_SEED)

    expect(claim.kind).toBe(ANCHOR_CLAIM_KIND)
    expect(claim.artifact_utf8).toBe(ANCHOR_CLAIM_PREFIX + recordHash)

    // The anchoring key is fresh: not the record's creator_key.
    expect(claim.public_key_b64url).not.toBe(record.creator_key)
    expect(claim.public_key_b64url).toBe(base64urlEncode(await getPublicKey(ANCHORING_SEED)))

    // The fresh Ed25519 signature verifies over the artifact bytes.
    const artifactBytes = anchorClaimArtifact(recordHash)
    const sigOk = await ed.verifyAsync(
      base64urlDecode(claim.signature_b64url),
      artifactBytes,
      base64urlDecode(claim.public_key_b64url),
    )
    expect(sigOk).toBe(true)

    // The entry body is the sorted-key flat JSON the conformance corpus pins.
    const bodyJson = utf8Decode.decode(new Uint8Array(Buffer.from(claim.entry_body_b64, 'base64')))
    expect(bodyJson).toBe(
      JSON.stringify({
        artifact_b64: claim.artifact_b64,
        kind: ANCHOR_CLAIM_KIND,
        public_key_b64url: claim.public_key_b64url,
        signature_b64url: claim.signature_b64url,
      }),
    )

    expect(await verifyAnchoringClaim(claim, recordHash)).toBe(true)
  })

  it('a genuinely-signed claim for a DIFFERENT record hash does not verify (binding, not signature)', async () => {
    const recordA = await makeSignedRecord()
    const recordB = await makeSignedRecord({ timestamp: 1743850000999 })
    const claim = await buildAnchoringClaim(canonicalRecordHash(recordA), ANCHORING_SEED)
    expect(await verifyAnchoringClaim(claim, canonicalRecordHash(recordB))).toBe(false)
  })

  it("the record's own signature MUST NOT ride the digest path: it does not verify over the bytes behind record_hash", async () => {
    const record = await makeSignedRecord()
    const fullBytes = canonicalRecord(record) // record_hash preimage INCLUDES signature (§1.2.3)
    const sigOverFullBytes = await ed.verifyAsync(
      base64urlDecode(record.signature),
      fullBytes,
      base64urlDecode(record.creator_key),
    )
    expect(sigOverFullBytes).toBe(false)
  })

  it('verifyAnchoringClaim never throws on malformed input (§5.8)', async () => {
    expect(
      await verifyAnchoringClaim(
        { artifact_b64: '!!!not-base64!!!', public_key_b64url: '**', signature_b64url: '**' },
        'not-a-hash',
      ),
    ).toBe(false)
  })
})

// ── Transports ───────────────────────────────────────────────────────

describe('anchor transports', () => {
  it('the atrib-log transport reuses the existing §2.6.1 submission path', async () => {
    const record = await makeSignedRecord()
    const queue = fakeQueue()
    const transport = createAtribLogAnchorTransport(
      { anchor_type: 'atrib-log', url: 'https://log.example.test/v1/entries' },
      { queue },
    )
    expect(transport.anchorType).toBe('atrib-log')
    expect(transport.anchorId).toBe('log.example.test')

    const outcome = await transport.submit({
      record,
      recordHash: canonicalRecordHash(record),
      priority: 'high',
    })
    expect(outcome).toEqual({
      anchor_type: 'atrib-log',
      anchor_id: 'log.example.test',
      status: 'queued',
    })
    expect(queue.submitted).toEqual([{ record, priority: 'high' }])
  })

  it('explicit anchor_id wins over the endpoint-derived identity', () => {
    const transport = createAtribLogAnchorTransport(
      { anchor_id: 'my-log', url: 'https://log.example.test/v1' },
      { queue: fakeQueue() },
    )
    expect(transport.anchorId).toBe('my-log')
  })

  it('stub transports report unsupported without touching the network', async () => {
    const record = await makeSignedRecord()
    for (const anchorType of ['sigstore-rekor', 'rfc3161-tsa', 'opentimestamps'] as const) {
      const transport = createStubAnchorTransport(anchorType, `${anchorType}-id`)
      const outcome = await transport.submit({
        record,
        recordHash: canonicalRecordHash(record),
        priority: 'normal',
      })
      expect(outcome.status).toBe('unsupported')
      expect(outcome.anchor_type).toBe(anchorType)
      expect(outcome.anchor_id).toBe(`${anchorType}-id`)
    }
  })

  it('Rekor submits an anchor-claim hash over explicit HTTP configuration', async () => {
    const record = await makeSignedRecord()
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 201 }))
    const transport = createRekorAnchorTransport(
      { anchor_type: 'sigstore-rekor', anchor_id: 'rekor.test', url: 'https://rekor.test' },
      { allowNetwork: true, fetchImpl },
    )
    const outcome = await transport.submit({ record, recordHash: canonicalRecordHash(record), priority: 'normal' })
    expect(outcome).toEqual({ anchor_type: 'sigstore-rekor', anchor_id: 'rekor.test', status: 'queued' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe('https://rekor.test/api/v1/log/entries')
    const body = JSON.parse(init!.body as string) as { spec: { data: { hash: { value: string }, content: string } } }
    expect(body.spec.data.hash.value).toBe(canonicalRecordHash(record).slice('sha256:'.length))
    expect(new TextDecoder().decode(Uint8Array.from(atob(body.spec.data.content), (char) => char.charCodeAt(0)))).toBe(
      `atrib-anchor/v1:${canonicalRecordHash(record)}`,
    )
  })

  it('RFC 3161 sends a DER timestamp query over explicit HTTP configuration', async () => {
    const record = await makeSignedRecord()
    const fetchImpl = vi.fn(async () => new Response(Uint8Array.of(0x30, 0x00), { status: 200 }))
    const recordHash = canonicalRecordHash(record)
    const transport = createRfc3161AnchorTransport(
      { anchor_type: 'rfc3161-tsa', anchor_id: 'tsa.test', url: 'https://tsa.test/timestamp' },
      { allowNetwork: true, fetchImpl },
    )
    await expect(transport.submit({ record, recordHash, priority: 'normal' })).resolves.toEqual({
      anchor_type: 'rfc3161-tsa', anchor_id: 'tsa.test', status: 'queued',
    })
    const query = rfc3161TimestampQuery(recordHash)
    expect(query[0]).toBe(0x30)
    expect([...query].map((byte) => byte.toString(16).padStart(2, '0')).join('')).toContain(
      recordHash.slice('sha256:'.length),
    )
    expect(fetchImpl.mock.calls[0]![1]!.headers).toMatchObject({ 'content-type': 'application/timestamp-query' })
  })

  it('OpenTimestamps submits the raw digest and reports a pending receipt', async () => {
    const record = await makeSignedRecord()
    const fetchImpl = vi.fn(async () => new Response(Uint8Array.of(0x01), { status: 200 }))
    const recordHash = canonicalRecordHash(record)
    const transport = createOpenTimestampsAnchorTransport(
      { anchor_type: 'opentimestamps', anchor_id: 'ots.test', calendars: ['https://ots.test'] },
      { allowNetwork: true, fetchImpl },
    )
    await expect(transport.submit({ record, recordHash, priority: 'normal' })).resolves.toEqual({
      anchor_type: 'opentimestamps', anchor_id: 'ots.test', status: 'pending',
    })
    expect(fetchImpl.mock.calls[0]![0]).toBe('https://ots.test/digest')
    const body = fetchImpl.mock.calls[0]![1]!.body as Blob
    const bodyHex = [...new Uint8Array(await body.arrayBuffer())]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
    expect(bodyHex).toBe(
      recordHash.slice('sha256:'.length),
    )
  })

  it('built-in default leaves the OpenTimestamps HTTP transport disabled', async () => {
    const record = await makeSignedRecord()
    const transport = createOpenTimestampsAnchorTransport(
      { anchor_type: 'opentimestamps', calendars: ['https://ots.test'] },
      { fetchImpl: vi.fn() },
    )
    expect(transport.submit({ record, recordHash: canonicalRecordHash(record), priority: 'normal' }))
      .toMatchObject({ status: 'unsupported' })
  })
})

// ── Fan-out (§5.3.5 non-blocking, §5.8 isolation) ────────────────────

describe('createAnchorFanout / submitToAnchors', () => {
  it('returns synchronously without awaiting any transport (§5.3.5)', async () => {
    const record = await makeSignedRecord()
    let resolveSlow!: (outcome: AnchorSubmissionOutcome) => void
    let slowSettled = false
    const slow = recordingTransport('opentimestamps', 'ots-cal', () => {
      return new Promise<AnchorSubmissionOutcome>((resolve) => {
        resolveSlow = (outcome) => {
          slowSettled = true
          resolve(outcome)
        }
      })
    })
    const fast = recordingTransport('atrib-log', 'log-a')
    const fanout = createAnchorFanout({
      config: {
        anchors: [
          { anchor_type: 'atrib-log', anchor_id: 'log-a', url: 'https://log-a.example.test/v1' },
          { anchor_type: 'opentimestamps', anchor_id: 'ots-cal' },
        ],
      },
      transports: [slow, fast],
    })

    const ticket = fanout.submitToAnchors(record, 'high')
    // The primary path already has control here; the slow leg is unsettled.
    expect(slowSettled).toBe(false)
    expect(fast.requests).toHaveLength(1)
    expect(slow.requests).toHaveLength(1)
    expect(fast.requests[0]?.priority).toBe('high')
    expect(fast.requests[0]?.recordHash).toBe(canonicalRecordHash(record))

    resolveSlow({ anchor_type: 'opentimestamps', anchor_id: 'ots-cal', status: 'pending' })
    const outcomes = await ticket.outcomes
    // Outcomes follow effective-set order (elements are unordered on the
    // wire per §2.11.9(d); this ordering is a local convenience only).
    expect(outcomes).toEqual([
      { anchor_type: 'atrib-log', anchor_id: 'log-a', status: 'queued' },
      { anchor_type: 'opentimestamps', anchor_id: 'ots-cal', status: 'pending' },
    ])
  })

  it('a throwing transport degrades to a failed outcome; other legs are unaffected (§5.8)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const record = await makeSignedRecord()
    const boom = recordingTransport('rfc3161-tsa', 'tsa-x', () => {
      throw new Error('tsa unreachable')
    })
    const ok = recordingTransport('atrib-log', 'log-a')
    const fanout = createAnchorFanout({
      config: {
        anchors: [
          { anchor_type: 'rfc3161-tsa', anchor_id: 'tsa-x' },
          { anchor_type: 'atrib-log', anchor_id: 'log-a', url: 'https://log-a.example.test/v1' },
        ],
      },
      transports: [boom, ok],
    })

    const outcomes = await fanout.submitToAnchors(record).outcomes
    expect(outcomes[0]).toMatchObject({
      anchor_type: 'rfc3161-tsa',
      anchor_id: 'tsa-x',
      status: 'failed',
      detail: 'tsa unreachable',
    })
    expect(outcomes[1]).toMatchObject({ anchor_type: 'atrib-log', status: 'queued' })
    expect(
      warn.mock.calls.some(
        (call) => typeof call[0] === 'string' && call[0].startsWith('atrib: anchor submission failed'),
      ),
    ).toBe(true)
  })

  it('rule-4 configs emit one atrib:-prefixed warning and expose the sidecar marker; signing is never disabled', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const record = await makeSignedRecord()
    const only = recordingTransport('atrib-log', 'log-a')
    const fanout = createAnchorFanout({
      config: {
        anchors: [{ anchor_type: 'atrib-log', anchor_id: 'log-a', url: 'https://log-a.example.test/v1' }],
      },
      transports: [only],
    })

    expect(fanout.posture.warn).toBe(true)
    expect(fanout.sidecarMarker).toEqual({ configured: 1, allow_single_anchor: false })
    expect(
      warn.mock.calls.some(
        (call) =>
          typeof call[0] === 'string' &&
          call[0].startsWith('atrib:') &&
          call[0].includes('allow_single_anchor'),
      ),
    ).toBe(true)

    // The operation continues: the configured anchor still receives the record.
    const outcomes = await fanout.submitToAnchors(record).outcomes
    expect(outcomes).toEqual([{ anchor_type: 'atrib-log', anchor_id: 'log-a', status: 'queued' }])
  })

  it('allow_single_anchor true is deliberate: no warning, no marker', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fanout = createAnchorFanout({
      config: {
        anchors: [{ anchor_type: 'atrib-log', anchor_id: 'log-a', url: 'https://log-a.example.test/v1' }],
        allow_single_anchor: true,
      },
      transports: [recordingTransport('atrib-log', 'log-a')],
    })
    expect(fanout.posture.warn).toBe(false)
    expect(fanout.sidecarMarker).toBeNull()
    expect(warn).not.toHaveBeenCalled()
  })

  it('zero-config fans out to the built-in two-anchor default set', async () => {
    const record = await makeSignedRecord()
    const logLeg = recordingTransport('atrib-log', 'log.atrib.dev')
    const otsLeg = recordingTransport('opentimestamps', 'opentimestamps-calendars', () => ({
      anchor_type: 'opentimestamps',
      anchor_id: 'opentimestamps-calendars',
      status: 'pending',
    }))
    // Both default legs are overridden by injected transports so the test
    // never constructs a real submission queue for log.atrib.dev.
    const fanout = createAnchorFanout({ transports: [logLeg, otsLeg] })
    expect(fanout.posture.used_default_set).toBe(true)
    expect(fanout.transports).toHaveLength(2)

    const outcomes = await fanout.submitToAnchors(record).outcomes
    expect(outcomes).toEqual([
      { anchor_type: 'atrib-log', anchor_id: 'log.atrib.dev', status: 'queued' },
      { anchor_type: 'opentimestamps', anchor_id: 'opentimestamps-calendars', status: 'pending' },
    ])
    expect(logLeg.requests).toHaveLength(1)
    expect(otsLeg.requests).toHaveLength(1)
  })

  it('a throwing onOutcome observer is caught and never affects other legs (§5.8)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const record = await makeSignedRecord()
    const seen: AnchorSubmissionOutcome[] = []
    const fanout = createAnchorFanout({
      config: {
        anchors: [
          { anchor_type: 'atrib-log', anchor_id: 'log-a', url: 'https://log-a.example.test/v1' },
          { anchor_type: 'atrib-log', anchor_id: 'log-b', url: 'https://log-b.example.test/v1' },
        ],
      },
      transports: [recordingTransport('atrib-log', 'log-a'), recordingTransport('atrib-log', 'log-b')],
      onOutcome: (outcome) => {
        seen.push(outcome)
        throw new Error('observer bug')
      },
    })
    const outcomes = await fanout.submitToAnchors(record).outcomes
    expect(outcomes).toHaveLength(2)
    expect(seen).toHaveLength(2)
    expect(
      warn.mock.calls.some(
        (call) => typeof call[0] === 'string' && call[0].startsWith('atrib: anchor outcome observer threw'),
      ),
    ).toBe(true)
  })

  it('flush awaits every in-flight leg', async () => {
    const record = await makeSignedRecord()
    let settled = false
    const slow = recordingTransport('atrib-log', 'log-a', async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
      settled = true
      return { anchor_type: 'atrib-log' as const, anchor_id: 'log-a', status: 'queued' as const }
    })
    const fanout = createAnchorFanout({
      config: {
        anchors: [{ anchor_type: 'atrib-log', anchor_id: 'log-a', url: 'https://log-a.example.test/v1' }],
        allow_single_anchor: true,
      },
      transports: [slow],
    })
    fanout.submitToAnchors(record)
    expect(settled).toBe(false)
    await fanout.flush()
    expect(settled).toBe(true)
  })

  it('standalone submitToAnchors is a synchronous one-shot over the same fan-out', async () => {
    const record = await makeSignedRecord()
    const leg = recordingTransport('atrib-log', 'log-a')
    const ticket = submitToAnchors(record, {
      config: {
        anchors: [{ anchor_type: 'atrib-log', anchor_id: 'log-a', url: 'https://log-a.example.test/v1' }],
        allow_single_anchor: true,
      },
      transports: [leg],
      priority: 'high',
    })
    const outcomes = await ticket.outcomes
    expect(outcomes).toEqual([{ anchor_type: 'atrib-log', anchor_id: 'log-a', status: 'queued' }])
    expect(leg.requests[0]?.priority).toBe('high')
  })

  it('a record that cannot be canonicalized degrades to an empty ticket without throwing (§5.8)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    // A circular structure defeats JCS canonicalization.
    const circular: Record<string, unknown> = { spec_version: 'atrib/1.0' }
    circular['self'] = circular
    const fanout = createAnchorFanout({
      config: {
        anchors: [{ anchor_type: 'atrib-log', anchor_id: 'log-a', url: 'https://log-a.example.test/v1' }],
        allow_single_anchor: true,
      },
      transports: [recordingTransport('atrib-log', 'log-a')],
    })
    const ticket = fanout.submitToAnchors(circular as unknown as AtribRecord)
    expect(await ticket.outcomes).toEqual([])
    expect(
      warn.mock.calls.some(
        (call) => typeof call[0] === 'string' && call[0].startsWith('atrib: anchor fan-out could not hash record'),
      ),
    ).toBe(true)
  })
})
