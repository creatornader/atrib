// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  base64urlEncode,
  genesisChainRoot,
  getPublicKey,
  signRecord,
  signTransactionRecord,
  signTransactionAttestation,
  type AtribRecord,
  type SignerEntry,
} from '@atrib/mcp'
import { requireTrustedTransaction } from '../src/index.js'

const TX = 'https://atrib.dev/v1/types/transaction'
const CONTEXT = 'a'.repeat(32)
const NOW = 1_782_000_000_000
const seed = (b: number): Uint8Array => new Uint8Array(32).fill(b)
const A = seed(0x11)
const B = seed(0x22)
const X = seed(0xaa)
const Y = seed(0xbb)
const pub = async (s: Uint8Array): Promise<string> => base64urlEncode(await getPublicKey(s))

async function txRecord(topSeed: Uint8Array, extraSeeds: Uint8Array[] = []): Promise<AtribRecord> {
  const base = await signTransactionRecord(
    {
      spec_version: 'atrib/1.0',
      content_id: 'sha256:' + 'c'.repeat(64),
      creator_key: '',
      chain_root: genesisChainRoot(CONTEXT),
      event_type: TX,
      context_id: CONTEXT,
      timestamp: NOW,
      signature: '',
      signers: [],
    } as AtribRecord,
    topSeed,
  )
  const extras: SignerEntry[] = []
  for (const s of extraSeeds) extras.push(await signTransactionAttestation(base, s))
  return { ...base, signers: [...(base.signers ?? []), ...extras] } as AtribRecord
}

describe('requireTrustedTransaction (D133 + D135 fail-closed policy)', () => {
  it('allows a transaction co-signed by two trusted keys', async () => {
    const record = await txRecord(A, [B])
    const decision = await requireTrustedTransaction({
      record,
      trustedCreatorKeys: [await pub(A), await pub(B)],
    })
    expect(decision.outcome).toBe('allow')
    expect(decision.evidence?.signers_trusted).toBe('2')
    expect(decision.evidence?.sybil_suspected).toBe('false')
  })

  it('blocks a Sybil transaction: two verified but untrusted signers', async () => {
    const record = await txRecord(X, [Y])
    const decision = await requireTrustedTransaction({
      record,
      trustedCreatorKeys: [await pub(A), await pub(B)], // trusts neither X nor Y
    })
    expect(decision.outcome).toBe('block')
    expect(decision.evidence?.signers_valid).toBe('2') // the footgun: count looks fine
    expect(decision.evidence?.signers_trusted).toBe('0')
    expect(decision.reason).toMatch(/not trusted-cross-attested/)
  })

  it('fails closed when no trust set is supplied', async () => {
    const record = await txRecord(A, [B])
    const decision = await requireTrustedTransaction({ record, trustedCreatorKeys: [] })
    expect(decision.outcome).toBe('block')
    expect(decision.reason).toMatch(/no trust set/)
  })

  it('fails closed on a non-transaction record', async () => {
    const obs = await signRecord(
      {
        spec_version: 'atrib/1.0',
        content_id: 'sha256:' + 'd'.repeat(64),
        creator_key: '',
        chain_root: genesisChainRoot(CONTEXT),
        event_type: 'https://atrib.dev/v1/types/observation',
        context_id: CONTEXT,
        timestamp: NOW,
        signature: '',
      } as AtribRecord,
      A,
    )
    const decision = await requireTrustedTransaction({
      record: obs,
      trustedCreatorKeys: [await pub(A)],
    })
    expect(decision.outcome).toBe('block')
    expect(decision.reason).toMatch(/not a transaction/)
  })

  it('blocks a single-signer transaction (below the 2-signer minimum)', async () => {
    const record = await txRecord(A)
    const decision = await requireTrustedTransaction({
      record,
      trustedCreatorKeys: [await pub(A)],
    })
    expect(decision.outcome).toBe('block')
    expect(decision.evidence?.signers_trusted).toBe('1')
  })

  it('escalates instead of blocking when onUntrusted is escalate', async () => {
    const record = await txRecord(X, [Y])
    const decision = await requireTrustedTransaction({
      record,
      trustedCreatorKeys: [await pub(A), await pub(B)],
      onUntrusted: 'escalate',
    })
    expect(decision.outcome).toBe('escalate')
  })
})
