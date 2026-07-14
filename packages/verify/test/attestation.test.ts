// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import canonicalize from 'canonicalize'
import {
  base64urlEncode,
  canonicalRecord,
  genesisChainRoot,
  getPublicKey,
  hexEncode,
  sha256,
  signRecord,
  type AtribRecord,
} from '@atrib/mcp'
import {
  resolveAttestationCorroboration,
  isCorroborated,
  EVENT_TYPE_ATTESTATION_EXT_URI,
  type AttestationContent,
  type AttestationInput,
} from '../src/attestation.js'

const CONTEXT = 'a'.repeat(32)
const NOW = 1_782_000_000_000
const seed = (b: number): Uint8Array => new Uint8Array(32).fill(b)
const PRODUCER = seed(0x01)
const A = seed(0x11)
const B = seed(0x22)
const X = seed(0xaa)
const Y = seed(0xbb)
const pub = async (s: Uint8Array): Promise<string> => base64urlEncode(await getPublicKey(s))
const recordHash = (r: AtribRecord): string =>
  'sha256:' + hexEncode(sha256(new TextEncoder().encode(canonicalRecord(r))))

async function observation(topSeed: Uint8Array, contentByte: string): Promise<AtribRecord> {
  return signRecord(
    {
      spec_version: 'atrib/1.0',
      content_id: 'sha256:' + contentByte.repeat(32),
      creator_key: base64urlEncode(await getPublicKey(topSeed)),
      chain_root: genesisChainRoot(CONTEXT),
      event_type: 'https://atrib.dev/v1/types/observation',
      context_id: CONTEXT,
      timestamp: NOW,
      signature: '',
    } as AtribRecord,
    topSeed,
  )
}

async function attestation(
  signerSeed: Uint8Array,
  content: AttestationContent,
  opts: { eventType?: string; corruptCommitment?: boolean } = {},
): Promise<AttestationInput> {
  const argsHash =
    'sha256:' + hexEncode(sha256(new TextEncoder().encode(canonicalize(content) as string)))
  const record = await signRecord(
    {
      spec_version: 'atrib/1.0',
      content_id: 'sha256:' + 'e'.repeat(64),
      creator_key: base64urlEncode(await getPublicKey(signerSeed)),
      chain_root: genesisChainRoot(CONTEXT),
      event_type: opts.eventType ?? EVENT_TYPE_ATTESTATION_EXT_URI,
      context_id: CONTEXT,
      timestamp: NOW,
      signature: '',
      args_hash: opts.corruptCommitment ? 'sha256:' + '0'.repeat(64) : argsHash,
    } as AtribRecord,
    signerSeed,
  )
  return { record, content }
}

describe('resolveAttestationCorroboration (D150)', () => {
  it('corroborates a record vouched for by two trusted attestors', async () => {
    const target = await observation(PRODUCER, '01')
    const targetHash = recordHash(target)
    const content: AttestationContent = { attests: 'reliable', target: targetHash }
    const result = await resolveAttestationCorroboration({
      targetRecordHash: targetHash,
      targetCreatorKey: target.creator_key,
      attestations: [await attestation(A, content), await attestation(B, content)],
      trustedCreatorKeys: [await pub(A), await pub(B)],
    })
    expect(result.attestors_valid).toBe(2)
    expect(result.attestors_trusted).toBe(2)
    expect(result.under_corroborated).toBe(false)
    expect(isCorroborated(result)).toBe(true)
  })

  it('is Sybil-malleable-safe: two untrusted attestors count but do not corroborate', async () => {
    const target = await observation(PRODUCER, '02')
    const targetHash = recordHash(target)
    const content: AttestationContent = { attests: 'reliable', target: targetHash }
    const result = await resolveAttestationCorroboration({
      targetRecordHash: targetHash,
      targetCreatorKey: target.creator_key,
      attestations: [await attestation(X, content), await attestation(Y, content)],
      trustedCreatorKeys: [await pub(A), await pub(B)], // trusts neither X nor Y
    })
    expect(result.attestors_valid).toBe(2) // the footgun: count looks fine
    expect(result.attestors_trusted).toBe(0)
    expect(result.under_corroborated).toBe(true)
    expect(isCorroborated(result)).toBe(false)
  })

  it('rejects self-attestation: a producer cannot corroborate its own record', async () => {
    const target = await observation(PRODUCER, '03')
    const targetHash = recordHash(target)
    const content: AttestationContent = { attests: 'reliable', target: targetHash }
    const result = await resolveAttestationCorroboration({
      targetRecordHash: targetHash,
      targetCreatorKey: target.creator_key,
      attestations: [await attestation(PRODUCER, content), await attestation(A, content)],
      trustedCreatorKeys: [await pub(PRODUCER), await pub(A)],
    })
    expect(result.attestors_valid).toBe(1) // only A counts; producer self-attestation dropped
    expect(result.rejected.some((r) => r.reasons.includes('self_attestation'))).toBe(true)
  })

  it('does NOT count an annotation record as corroboration (no masquerade)', async () => {
    const target = await observation(PRODUCER, '04')
    const targetHash = recordHash(target)
    const content: AttestationContent = { attests: 'reliable', target: targetHash }
    const result = await resolveAttestationCorroboration({
      targetRecordHash: targetHash,
      targetCreatorKey: target.creator_key,
      attestations: [
        await attestation(A, content, { eventType: 'https://atrib.dev/v1/types/annotation' }),
        await attestation(B, content),
      ],
      trustedCreatorKeys: [await pub(A), await pub(B)],
    })
    expect(result.attestors_valid).toBe(1) // only the real attestation (B) counts
    expect(result.rejected.some((r) => r.reasons.includes('not_attestation'))).toBe(true)
  })

  it('rejects an attestation whose content does not match its args_hash commitment', async () => {
    const target = await observation(PRODUCER, '05')
    const targetHash = recordHash(target)
    const content: AttestationContent = { attests: 'reliable', target: targetHash }
    const result = await resolveAttestationCorroboration({
      targetRecordHash: targetHash,
      targetCreatorKey: target.creator_key,
      attestations: [await attestation(A, content, { corruptCommitment: true })],
      trustedCreatorKeys: [await pub(A)],
    })
    expect(result.attestors_valid).toBe(0)
    expect(result.rejected.some((r) => r.reasons.includes('uncommitted_content'))).toBe(true)
  })

  it('loud absence: no trust set → trust_evaluated false, no attestors_trusted, gate false', async () => {
    const target = await observation(PRODUCER, '06')
    const targetHash = recordHash(target)
    const content: AttestationContent = { attests: 'reliable', target: targetHash }
    const result = await resolveAttestationCorroboration({
      targetRecordHash: targetHash,
      targetCreatorKey: target.creator_key,
      attestations: [await attestation(A, content), await attestation(B, content)],
    })
    expect(result.attestors_valid).toBe(2)
    expect(result.trust_evaluated).toBe(false)
    expect(result).not.toHaveProperty('attestors_trusted')
    expect(isCorroborated(result)).toBe(false)
  })
})
