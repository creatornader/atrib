// SPDX-License-Identifier: Apache-2.0

/**
 * Unit tests for src/anchor-plurality.ts (D138, spec §2.11.7-§2.11.13),
 * complementing the corpus-driven conformance suite
 * (test/conformance-anchors.test.ts) with synthetic bundles that pin the
 * behaviors the corpus does not enumerate:
 *
 *   - §2.11.9 precedence: malformation (rules a/b) wins over unknown-type
 *     surfacing — an element violating rule (b) is malformed even when its
 *     anchor_type is unregistered, and it is NOT added to unknown_types.
 *   - unknown_types deduplication and never-invalidating semantics.
 *   - per-type binding checks are invalid proofs, never equivocation.
 *   - independence over operator groups, pending exclusion, time ranges.
 *   - §2.11.4 hard conditions on synthetic logs built from real Ed25519
 *     checkpoints and real RFC 6962 inclusion proofs.
 *   - §5.8 never-throw discipline on structurally hopeless input.
 */

import { describe, it, expect } from 'vitest'
import * as ed from '@noble/ed25519'
import { sha512 } from '@noble/hashes/sha2.js'
import {
  base64urlEncode,
  computeInclusionProof,
  computeRoot,
  hexEncode,
  serializeEntry,
  sha256,
} from '@atrib/mcp'
import {
  verifyAnchorPlurality,
  verifyAnchorProofElement,
  anchorOperatorGroup,
} from '../src/anchor-plurality.js'
import type {
  AnchorProofBundle,
  AnchorProofElement,
  AnchorTrustConfig,
} from '../src/anchor-plurality.js'

ed.hashes.sha512 = sha512
ed.hashes.sha512Async = (m: Uint8Array) => Promise.resolve(sha512(m))

const utf8 = new TextEncoder()

const RECORD_HASH_HEX = 'c0'.repeat(32)
const RECORD_HASH = `sha256:${RECORD_HASH_HEX}`
const CONTEXT_ID = '4bf92f3577b34da6a3ce929d0e0e4736'
const TIME_MS = 1_782_864_000_000

function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

/** §2.4.2 key_id = SHA-256(key_name || 0x0A || 0x01 || public_key)[:4] */
function keyId(origin: string, publicKey: Uint8Array): Uint8Array {
  const nameBytes = utf8.encode(origin)
  const preimage = new Uint8Array(nameBytes.length + 2 + publicKey.length)
  preimage.set(nameBytes, 0)
  preimage[nameBytes.length] = 0x0a
  preimage[nameBytes.length + 1] = 0x01
  preimage.set(publicKey, nameBytes.length + 2)
  return sha256(preimage).slice(0, 4)
}

interface SyntheticLog {
  logId: string
  origin: string
  seed: Uint8Array
  pub: Uint8Array
}

async function makeLog(logId: string, seedByte: number): Promise<SyntheticLog> {
  const seed = new Uint8Array(32).fill(seedByte)
  const pub = await ed.getPublicKeyAsync(seed)
  return { logId, origin: `${logId}/v1`, seed, pub }
}

/**
 * Build a real atrib-log `log_proofs` element: a 90-byte §2.3.1 entry for
 * RECORD_HASH, a single- or multi-leaf RFC 6962 tree, and a §2.4.3 signed
 * note over the root.
 */
async function makeAtribLogElement(
  log: SyntheticLog,
  options: { timestampMs?: number; creatorSeedByte?: number } = {},
): Promise<AnchorProofElement> {
  const creatorSeed = new Uint8Array(32).fill(options.creatorSeedByte ?? 5)
  const creatorPub = await ed.getPublicKeyAsync(creatorSeed)
  const entry = serializeEntry({
    record_hash_hex: RECORD_HASH_HEX,
    creator_key_b64url: base64urlEncode(creatorPub),
    context_id: CONTEXT_ID,
    timestamp: options.timestampMs ?? TIME_MS,
    event_type: 'https://atrib.dev/v1/types/tool_call',
  })
  const leaves = [entry]
  const root = computeRoot(leaves)
  const proof = computeInclusionProof(0, leaves)
  const body = `${log.origin}\n${leaves.length}\n${b64(root)}\n`
  const sig = await ed.signAsync(utf8.encode(body), log.seed)
  const sigBytes = new Uint8Array(4 + 64)
  sigBytes.set(keyId(log.origin, log.pub), 0)
  sigBytes.set(sig, 4)
  const checkpoint = `${body}\n— ${log.origin} ${b64(sigBytes)}`
  return {
    log_id: log.logId,
    log_index: 0,
    checkpoint,
    inclusion_proof: proof.map(b64),
    entry_bytes_b64: b64(entry),
  }
}

function trustFor(logs: SyntheticLog[], overrides: Partial<AnchorTrustConfig> = {}): AnchorTrustConfig {
  const material: Record<string, { origin: string; pubkey_b64: string }> = {}
  for (const log of logs) {
    material[log.logId] = { origin: log.origin, pubkey_b64: b64(log.pub) }
  }
  return {
    trust_material: { logs: material },
    trusted_logs: logs.map((l) => l.logId),
    ...overrides,
  }
}

function rfc3161Element(hashedMessageHex: string, genTimeMs: number): AnchorProofElement {
  return {
    anchor_type: 'rfc3161-tsa',
    anchor_id: 'tsa.example.test',
    proof: {
      timestamp_token_b64: b64(utf8.encode('structural-token')),
      hashed_message_hex: hashedMessageHex,
      gen_time_ms: genTimeMs,
    },
  }
}

function otsElement(
  commitmentHex: string,
  status: 'pending' | 'complete',
  attestedTimeMs?: number,
): AnchorProofElement {
  return {
    anchor_type: 'opentimestamps',
    anchor_id: 'ots.example.test',
    proof: {
      ots_b64: b64(utf8.encode('structural-ots')),
      commitment_hex: commitmentHex,
      status,
      ...(attestedTimeMs !== undefined ? { attested_time_ms: attestedTimeMs } : {}),
    },
  }
}

describe('§2.11.9 discriminator precedence', () => {
  it('malformation wins over unknown-type surfacing: rule (b) violation with an unregistered type is malformed, not unknown', async () => {
    const bundle: AnchorProofBundle = {
      record_hash: RECORD_HASH,
      // anchor_type present, != atrib-log, but anchor_id + proof missing:
      // rule (b) violation regardless of whether the type is registered.
      log_proofs: [{ anchor_type: 'example-quantum-beacon/v9' }],
    }
    const verdict = await verifyAnchorPlurality(bundle, {
      trust_material: { logs: {} },
      threshold_m: 0,
    })
    expect(verdict.anchor_plurality.malformed_count).toBe(1)
    expect(verdict.malformed_indices).toEqual([0])
    expect(verdict.anchor_plurality.unknown_types).toEqual([])
    // Excluded from every count except proof_count / malformed_count, and
    // never invalidating.
    expect(verdict.anchor_plurality.proof_count).toBe(1)
    expect(verdict.anchor_plurality.verified_count).toBe(0)
    expect(verdict.hard_reject).toBe(false)
  })

  it('well-formed unknown types are surfaced once, never counted, never invalidating', async () => {
    const bundle: AnchorProofBundle = {
      record_hash: RECORD_HASH,
      log_proofs: [
        { anchor_type: 'example-quantum-beacon/v9', anchor_id: 'beacon-1', proof: { blob: 'x' } },
        { anchor_type: 'example-quantum-beacon/v9', anchor_id: 'beacon-2', proof: { blob: 'y' } },
        { anchor_type: 'example-other/v1', anchor_id: 'other-1', proof: {} },
      ],
    }
    const verdict = await verifyAnchorPlurality(bundle, {
      trust_material: { logs: {} },
      threshold_m: 0,
    })
    expect(verdict.anchor_plurality.unknown_types).toEqual([
      'example-quantum-beacon/v9',
      'example-other/v1',
    ])
    expect(verdict.anchor_plurality.verified_count).toBe(0)
    expect(verdict.anchor_plurality.malformed_count).toBe(0)
    expect(verdict.anchor_plurality.independent_count).toBe(0)
    expect(verdict.hard_reject).toBe(false)
  })

  it('an explicit anchor_type "atrib-log" element still requires the legacy triple', async () => {
    const result = await verifyAnchorProofElement(
      { anchor_type: 'atrib-log', anchor_id: 'log-x', proof: {} },
      RECORD_HASH,
      { trust_material: { logs: {} } },
    )
    expect(result.status).toBe('malformed')
    expect(result.anchorType).toBe('atrib-log')
  })

  it('a non-object element is malformed, not a crash (§5.8)', async () => {
    const bundle = {
      record_hash: RECORD_HASH,
      log_proofs: [null as unknown as AnchorProofElement],
    }
    const verdict = await verifyAnchorPlurality(bundle, {
      trust_material: { logs: {} },
      threshold_m: 0,
    })
    expect(verdict.anchor_plurality.malformed_count).toBe(1)
    expect(verdict.hard_reject).toBe(false)
  })
})

describe('per-type binding: invalid proof, never equivocation', () => {
  it('an rfc3161 token whose hashedMessage differs from the bundle record_hash is invalid, not counted', async () => {
    const log = await makeLog('log-a.unit.test', 11)
    const bundle: AnchorProofBundle = {
      record_hash: RECORD_HASH,
      log_proofs: [await makeAtribLogElement(log), rfc3161Element('ff'.repeat(32), TIME_MS)],
    }
    const verdict = await verifyAnchorPlurality(bundle, trustFor([log]))
    expect(verdict.invalid_indices).toEqual([1])
    expect(verdict.anchor_plurality.verified_count).toBe(1)
    expect(verdict.anchor_plurality.equivocation_detected).toBe(false)
    expect(verdict.anchor_plurality.single_anchor).toBe(true)
    expect(verdict.hard_reject).toBe(false)
  })

  it('an atrib-log proof from a log absent from the trust material is invalid', async () => {
    const known = await makeLog('log-a.unit.test', 11)
    const unknownLog = await makeLog('log-z.unit.test', 12)
    const bundle: AnchorProofBundle = {
      record_hash: RECORD_HASH,
      log_proofs: [await makeAtribLogElement(unknownLog)],
    }
    const verdict = await verifyAnchorPlurality(bundle, trustFor([known], { threshold_m: 0 }))
    expect(verdict.invalid_indices).toEqual([0])
    expect(verdict.anchor_plurality.verified_count).toBe(0)
  })

  it('an OTS proof with a complete status but no attested time is invalid', async () => {
    const verdict = await verifyAnchorPlurality(
      { record_hash: RECORD_HASH, log_proofs: [otsElement(RECORD_HASH_HEX, 'complete')] },
      { trust_material: { logs: {} }, threshold_m: 0 },
    )
    expect(verdict.invalid_indices).toEqual([0])
  })
})

describe('§2.11.11 plurality tiering and independence', () => {
  it('pending OTS proofs are counted in pending_count and excluded from independence', async () => {
    const log = await makeLog('log-a.unit.test', 11)
    const bundle: AnchorProofBundle = {
      record_hash: RECORD_HASH,
      log_proofs: [await makeAtribLogElement(log), otsElement(RECORD_HASH_HEX, 'pending')],
    }
    const verdict = await verifyAnchorPlurality(bundle, trustFor([log]))
    expect(verdict.anchor_plurality.pending_count).toBe(1)
    expect(verdict.anchor_plurality.verified_count).toBe(1)
    expect(verdict.anchor_plurality.independent_count).toBe(1)
    expect(verdict.anchor_plurality.single_anchor).toBe(true)
    expect(verdict.anchor_plurality.plurality_met).toBe(false)
    // A tier, never a failure.
    expect(verdict.hard_reject).toBe(false)
  })

  it('independence counts distinct operator groups; a declared group collapses two logs to one', async () => {
    const logA = await makeLog('log-a.unit.test', 11)
    const logB = await makeLog('log-b.unit.test', 13)
    const bundle: AnchorProofBundle = {
      record_hash: RECORD_HASH,
      log_proofs: [await makeAtribLogElement(logA), await makeAtribLogElement(logB)],
    }

    const defaultVerdict = await verifyAnchorPlurality(bundle, trustFor([logA, logB]))
    expect(defaultVerdict.anchor_plurality.independent_count).toBe(2)
    expect(defaultVerdict.anchor_plurality.plurality_met).toBe(true)
    expect(defaultVerdict.anchor_plurality.single_anchor).toBe(false)

    const groupedVerdict = await verifyAnchorPlurality(
      bundle,
      trustFor([logA, logB], {
        operator_groups: [
          {
            group: 'same-operator',
            members: [
              { anchor_type: 'atrib-log', anchor_id: logA.logId },
              { anchor_type: 'atrib-log', anchor_id: logB.logId },
            ],
          },
        ],
      }),
    )
    expect(groupedVerdict.anchor_plurality.independent_count).toBe(1)
    expect(groupedVerdict.anchor_plurality.single_anchor).toBe(true)
    expect(groupedVerdict.anchor_plurality.plurality_met).toBe(false)
    expect(groupedVerdict.hard_reject).toBe(false)
  })

  it('anchorOperatorGroup defaults to one group per distinct (anchor_type, anchor_id) pair', () => {
    const trust: AnchorTrustConfig = { trust_material: { logs: {} } }
    expect(anchorOperatorGroup('atrib-log', 'log-a', trust)).not.toBe(
      anchorOperatorGroup('atrib-log', 'log-b', trust),
    )
    expect(anchorOperatorGroup('atrib-log', 'x', trust)).not.toBe(
      anchorOperatorGroup('rfc3161-tsa', 'x', trust),
    )
  })

  it('anchored_at_range_ms spans min/max attested times among verified anchors', async () => {
    const bundle: AnchorProofBundle = {
      record_hash: RECORD_HASH,
      log_proofs: [
        rfc3161Element(RECORD_HASH_HEX, TIME_MS + 1000),
        otsElement(RECORD_HASH_HEX, 'complete', TIME_MS + 90_000),
      ],
    }
    const verdict = await verifyAnchorPlurality(bundle, {
      trust_material: { logs: {} },
      threshold_m: 0,
    })
    expect(verdict.anchor_plurality.verified_count).toBe(2)
    expect(verdict.anchor_plurality.anchored_at_range_ms).toEqual([
      TIME_MS + 1000,
      TIME_MS + 90_000,
    ])
    // Time-window disagreement is informational, never a rejection.
    expect(verdict.hard_reject).toBe(false)
  })

  it('required_anchors overrides the default plurality bar of 2', async () => {
    const log = await makeLog('log-a.unit.test', 11)
    const bundle: AnchorProofBundle = {
      record_hash: RECORD_HASH,
      log_proofs: [await makeAtribLogElement(log)],
    }
    const verdict = await verifyAnchorPlurality(bundle, trustFor([log], { required_anchors: 1 }))
    expect(verdict.anchor_plurality.plurality_met).toBe(true)
    expect(verdict.anchor_plurality.single_anchor).toBe(true)
  })
})

describe('§2.11.4 hard conditions, unchanged', () => {
  it('threshold M=2 with one trusted verified proof hard-rejects; untrusted proofs surfaced not counted', async () => {
    const trusted = await makeLog('log-a.unit.test', 11)
    const untrusted = await makeLog('log-u.unit.test', 17)
    const bundle: AnchorProofBundle = {
      record_hash: RECORD_HASH,
      log_proofs: [await makeAtribLogElement(trusted), await makeAtribLogElement(untrusted)],
    }
    const trust = trustFor([trusted, untrusted], {
      trusted_logs: [trusted.logId],
      threshold_m: 2,
    })
    const verdict = await verifyAnchorPlurality(bundle, trust)
    expect(verdict.trusted_verified_count).toBe(1)
    expect(verdict.cross_log_threshold_not_met).toBe(true)
    expect(verdict.untrusted_surfaced).toEqual([untrusted.logId])
    expect(verdict.hard_reject).toBe(true)
    // Tiering is orthogonal: plurality is met even while M rejects.
    expect(verdict.anchor_plurality.plurality_met).toBe(true)
  })

  it('two trusted logs committing different leaf bytes for the same record_hash is equivocation: hard reject, pair surfaced', async () => {
    const logA = await makeLog('log-a.unit.test', 11)
    const logB = await makeLog('log-b.unit.test', 13)
    const bundle: AnchorProofBundle = {
      record_hash: RECORD_HASH,
      log_proofs: [
        await makeAtribLogElement(logA, { timestampMs: TIME_MS }),
        // Same record_hash, different committed timestamp: leaf bytes differ.
        await makeAtribLogElement(logB, { timestampMs: TIME_MS + 999_999 }),
      ],
    }
    const verdict = await verifyAnchorPlurality(bundle, trustFor([logA, logB]))
    expect(verdict.cross_log_equivocation_detected).toBe(true)
    expect(verdict.anchor_plurality.equivocation_detected).toBe(true)
    expect(verdict.hard_reject).toBe(true)
    expect(verdict.disagreeing_pair).not.toBeNull()
    expect(verdict.disagreeing_pair?.log_id_a).toBe(logA.logId)
    expect(verdict.disagreeing_pair?.log_id_b).toBe(logB.logId)
    expect(verdict.disagreeing_pair?.leaf_hash_a_hex).not.toBe(
      verdict.disagreeing_pair?.leaf_hash_b_hex,
    )
  })

  it('a trusted log answering not-found inside the epoch window is censorship-shaped: flagged with the silent log, never rejected', async () => {
    const logA = await makeLog('log-a.unit.test', 11)
    const logB = await makeLog('log-b.unit.test', 13)
    const bundle: AnchorProofBundle = {
      record_hash: RECORD_HASH,
      log_proofs: [await makeAtribLogElement(logA)],
    }
    const verdict = await verifyAnchorPlurality(bundle, trustFor([logA, logB]), [
      { log_id: logB.logId, status: 'not_found', epoch_window_ms: [TIME_MS, TIME_MS + 60_000] },
    ])
    expect(verdict.cross_log_censorship_suspected).toBe(true)
    expect(verdict.silent_log).toBe(logB.logId)
    expect(verdict.hard_reject).toBe(false)
  })
})

describe('§5.8 / determinism discipline', () => {
  it('a structurally hopeless bundle degrades to zero counts without throwing', async () => {
    const garbage = { record_hash: 42, log_proofs: 'nope' } as unknown as AnchorProofBundle
    const verdict = await verifyAnchorPlurality(garbage, {
      trust_material: { logs: {} },
      threshold_m: 0,
    })
    expect(verdict.anchor_plurality).toEqual({
      proof_count: 0,
      verified_count: 0,
      pending_count: 0,
      malformed_count: 0,
      unknown_types: [],
      independent_count: 0,
      plurality_met: false,
      single_anchor: false,
      equivocation_detected: false,
      anchored_at_range_ms: null,
    })
    expect(verdict.hard_reject).toBe(false)
  })

  it('two runs over identical input produce identical verdicts (§4.6-style)', async () => {
    const log = await makeLog('log-a.unit.test', 11)
    const bundle: AnchorProofBundle = {
      record_hash: RECORD_HASH,
      log_proofs: [
        await makeAtribLogElement(log),
        rfc3161Element(RECORD_HASH_HEX, TIME_MS + 1000),
        otsElement(RECORD_HASH_HEX, 'pending'),
        { anchor_type: 'example-quantum-beacon/v9', anchor_id: 'b', proof: {} },
        { anchor_type: 'rfc3161-tsa' },
      ],
    }
    const trust = trustFor([log])
    const first = await verifyAnchorPlurality(bundle, trust)
    const second = await verifyAnchorPlurality(bundle, trust)
    expect(second).toEqual(first)
    expect(first.anchor_plurality.proof_count).toBe(5)
    expect(first.anchor_plurality.verified_count).toBe(2)
    expect(first.anchor_plurality.pending_count).toBe(1)
    expect(first.anchor_plurality.malformed_count).toBe(1)
    expect(first.anchor_plurality.unknown_types).toEqual(['example-quantum-beacon/v9'])
    expect(first.anchor_plurality.plurality_met).toBe(true)
  })
})
