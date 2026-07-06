// SPDX-License-Identifier: Apache-2.0

/**
 * Producer-side delegation-certificate tests (spec §1.11 / D140).
 *
 * Pins `issueDelegationCertificate`, `delegationCertHash`,
 * `withDelegationCertHash`, and `buildRunKeyRevocationRecord` against the
 * spec/conformance/delegation-certificates/ corpus: certificates and
 * records built through this module must be BYTE-IDENTICAL to the corpus
 * construction (Ed25519 is deterministic, so full-object equality is the
 * strongest possible pin). Also covers the unit-level punch-list gaps:
 * malformed-key certificates at issuance and the §5.8 degradation
 * contract for the genesis-stamp helper (never throws, never blocks
 * signing, `atrib:`-prefixed logging).
 */

import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildRunKeyRevocationRecord,
  delegationCertErrors,
  delegationCertHash,
  delegationCertSigningInput,
  issueDelegationCertificate,
  withDelegationCertHash,
  DELEGATION_CERT_TYPE,
  EVENT_TYPE_KEY_REVOCATION_URI,
  type DelegationCertificate,
  type DelegatedAtribRecord,
} from '../src/delegation.js'
import { signRecord, verifyRecord, getPublicKey } from '../src/signing.js'
import { base64urlEncode } from '../src/base64url.js'
import { sha256, hexEncode } from '../src/hash.js'
import { canonicalRecord } from '../src/canon.js'
import { genesisChainRoot } from '../src/chain-root.js'
import type { AtribRecord } from '../src/types.js'

const CORPUS = join(__dirname, '../../../spec/conformance/delegation-certificates/cases')

// Corpus seeds (see the generator: principal 0x01 fill, run 0x02 fill).
const PRINCIPAL_SEED = new Uint8Array(32).fill(0x01)
const RUN_SEED = new Uint8Array(32).fill(0x02)

interface CaseFile {
  input: Record<string, unknown>
  expected: Record<string, unknown>
}

function loadCase(name: string): CaseFile {
  return JSON.parse(readFileSync(join(CORPUS, `${name}.json`), 'utf8')) as CaseFile
}

function recordHash(record: AtribRecord): string {
  return `sha256:${hexEncode(sha256(canonicalRecord(record)))}`
}

let warnSpy: MockInstance

beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  warnSpy.mockRestore()
})

function expectAtribWarning(): void {
  expect(warnSpy).toHaveBeenCalled()
  const first = warnSpy.mock.calls[0]?.[0]
  expect(String(first)).toMatch(/^atrib:/)
}

describe('issueDelegationCertificate (§1.11.1 / §1.11.2)', () => {
  it('reproduces the cert-canonical-full corpus certificate byte-for-byte', async () => {
    const c = loadCase('cert-canonical-full')
    const corpusCert = c.input.certificate as DelegationCertificate
    const expected = c.expected as { cert_hash: string; canonical_signing_input_utf8: string }

    const issued = await issueDelegationCertificate(PRINCIPAL_SEED, {
      run_pubkey: corpusCert.run_pubkey,
      not_after: corpusCert.not_after,
      not_before: corpusCert.not_before!,
      context_id: corpusCert.context_id!,
      scope: corpusCert.scope!,
    })

    // Ed25519 is deterministic: full-object equality including signature.
    expect(issued).toEqual(corpusCert)
    expect(delegationCertHash(issued)).toBe(expected.cert_hash)
    expect(new TextDecoder().decode(delegationCertSigningInput(issued))).toBe(
      expected.canonical_signing_input_utf8,
    )
    expect(await delegationCertErrors(issued)).toEqual([])
  })

  it('reproduces the cert-canonical-minimal corpus certificate (absence-not-null)', async () => {
    const c = loadCase('cert-canonical-minimal')
    const corpusCert = c.input.certificate as DelegationCertificate
    const expected = c.expected as { cert_hash: string }

    const issued = await issueDelegationCertificate(PRINCIPAL_SEED, {
      run_pubkey: corpusCert.run_pubkey,
      not_after: corpusCert.not_after,
    })

    expect(issued).toEqual(corpusCert)
    expect(delegationCertHash(issued)).toBe(expected.cert_hash)
    // Optional fields are OMITTED, never null.
    expect('context_id' in issued).toBe(false)
    expect('not_before' in issued).toBe(false)
    expect('scope' in issued).toBe(false)
  })

  it('sets the literal cert_type discriminator', async () => {
    const runKey = base64urlEncode(await getPublicKey(RUN_SEED))
    const issued = await issueDelegationCertificate(PRINCIPAL_SEED, {
      run_pubkey: runKey,
      not_after: Date.UTC(2026, 0, 1),
    })
    expect(issued.cert_type).toBe(DELEGATION_CERT_TYPE)
    expect(DELEGATION_CERT_TYPE).toBe('atrib/delegation-cert/v1')
  })

  it('refuses a self-certificate (run_pubkey === principal_key)', async () => {
    const principalKey = base64urlEncode(await getPublicKey(PRINCIPAL_SEED))
    await expect(
      issueDelegationCertificate(PRINCIPAL_SEED, {
        run_pubkey: principalKey,
        not_after: Date.UTC(2026, 0, 1),
      }),
    ).rejects.toThrow(/^atrib: .*self-certificate/)
  })

  it('refuses malformed run keys (punch list: malformed-key certificates)', async () => {
    const notBase64url = 'not!!valid@@base64url'
    const wrongLength = base64urlEncode(new Uint8Array(16).fill(7))
    for (const bad of [notBase64url, wrongLength, '']) {
      await expect(
        issueDelegationCertificate(PRINCIPAL_SEED, {
          run_pubkey: bad,
          not_after: Date.UTC(2026, 0, 1),
        }),
      ).rejects.toThrow(/^atrib: run_pubkey/)
    }
  })

  it('refuses malformed seeds, windows, and context ids', async () => {
    const runKey = base64urlEncode(await getPublicKey(RUN_SEED))
    await expect(
      issueDelegationCertificate(new Uint8Array(16), { run_pubkey: runKey, not_after: 1 }),
    ).rejects.toThrow(/^atrib: principal seed/)
    await expect(
      issueDelegationCertificate(PRINCIPAL_SEED, { run_pubkey: runKey, not_after: 0 }),
    ).rejects.toThrow(/^atrib: not_after/)
    await expect(
      issueDelegationCertificate(PRINCIPAL_SEED, { run_pubkey: runKey, not_after: 1.5 }),
    ).rejects.toThrow(/^atrib: not_after/)
    await expect(
      issueDelegationCertificate(PRINCIPAL_SEED, {
        run_pubkey: runKey,
        not_after: 1_000,
        not_before: 2_000,
      }),
    ).rejects.toThrow(/^atrib: not_before/)
    await expect(
      issueDelegationCertificate(PRINCIPAL_SEED, {
        run_pubkey: runKey,
        not_after: 1_000,
        context_id: 'NOT-32-HEX',
      }),
    ).rejects.toThrow(/^atrib: context_id/)
  })
})

describe('delegationCertErrors (§1.11.2 evidence validity)', () => {
  it('flags malformed principal and run keys with dedicated errors', async () => {
    const runKey = base64urlEncode(await getPublicKey(RUN_SEED))
    const principalKey = base64urlEncode(await getPublicKey(PRINCIPAL_SEED))
    const base: DelegationCertificate = {
      cert_type: DELEGATION_CERT_TYPE,
      not_after: Date.UTC(2026, 0, 1),
      principal_key: principalKey,
      run_pubkey: runKey,
      signature: 'A'.repeat(86),
    }
    expect(await delegationCertErrors({ ...base, principal_key: 'short' })).toEqual([
      'principal_key_malformed',
    ])
    expect(await delegationCertErrors({ ...base, run_pubkey: '!!!' })).toEqual([
      'run_pubkey_malformed',
    ])
    expect(
      await delegationCertErrors({ ...base, principal_key: 'short', run_pubkey: '!!!' }),
    ).toEqual(['principal_key_malformed', 'run_pubkey_malformed'])
  })

  it('accepts a freshly issued certificate and rejects a tampered one', async () => {
    const runKey = base64urlEncode(await getPublicKey(RUN_SEED))
    const issued = await issueDelegationCertificate(PRINCIPAL_SEED, {
      run_pubkey: runKey,
      not_after: Date.UTC(2026, 0, 1),
    })
    expect(await delegationCertErrors(issued)).toEqual([])
    // Tampering with a signed field breaks the principal signature.
    expect(await delegationCertErrors({ ...issued, not_after: issued.not_after + 1 })).toEqual([
      'principal_signature_invalid',
    ])
  })
})

describe('withDelegationCertHash (§1.11.3 genesis stamp, §5.8 degradation)', () => {
  it('composes with the existing signRecord flow to reproduce the corpus genesis record', async () => {
    const c = loadCase('genesis-field-canonical-form')
    const withField = c.input.record_with_field as DelegatedAtribRecord
    const withoutField = c.input.record_without_field as DelegatedAtribRecord
    const certificate = c.input.certificate as DelegationCertificate
    const expected = c.expected as { with_field_record_hash: string }

    // Rebuild the unsigned genesis body, stamp, then sign through the
    // EXISTING signRecord path — no delegation-specific signing exists.
    const { signature: _sig, ...unsignedFields } = withoutField
    const unsigned = { ...unsignedFields, signature: '' } as AtribRecord
    const stamped = withDelegationCertHash(unsigned, certificate)
    const signed = await signRecord(stamped, RUN_SEED)

    expect(signed).toEqual(withField)
    expect(recordHash(signed)).toBe(expected.with_field_record_hash)
    expect(await verifyRecord(signed)).toBe(true)
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('accepts a pre-computed cert hash string', () => {
    const c = loadCase('genesis-field-canonical-form')
    const withoutField = c.input.record_without_field as DelegatedAtribRecord
    const certificate = c.input.certificate as DelegationCertificate
    const stamped = withDelegationCertHash(withoutField, delegationCertHash(certificate))
    expect(stamped.delegation_cert_hash).toBe(delegationCertHash(certificate))
  })

  it('inserts the field in the JCS lexicographic slot (creator_key < field < event_type)', () => {
    const c = loadCase('genesis-field-canonical-form')
    const withoutField = c.input.record_without_field as DelegatedAtribRecord
    const certificate = c.input.certificate as DelegationCertificate
    const stamped = withDelegationCertHash(withoutField, certificate)
    const keys = Object.keys(stamped)
    const fieldIdx = keys.indexOf('delegation_cert_hash')
    expect(fieldIdx).toBeGreaterThan(keys.indexOf('creator_key'))
    expect(fieldIdx).toBeLessThan(keys.indexOf('event_type'))
  })

  it('returns the record UNCHANGED for a non-genesis record (genesis-only discipline)', () => {
    const c = loadCase('genesis-field-canonical-form')
    const record = c.input.record_without_field as DelegatedAtribRecord
    const certificate = c.input.certificate as DelegationCertificate
    const nonGenesis = { ...record, chain_root: recordHash(record) }
    const out = withDelegationCertHash(nonGenesis, certificate)
    expect(out).toBe(nonGenesis)
    expect('delegation_cert_hash' in out).toBe(false)
    expectAtribWarning()
  })

  it('returns the record UNCHANGED for a malformed hash string', () => {
    const c = loadCase('genesis-field-canonical-form')
    const record = c.input.record_without_field as DelegatedAtribRecord
    const out = withDelegationCertHash(record, 'sha256:NOT-HEX')
    expect(out).toBe(record)
    expectAtribWarning()
  })

  it('returns the record UNCHANGED when the certificate does not cover its own creator_key', async () => {
    const c = loadCase('genesis-field-canonical-form')
    const record = c.input.record_without_field as DelegatedAtribRecord
    const otherRunKey = base64urlEncode(await getPublicKey(new Uint8Array(32).fill(0x05)))
    const otherCert = await issueDelegationCertificate(PRINCIPAL_SEED, {
      run_pubkey: otherRunKey,
      not_after: record.timestamp + 3_600_000,
    })
    const out = withDelegationCertHash(record, otherCert)
    expect(out).toBe(record)
    expectAtribWarning()
  })

  it('returns the record UNCHANGED when the certificate is expired at the record timestamp (§1.11.10)', () => {
    const c = loadCase('genesis-field-canonical-form')
    const record = c.input.record_without_field as DelegatedAtribRecord
    const certificate = c.input.certificate as DelegationCertificate
    const expired = { ...record, timestamp: certificate.not_after + 1 }
    const out = withDelegationCertHash(expired, certificate)
    expect(out).toBe(expired)
    expectAtribWarning()
  })

  it('never throws, even on garbage input (§5.8)', () => {
    const c = loadCase('genesis-field-canonical-form')
    const certificate = c.input.certificate as DelegationCertificate
    expect(() =>
      withDelegationCertHash(null as unknown as AtribRecord, certificate),
    ).not.toThrow()
    expect(() =>
      withDelegationCertHash({} as AtribRecord, certificate),
    ).not.toThrow()
    expect(() =>
      withDelegationCertHash(
        { context_id: 42 } as unknown as AtribRecord,
        certificate,
      ),
    ).not.toThrow()
  })
})

describe('buildRunKeyRevocationRecord (§1.11.5 / §1.9.2 rule 3)', () => {
  it('reproduces the revocation-run-key corpus record byte-for-byte', async () => {
    const c = loadCase('revocation-run-key')
    const entries = c.input.log_entries as { log_index: number; record: AtribRecord }[]
    const certs = c.input.certificates as DelegationCertificate[]
    const expected = c.expected as {
      record_hashes: Record<string, string>
      revocation_canonical_signing_input_utf8: string
    }
    const corpusRevocation = entries.find(
      (e) => e.record.event_type === EVENT_TYPE_KEY_REVOCATION_URI,
    )!.record

    const built = await buildRunKeyRevocationRecord(PRINCIPAL_SEED, {
      certificate: certs[0]!,
      context_id: corpusRevocation.context_id,
      revocation_reason: 'compromise',
      content_id: corpusRevocation.content_id,
      timestamp: corpusRevocation.timestamp,
    })

    expect(built).toEqual(corpusRevocation)
    expect(recordHash(built)).toBe(expected.record_hashes['2'])
    expect(built.delegation_cert_hash).toBe(delegationCertHash(certs[0]!))
    expect(built.revoked_key).toBe(certs[0]!.run_pubkey)
    expect(built.chain_root).toBe(genesisChainRoot(built.context_id))
    // The record verifies through the UNCHANGED §1.4.3 procedure.
    expect(await verifyRecord(built)).toBe(true)
  })

  it('refuses to build when the signing seed is not the certificate principal', async () => {
    const c = loadCase('revocation-run-key')
    const certs = c.input.certificates as DelegationCertificate[]
    await expect(
      buildRunKeyRevocationRecord(new Uint8Array(32).fill(0x04), {
        certificate: certs[0]!,
        context_id: 'b7'.repeat(16),
        revocation_reason: 'compromise',
        content_id: `sha256:${'f2'.repeat(32)}`,
      }),
    ).rejects.toThrow(/^atrib: signing seed is not the certificate principal/)
  })

  it('refuses to build over a certificate that is invalid as evidence', async () => {
    const principalKey = base64urlEncode(await getPublicKey(PRINCIPAL_SEED))
    // Hand-construct a self-certificate (issuance refuses to make one).
    const selfCert: DelegationCertificate = {
      cert_type: DELEGATION_CERT_TYPE,
      not_after: Date.UTC(2026, 0, 1),
      principal_key: principalKey,
      run_pubkey: principalKey,
      signature: 'A'.repeat(86),
    }
    await expect(
      buildRunKeyRevocationRecord(PRINCIPAL_SEED, {
        certificate: selfCert,
        context_id: 'b7'.repeat(16),
        revocation_reason: 'compromise',
        content_id: `sha256:${'f2'.repeat(32)}`,
      }),
    ).rejects.toThrow(/^atrib: certificate is invalid/)
  })

  it('refuses reasons outside the §1.11.5 pair and malformed context ids', async () => {
    const c = loadCase('revocation-run-key')
    const certs = c.input.certificates as DelegationCertificate[]
    await expect(
      buildRunKeyRevocationRecord(PRINCIPAL_SEED, {
        certificate: certs[0]!,
        context_id: 'b7'.repeat(16),
        revocation_reason: 'rotation' as 'compromise',
        content_id: `sha256:${'f2'.repeat(32)}`,
      }),
    ).rejects.toThrow(/^atrib: run-key revocation_reason/)
    await expect(
      buildRunKeyRevocationRecord(PRINCIPAL_SEED, {
        certificate: certs[0]!,
        context_id: 'not-hex',
        revocation_reason: 'compromise',
        content_id: `sha256:${'f2'.repeat(32)}`,
      }),
    ).rejects.toThrow(/^atrib: context_id/)
  })
})
