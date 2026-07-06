// SPDX-License-Identifier: Apache-2.0

/**
 * Unit tests for the promoted §1.11 delegation library (src/delegation.ts),
 * covering the tranche-1 punch-list gaps that fit at unit level:
 *
 *   - malformed-key certificate family (principal_key / run_pubkey not a
 *     well-formed §1.4.1 key → dedicated rejection errors, walk falls
 *     back to depth 0, never invalidation)
 *   - the §1.11.4 ambiguity rule (two valid certificates from DIFFERENT
 *     principals covering the same run key in overlapping windows →
 *     surface both, never choose)
 *   - the §1.11.2 depth limit (principal_key MUST NOT itself be a run
 *     key under another valid certificate → delegation_depth_exceeded,
 *     fall back to depth 0)
 *
 * Plus the signed-by qualifier regression (a genesis commitment by
 * ANOTHER producer never yields delegation_unresolved for this record's
 * signer), the revokedKeys option, and never-throw degradation.
 *
 * The corpus cases stay pinned in
 * conformance-delegation-certificates.test.ts; these vectors extend the
 * open coverage families tracked in docs/redesign-upgrade-path.md.
 */

import { describe, it, expect } from 'vitest'
import * as ed from '@noble/ed25519'
import { sha512 } from '@noble/hashes/sha2.js'
import { base64urlEncode, genesisChainRoot } from '@atrib/mcp'
import {
  checkDelegationScope,
  delegationCertErrors,
  delegationCertHash,
  delegationCertSignatureVerifies,
  delegationCertSigningInput,
  evaluateDelegation,
  evaluateRevokerAuthorization,
  type DelegatedRecord,
  type DelegationCertificate,
  type KeyRevocationRecordLike,
} from '../src/delegation.js'

// @noble/ed25519 v3 needs sha512 wired (idempotent).
ed.hashes.sha512 = sha512
ed.hashes.sha512Async = (m) => Promise.resolve(sha512(m))

const T0 = Date.UTC(2026, 0, 1)
const HOUR = 3_600_000
const CTX = 'c9'.repeat(16)

// Deterministic key material (distinct from the corpus seeds).
const P1_SEED = new Uint8Array(32).fill(0x11)
const P2_SEED = new Uint8Array(32).fill(0x12)
const R1_SEED = new Uint8Array(32).fill(0x21)
const R2_SEED = new Uint8Array(32).fill(0x22)
const ROGUE_SEED = new Uint8Array(32).fill(0x2f)

async function pub(seed: Uint8Array): Promise<string> {
  return base64urlEncode(await ed.getPublicKeyAsync(seed))
}

async function signCert(
  unsigned: Omit<DelegationCertificate, 'signature'>,
  seed: Uint8Array,
): Promise<DelegationCertificate> {
  const input = delegationCertSigningInput({ ...unsigned, signature: '' })
  return { ...unsigned, signature: base64urlEncode(await ed.signAsync(input, seed)) }
}

function runRecord(creatorKey: string, timestamp: number, extra: Partial<DelegatedRecord> = {}): DelegatedRecord {
  return {
    spec_version: 'atrib/1.0',
    content_id: `sha256:${'aa'.repeat(32)}`,
    creator_key: creatorKey,
    chain_root: genesisChainRoot(CTX),
    event_type: 'https://atrib.dev/v1/types/tool_call',
    context_id: CTX,
    timestamp,
    tool_name: 'search',
    signature: '',
    ...extra,
  }
}

const DEPTH0 = {
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
}

describe('malformed-key certificates (§1.11.2 / §1.4.1)', () => {
  it('flags a malformed principal_key and falls back to depth 0 in the walk', async () => {
    const r1 = await pub(R1_SEED)
    const cert: DelegationCertificate = {
      cert_type: 'atrib/delegation-cert/v1',
      not_after: T0 + HOUR,
      principal_key: 'definitely-not-32-bytes',
      run_pubkey: r1,
      signature: 'A'.repeat(86),
    }
    expect(await delegationCertErrors(cert)).toEqual(['principal_key_malformed'])

    const record = runRecord(r1, T0 + 1_000)
    const outcome = await evaluateDelegation(record, record, [cert])
    expect(outcome).toEqual({
      ...DEPTH0,
      cert_hash: delegationCertHash(cert),
      cert_valid: false,
      errors: ['principal_key_malformed'],
    })
  })

  it('flags a malformed run_pubkey', async () => {
    const p1 = await pub(P1_SEED)
    const cert: DelegationCertificate = {
      cert_type: 'atrib/delegation-cert/v1',
      not_after: T0 + HOUR,
      principal_key: p1,
      run_pubkey: '@@@not-base64url@@@',
      signature: 'A'.repeat(86),
    }
    expect(await delegationCertErrors(cert)).toEqual(['run_pubkey_malformed'])
  })

  it('flags both keys when both are malformed, in stable order', async () => {
    const cert: DelegationCertificate = {
      cert_type: 'atrib/delegation-cert/v1',
      not_after: T0 + HOUR,
      principal_key: '',
      run_pubkey: base64urlEncode(new Uint8Array(8)),
      signature: 'A'.repeat(86),
    }
    expect(await delegationCertErrors(cert)).toEqual([
      'principal_key_malformed',
      'run_pubkey_malformed',
    ])
  })

  it('degrades a garbage signature to principal_signature_invalid without throwing', async () => {
    const p1 = await pub(P1_SEED)
    const r1 = await pub(R1_SEED)
    const cert: DelegationCertificate = {
      cert_type: 'atrib/delegation-cert/v1',
      not_after: T0 + HOUR,
      principal_key: p1,
      run_pubkey: r1,
      signature: '!!!not base64url!!!',
    }
    expect(await delegationCertSignatureVerifies(cert)).toBe(false)
    expect(await delegationCertErrors(cert)).toEqual(['principal_signature_invalid'])
  })
})

describe('ambiguity rule (§1.11.4)', () => {
  it('surfaces both certificates when two principals cover one run key in overlapping windows', async () => {
    const r1 = await pub(R1_SEED)
    const certP1 = await signCert(
      {
        cert_type: 'atrib/delegation-cert/v1',
        context_id: CTX,
        not_after: T0 + HOUR,
        not_before: T0,
        principal_key: await pub(P1_SEED),
        run_pubkey: r1,
        scope: { tool_names: ['search'] },
      },
      P1_SEED,
    )
    const certP2 = await signCert(
      {
        cert_type: 'atrib/delegation-cert/v1',
        not_after: T0 + 2 * HOUR,
        not_before: T0 + HOUR / 2, // overlaps certP1's window
        principal_key: await pub(P2_SEED),
        run_pubkey: r1,
      },
      P2_SEED,
    )

    const record = runRecord(r1, T0 + HOUR / 2 + 1_000)
    const outcome = await evaluateDelegation(record, null, [certP1, certP2])

    expect(outcome.delegation_ambiguous).toBe(true)
    expect(outcome.depth).toBe(0)
    expect(outcome.principal_key).toBeNull()
    expect(outcome.errors).toEqual([])
    expect(outcome.candidates).toHaveLength(2)
    const principals = outcome.candidates!.map((c) => c.principal_key).sort()
    expect(principals).toEqual([await pub(P1_SEED), await pub(P2_SEED)].sort())
    // Each candidate surfaces its own facts rather than a chosen one.
    const p1Candidate = outcome.candidates!.find(
      (c) => c.cert_hash === delegationCertHash(certP1),
    )!
    expect(p1Candidate.context_bound).toBe(true)
    expect(p1Candidate.scope_check?.in_scope).toBe(true)
    const p2Candidate = outcome.candidates!.find(
      (c) => c.cert_hash === delegationCertHash(certP2),
    )!
    expect(p2Candidate.context_bound).toBeNull() // no context_id on certP2
    expect(p2Candidate.scope_check).toBeNull()
  })

  it('does not fire for two certificates from the SAME principal', async () => {
    const r1 = await pub(R1_SEED)
    const p1 = await pub(P1_SEED)
    const older = await signCert(
      {
        cert_type: 'atrib/delegation-cert/v1',
        not_after: T0 + HOUR,
        not_before: T0,
        principal_key: p1,
        run_pubkey: r1,
      },
      P1_SEED,
    )
    const renewal = await signCert(
      {
        cert_type: 'atrib/delegation-cert/v1',
        not_after: T0 + 3 * HOUR,
        not_before: T0 + HOUR / 2,
        principal_key: p1,
        run_pubkey: r1,
      },
      P1_SEED,
    )
    const record = runRecord(r1, T0 + 2 * HOUR)
    const outcome = await evaluateDelegation(record, null, [older, renewal])
    expect(outcome.delegation_ambiguous).toBeUndefined()
    expect(outcome.depth).toBe(1)
    expect(outcome.principal_key).toBe(p1)
    // In-window preference: the renewal covers the record's timestamp.
    expect(outcome.cert_hash).toBe(delegationCertHash(renewal))
    expect(outcome.in_window).toBe(true)
  })

  it('does not fire for different principals with NON-overlapping windows; picks the in-window cert', async () => {
    const r1 = await pub(R1_SEED)
    const early = await signCert(
      {
        cert_type: 'atrib/delegation-cert/v1',
        not_after: T0 + HOUR,
        not_before: T0,
        principal_key: await pub(P1_SEED),
        run_pubkey: r1,
      },
      P1_SEED,
    )
    const late = await signCert(
      {
        cert_type: 'atrib/delegation-cert/v1',
        not_after: T0 + 4 * HOUR,
        not_before: T0 + 2 * HOUR,
        principal_key: await pub(P2_SEED),
        run_pubkey: r1,
      },
      P2_SEED,
    )
    const record = runRecord(r1, T0 + 3 * HOUR)
    const outcome = await evaluateDelegation(record, null, [early, late])
    expect(outcome.delegation_ambiguous).toBeUndefined()
    expect(outcome.depth).toBe(1)
    expect(outcome.principal_key).toBe(await pub(P2_SEED))
    expect(outcome.in_window).toBe(true)
  })
})

describe('depth limit (§1.11.2: principal MUST NOT be a run key)', () => {
  it('rejects a chained certificate with delegation_depth_exceeded and falls back to depth 0', async () => {
    const p1 = await pub(P1_SEED)
    const r1 = await pub(R1_SEED)
    const r2 = await pub(R2_SEED)
    // certA: P1 certifies R1. certB: R1 (acting as principal) certifies R2.
    const certA = await signCert(
      {
        cert_type: 'atrib/delegation-cert/v1',
        not_after: T0 + HOUR,
        not_before: T0,
        principal_key: p1,
        run_pubkey: r1,
      },
      P1_SEED,
    )
    const certB = await signCert(
      {
        cert_type: 'atrib/delegation-cert/v1',
        not_after: T0 + HOUR,
        not_before: T0,
        principal_key: r1,
        run_pubkey: r2,
      },
      R1_SEED,
    )

    const record = runRecord(r2, T0 + 1_000)
    const outcome = await evaluateDelegation(record, null, [certA, certB])
    expect(outcome).toEqual({
      ...DEPTH0,
      cert_hash: delegationCertHash(certB),
      cert_valid: false,
      errors: ['delegation_depth_exceeded'],
    })
  })

  it('still resolves the intermediate run key at depth 1', async () => {
    const p1 = await pub(P1_SEED)
    const r1 = await pub(R1_SEED)
    const r2 = await pub(R2_SEED)
    const certA = await signCert(
      {
        cert_type: 'atrib/delegation-cert/v1',
        not_after: T0 + HOUR,
        not_before: T0,
        principal_key: p1,
        run_pubkey: r1,
      },
      P1_SEED,
    )
    const certB = await signCert(
      {
        cert_type: 'atrib/delegation-cert/v1',
        not_after: T0 + HOUR,
        not_before: T0,
        principal_key: r1,
        run_pubkey: r2,
      },
      R1_SEED,
    )
    // R1's own records resolve normally: certA's principal (P1) is not a
    // run key under any certificate.
    const record = runRecord(r1, T0 + 1_000)
    const outcome = await evaluateDelegation(record, null, [certA, certB])
    expect(outcome.depth).toBe(1)
    expect(outcome.principal_key).toBe(p1)
    expect(outcome.errors).toEqual([])
  })

  it('is not demoted by an INVALID certificate naming the principal as a run key', async () => {
    const p1 = await pub(P1_SEED)
    const r1 = await pub(R1_SEED)
    const certA = await signCert(
      {
        cert_type: 'atrib/delegation-cert/v1',
        not_after: T0 + HOUR,
        not_before: T0,
        principal_key: p1,
        run_pubkey: r1,
      },
      P1_SEED,
    )
    // Adversarial: a rogue-signed certificate claiming P1 is a run key of
    // P2. Its principal signature does not verify, so it cannot demote
    // certA to delegation_depth_exceeded.
    const forged = await signCert(
      {
        cert_type: 'atrib/delegation-cert/v1',
        not_after: T0 + HOUR,
        not_before: T0,
        principal_key: await pub(P2_SEED),
        run_pubkey: p1,
      },
      ROGUE_SEED,
    )
    const record = runRecord(r1, T0 + 1_000)
    const outcome = await evaluateDelegation(record, null, [certA, forged])
    expect(outcome.depth).toBe(1)
    expect(outcome.principal_key).toBe(p1)
    expect(outcome.errors).toEqual([])
  })
})

describe('signed-by qualifier and unresolved commitments (§1.11.4 step 2)', () => {
  it('never surfaces delegation_unresolved off another producer\'s genesis commitment', async () => {
    const r1 = await pub(R1_SEED)
    const otherProducer = await pub(P2_SEED)
    // Genesis signed by ANOTHER producer, carrying a delegation_cert_hash
    // for ITS run key. That commitment says nothing about this record's
    // signer (the verifier-pass fix to the signed-by qualifier).
    const genesis = runRecord(otherProducer, T0, {
      delegation_cert_hash: `sha256:${'ab'.repeat(32)}`,
    })
    const record = runRecord(r1, T0 + 1_000)
    const outcome = await evaluateDelegation(record, genesis, [])
    expect(outcome).toEqual(DEPTH0)
    expect(outcome.delegation_unresolved).toBeUndefined()
  })

  it('surfaces delegation_unresolved for the genesis signer\'s own unresolved commitment', async () => {
    const r1 = await pub(R1_SEED)
    const genesis = runRecord(r1, T0, { delegation_cert_hash: `sha256:${'ab'.repeat(32)}` })
    const outcome = await evaluateDelegation(genesis, genesis, [])
    expect(outcome).toEqual({ ...DEPTH0, delegation_unresolved: true })
  })
})

describe('revocation inputs and revoker authorization', () => {
  it('reports revoked when the caller-resolved revoked set names the run key or principal', async () => {
    const p1 = await pub(P1_SEED)
    const r1 = await pub(R1_SEED)
    const cert = await signCert(
      {
        cert_type: 'atrib/delegation-cert/v1',
        not_after: T0 + HOUR,
        not_before: T0,
        principal_key: p1,
        run_pubkey: r1,
      },
      P1_SEED,
    )
    const record = runRecord(r1, T0 + 1_000)

    const plain = await evaluateDelegation(record, null, [cert])
    expect(plain.revoked).toBe(false)

    const runRevoked = await evaluateDelegation(record, null, [cert], {
      revokedKeys: new Set([r1]),
    })
    expect(runRevoked.revoked).toBe(true)

    const principalRevoked = await evaluateDelegation(record, null, [cert], {
      revokedKeys: new Set([p1]),
    })
    expect(principalRevoked.revoked).toBe(true)

    const unrelated = await evaluateDelegation(record, null, [cert], {
      revokedKeys: new Set([await pub(P2_SEED)]),
    })
    expect(unrelated.revoked).toBe(false)
  })

  it('authorizes rule 1 (signed by the key being retired) without a certificate', async () => {
    const r1 = await pub(R1_SEED)
    const revocation: KeyRevocationRecordLike = {
      ...runRecord(r1, T0 + 1_000),
      event_type: 'https://atrib.dev/v1/types/key_revocation',
      revoked_key: r1,
      revocation_reason: 'retirement',
    }
    expect(await evaluateRevokerAuthorization(revocation, [])).toEqual({
      authorized: true,
      rule: 'retired_key',
    })
  })

  it('rejects a foreign signer with no delegation_cert_hash as no_authorization_path', async () => {
    const r1 = await pub(R1_SEED)
    const revocation: KeyRevocationRecordLike = {
      ...runRecord(await pub(P1_SEED), T0 + 1_000),
      event_type: 'https://atrib.dev/v1/types/key_revocation',
      revoked_key: r1,
      revocation_reason: 'compromise',
    }
    expect(await evaluateRevokerAuthorization(revocation, [])).toEqual({
      authorized: false,
      reason: 'no_authorization_path',
    })
  })
})

describe('degradation: the walk never throws', () => {
  it('tolerates structurally hostile certificate objects', async () => {
    const r1 = await pub(R1_SEED)
    const record = runRecord(r1, T0 + 1_000)
    const hostile = [
      { cert_type: 1, not_after: 'soon', principal_key: 7, run_pubkey: r1, signature: null },
      { run_pubkey: r1 },
      null,
      undefined,
    ] as unknown as DelegationCertificate[]
    // Non-object entries cannot match the run-key filter without throwing.
    const outcome = await evaluateDelegation(
      record,
      record,
      hostile.filter((c) => c !== null && c !== undefined),
    )
    expect(outcome.depth).toBe(0)
    expect(outcome.cert_valid).toBe(false)
  })

  it('scope checks only what the record can resolve', async () => {
    const record = runRecord(await pub(R1_SEED), T0 + 1_000)
    // max_amount / counterparties need protocol-event facts; no mismatch
    // from the compact record alone (corpus posture).
    const check = checkDelegationScope(record, {
      tool_names: ['search'],
      event_types: ['https://atrib.dev/v1/types/tool_call'],
      max_amount: { currency: 'USD', value: 1 },
      counterparties: ['merchant.example'],
    })
    expect(check).toEqual({ in_scope: true, attenuation_ok: null, mismatches: [] })

    const { tool_name: _dropped, ...noToolNameFields } = record
    const noToolName = noToolNameFields as DelegatedRecord
    // Without a §8.2 tool_name disclosure the tool_names constraint is not
    // resolvable from the record; no mismatch is asserted.
    expect(checkDelegationScope(noToolName, { tool_names: ['other'] }).in_scope).toBe(true)
    expect(checkDelegationScope(record, { tool_names: ['other'] }).mismatches).toEqual([
      'tool_names',
    ])
  })
})
