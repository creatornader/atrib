import { describe, it, expect } from 'vitest'
import { genesisChainRoot, chainRoot } from '../src/chain-root.js'
import { signRecord, getPublicKey } from '../src/signing.js'
import { base64urlEncode } from '../src/base64url.js'
import type { AtribRecord } from '../src/types.js'

describe('genesisChainRoot', () => {
  it('returns sha256-prefixed hex string', () => {
    const root = genesisChainRoot('4bf92f3577b34da6a3ce929d0e0e4736')
    expect(root).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  it('is deterministic', () => {
    const a = genesisChainRoot('4bf92f3577b34da6a3ce929d0e0e4736')
    const b = genesisChainRoot('4bf92f3577b34da6a3ce929d0e0e4736')
    expect(a).toBe(b)
  })

  it('different context_ids produce different roots', () => {
    const a = genesisChainRoot('4bf92f3577b34da6a3ce929d0e0e4736')
    const b = genesisChainRoot('00000000000000000000000000000000')
    expect(a).not.toBe(b)
  })

  it('produces known value for pinned input (regression guard)', () => {
    // §1.2.3: chain_root = "sha256:" + hex(SHA-256(UTF-8(context_id)))
    // Pinned so any formula change is immediately caught.
    expect(genesisChainRoot('4bf92f3577b34da6a3ce929d0e0e4736')).toBe(
      'sha256:398acaee65c4e533cea249865ab1cee576445dc23178f8b39d5efdcedd57a829',
    )
  })
})

describe('chainRoot', () => {
  const privateKey = new Uint8Array(32).fill(1)

  it('returns sha256-prefixed hex string', async () => {
    const publicKey = await getPublicKey(privateKey)
    const parent: AtribRecord = {
      spec_version: 'atrib/1.0',
      content_id: 'sha256:3f8a2b0000000000000000000000000000000000000000000000000000000000',
      creator_key: base64urlEncode(publicKey),
      chain_root: genesisChainRoot('4bf92f3577b34da6a3ce929d0e0e4736'),
      event_type: 'tool_call',
      context_id: '4bf92f3577b34da6a3ce929d0e0e4736',
      timestamp: 1743850000000,
      signature: '',
    } as AtribRecord
    const signed = await signRecord(parent, privateKey)
    const root = chainRoot(signed)
    expect(root).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  it('is deterministic for same parent', async () => {
    const publicKey = await getPublicKey(privateKey)
    const parent: AtribRecord = {
      spec_version: 'atrib/1.0',
      content_id: 'sha256:3f8a2b0000000000000000000000000000000000000000000000000000000000',
      creator_key: base64urlEncode(publicKey),
      chain_root: genesisChainRoot('4bf92f3577b34da6a3ce929d0e0e4736'),
      event_type: 'tool_call',
      context_id: '4bf92f3577b34da6a3ce929d0e0e4736',
      timestamp: 1743850000000,
      signature: '',
    } as AtribRecord
    const signed = await signRecord(parent, privateKey)
    const a = chainRoot(signed)
    const b = chainRoot(signed)
    expect(a).toBe(b)
  })

  it('differs from genesis root', async () => {
    const contextId = '4bf92f3577b34da6a3ce929d0e0e4736'
    const publicKey = await getPublicKey(privateKey)
    const parent: AtribRecord = {
      spec_version: 'atrib/1.0',
      content_id: 'sha256:3f8a2b0000000000000000000000000000000000000000000000000000000000',
      creator_key: base64urlEncode(publicKey),
      chain_root: genesisChainRoot(contextId),
      event_type: 'tool_call',
      context_id: contextId,
      timestamp: 1743850000000,
      signature: '',
    } as AtribRecord
    const signed = await signRecord(parent, privateKey)
    const genesis = genesisChainRoot(contextId)
    const chain = chainRoot(signed)
    expect(chain).not.toBe(genesis)
  })
})
