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
  EVENT_TYPE_ATTESTATION_EXT_URI,
  type AttestationContent,
  type AttestationInput,
} from '@atrib/verify'
import { requireCorroborated } from '../src/index.js'

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

async function observation(topSeed: Uint8Array): Promise<AtribRecord> {
  return signRecord(
    {
      spec_version: 'atrib/1.0',
      content_id: 'sha256:' + '01'.repeat(32),
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

async function attestation(signerSeed: Uint8Array, content: AttestationContent): Promise<AttestationInput> {
  const argsHash = 'sha256:' + hexEncode(sha256(new TextEncoder().encode(canonicalize(content) as string)))
  const record = await signRecord(
    {
      spec_version: 'atrib/1.0',
      content_id: 'sha256:' + 'e'.repeat(64),
      creator_key: base64urlEncode(await getPublicKey(signerSeed)),
      chain_root: genesisChainRoot(CONTEXT),
      event_type: EVENT_TYPE_ATTESTATION_EXT_URI,
      context_id: CONTEXT,
      timestamp: NOW,
      signature: '',
      args_hash: argsHash,
    } as AtribRecord,
    signerSeed,
  )
  return { record, content }
}

describe('requireCorroborated (D133 + D150 fail-closed policy)', () => {
  it('allows when the target is corroborated by two trusted attestors', async () => {
    const target = await observation(PRODUCER)
    const th = recordHash(target)
    const content: AttestationContent = { attests: 'reliable', target: th }
    const decision = await requireCorroborated({
      targetRecordHash: th,
      targetCreatorKey: target.creator_key,
      attestations: [await attestation(A, content), await attestation(B, content)],
      trustedCreatorKeys: [await pub(A), await pub(B)],
    })
    expect(decision.outcome).toBe('allow')
    expect(decision.evidence?.attestors_trusted).toBe('2')
  })

  it('blocks when attestors are verified but untrusted (Sybil)', async () => {
    const target = await observation(PRODUCER)
    const th = recordHash(target)
    const content: AttestationContent = { attests: 'reliable', target: th }
    const decision = await requireCorroborated({
      targetRecordHash: th,
      targetCreatorKey: target.creator_key,
      attestations: [await attestation(X, content), await attestation(Y, content)],
      trustedCreatorKeys: [await pub(A), await pub(B)],
    })
    expect(decision.outcome).toBe('block')
    expect(decision.evidence?.attestors_valid).toBe('2')
    expect(decision.evidence?.attestors_trusted).toBe('0')
  })

  it('fails closed when no trust set is supplied', async () => {
    const target = await observation(PRODUCER)
    const th = recordHash(target)
    const content: AttestationContent = { attests: 'reliable', target: th }
    const decision = await requireCorroborated({
      targetRecordHash: th,
      attestations: [await attestation(A, content), await attestation(B, content)],
      trustedCreatorKeys: [],
    })
    expect(decision.outcome).toBe('block')
    expect(decision.reason).toMatch(/no trust set/)
  })

  it('escalates instead of blocking when requested', async () => {
    const target = await observation(PRODUCER)
    const th = recordHash(target)
    const content: AttestationContent = { attests: 'reliable', target: th }
    const decision = await requireCorroborated({
      targetRecordHash: th,
      targetCreatorKey: target.creator_key,
      attestations: [await attestation(X, content)],
      trustedCreatorKeys: [await pub(A), await pub(B)],
      onUncorroborated: 'escalate',
    })
    expect(decision.outcome).toBe('escalate')
  })
})
