import { describe, it, expect } from 'vitest'
import { genesisChainRoot, chainRoot, resolveChainRoot } from '../src/chain-root.js'
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
      event_type: 'https://atrib.dev/v1/types/tool_call',
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
      event_type: 'https://atrib.dev/v1/types/tool_call',
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
      event_type: 'https://atrib.dev/v1/types/tool_call',
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

describe('resolveChainRoot priority cascade', () => {
  const ctx = '4bf92f3577b34da6a3ce929d0e0e4736'
  const tailA = '1111111111111111111111111111111111111111111111111111111111111111'
  const tailB = '2222222222222222222222222222222222222222222222222222222222222222'
  const tailC = '3333333333333333333333333333333333333333333333333333333333333333'

  it('returns inbound when present (highest priority)', () => {
    const result = resolveChainRoot({
      contextId: ctx,
      inboundRecordHashHex: tailA,
      autoChainTailHex: tailB,
      env: { [`ATRIB_CHAIN_TAIL_${ctx}`]: `sha256:${tailC}` },
    })
    expect(result).toBe(`sha256:${tailA}`)
  })

  it('returns autoChain tail when no inbound', () => {
    const result = resolveChainRoot({
      contextId: ctx,
      autoChainTailHex: tailB,
      env: { [`ATRIB_CHAIN_TAIL_${ctx}`]: `sha256:${tailC}` },
    })
    expect(result).toBe(`sha256:${tailB}`)
  })

  it('returns env-var tail when no inbound and no autoChain (cross-producer handoff)', () => {
    const result = resolveChainRoot({
      contextId: ctx,
      env: { [`ATRIB_CHAIN_TAIL_${ctx}`]: `sha256:${tailC}` },
    })
    expect(result).toBe(`sha256:${tailC}`)
  })

  it('falls through to genesis when env var is malformed', () => {
    const result = resolveChainRoot({
      contextId: ctx,
      env: { [`ATRIB_CHAIN_TAIL_${ctx}`]: 'not-a-valid-hash' },
    })
    expect(result).toBe(genesisChainRoot(ctx))
  })

  it('falls through to genesis when env var is missing', () => {
    const result = resolveChainRoot({
      contextId: ctx,
      env: {},
    })
    expect(result).toBe(genesisChainRoot(ctx))
  })

  it('namespaces env var by context_id (different ctx env not consulted)', () => {
    const otherCtx = '00000000000000000000000000000000'
    const result = resolveChainRoot({
      contextId: ctx,
      env: { [`ATRIB_CHAIN_TAIL_${otherCtx}`]: `sha256:${tailC}` },
    })
    expect(result).toBe(genesisChainRoot(ctx))
  })

  it('rejects env var with sha256: prefix but wrong hex length', () => {
    const result = resolveChainRoot({
      contextId: ctx,
      env: { [`ATRIB_CHAIN_TAIL_${ctx}`]: 'sha256:abc123' },
    })
    expect(result).toBe(genesisChainRoot(ctx))
  })

  it('rejects env var with hex but no sha256: prefix', () => {
    const result = resolveChainRoot({
      contextId: ctx,
      env: { [`ATRIB_CHAIN_TAIL_${ctx}`]: tailC },
    })
    expect(result).toBe(genesisChainRoot(ctx))
  })

  it('autoChain tail takes precedence over env var (within-process beats cross-process)', () => {
    const result = resolveChainRoot({
      contextId: ctx,
      autoChainTailHex: tailB,
      env: { [`ATRIB_CHAIN_TAIL_${ctx}`]: `sha256:${tailC}` },
    })
    expect(result).toBe(`sha256:${tailB}`)
  })

  it('returns mirror tail when no inbound, no autoChain, no env-var (file-as-IPC fallback)', () => {
    const result = resolveChainRoot({
      contextId: ctx,
      mirrorTailHex: tailA,
      env: {},
    })
    expect(result).toBe(`sha256:${tailA}`)
  })

  it('env-var tail takes precedence over mirror tail (env is fresher signal)', () => {
    const result = resolveChainRoot({
      contextId: ctx,
      mirrorTailHex: tailA,
      env: { [`ATRIB_CHAIN_TAIL_${ctx}`]: `sha256:${tailC}` },
    })
    expect(result).toBe(`sha256:${tailC}`)
  })

  it('falls through to genesis when mirror tail is malformed', () => {
    const result = resolveChainRoot({
      contextId: ctx,
      mirrorTailHex: 'not-a-valid-hash',
      env: {},
    })
    expect(result).toBe(genesisChainRoot(ctx))
  })

  it('mirror tail with sha256: prefix is rejected (caller passes raw hex, not prefixed form)', () => {
    const result = resolveChainRoot({
      contextId: ctx,
      mirrorTailHex: `sha256:${tailA}`,
      env: {},
    })
    expect(result).toBe(genesisChainRoot(ctx))
  })

  it('full precedence cascade: inbound > autoChain > env > mirror > genesis', () => {
    // All four signals present; inbound wins.
    const inbound = resolveChainRoot({
      contextId: ctx,
      inboundRecordHashHex: tailA,
      autoChainTailHex: tailB,
      mirrorTailHex: '4'.repeat(64),
      env: { [`ATRIB_CHAIN_TAIL_${ctx}`]: `sha256:${tailC}` },
    })
    expect(inbound).toBe(`sha256:${tailA}`)

    // No inbound; autoChain wins.
    const auto = resolveChainRoot({
      contextId: ctx,
      autoChainTailHex: tailB,
      mirrorTailHex: '4'.repeat(64),
      env: { [`ATRIB_CHAIN_TAIL_${ctx}`]: `sha256:${tailC}` },
    })
    expect(auto).toBe(`sha256:${tailB}`)

    // No inbound, no autoChain; env wins.
    const envTail = resolveChainRoot({
      contextId: ctx,
      mirrorTailHex: '4'.repeat(64),
      env: { [`ATRIB_CHAIN_TAIL_${ctx}`]: `sha256:${tailC}` },
    })
    expect(envTail).toBe(`sha256:${tailC}`)

    // No inbound, no autoChain, no env; mirror wins.
    const mirror = resolveChainRoot({
      contextId: ctx,
      mirrorTailHex: '4'.repeat(64),
      env: {},
    })
    expect(mirror).toBe(`sha256:${'4'.repeat(64)}`)

    // Nothing: genesis.
    const genesis = resolveChainRoot({ contextId: ctx, env: {} })
    expect(genesis).toBe(genesisChainRoot(ctx))
  })
})
