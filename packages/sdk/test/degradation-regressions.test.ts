// SPDX-License-Identifier: Apache-2.0

/**
 * §5.8 degradation regressions from the adversarial verification pass
 * (2026-07-06). Each case reproduced a real throw/looseness before the
 * fix; none may ever throw again.
 */

import { describe, it, expect } from 'vitest'
import {
  createAtribClient,
  DaemonClient,
  parseAttributionReceiptBlock,
  resolveAnchorSet,
  type AnchorSpec,
} from '../src/index.js'

describe('daemon endpoint degradation', () => {
  it('garbage endpoints degrade instead of throwing from attest/recall', async () => {
    for (const endpoint of ['not a url at all', 'http://[garbage', '']) {
      const client = createAtribClient({
        daemon: { endpoint, mode: 'prefer', connectTimeoutMs: 200 },
        key: null,
      })
      const attested = await client.attest({ content: {} })
      expect(attested.via).toBe('none')
      // Repeat call must degrade identically (connecting state resets).
      const again = await client.recall({ shape: 'history' })
      expect(again.via).not.toBe('daemon')
      await client.close()
    }
  })

  it('DaemonClient.callTool reports unreachable for an unparseable endpoint', async () => {
    const daemon = new DaemonClient({ endpoint: 'not a url', connectTimeoutMs: 200 })
    const outcome = await daemon.callTool('emit', {})
    expect(outcome.ok).toBe(false)
    await daemon.close()
  })
})

describe('anchor-set degradation', () => {
  it('null and non-object entries warn-and-skip instead of throwing', () => {
    const resolved = resolveAnchorSet([null, 42, undefined] as unknown as AnchorSpec[])
    expect(resolved.config.anchors).toEqual([])
    expect(resolved.primaryLogEndpoint).toBeUndefined()
    expect(resolved.warnings).toHaveLength(3)
  })

  it('non-string and unparseable url/endpoint values warn-and-skip', () => {
    const resolved = resolveAnchorSet([
      { endpoint: 5 } as unknown as AnchorSpec,
      'not a url',
      'https://log.example/v1/entries',
    ])
    expect(resolved.config.anchors).toEqual([{ url: 'https://log.example/v1/entries' }])
    expect(resolved.primaryLogEndpoint).toBe('https://log.example/v1/entries')
    expect(resolved.warnings.some((w) => w.includes('string url/endpoint'))).toBe(true)
    expect(resolved.warnings.some((w) => w.includes('not a valid URL'))).toBe(true)
  })

  it('a client constructed with hostile anchors does not throw, and attest degrades', async () => {
    const client = createAtribClient({
      daemon: { mode: 'off' },
      key: null,
      anchors: [null as unknown as AnchorSpec, 'not a url'],
    })
    const result = await client.attest({ content: {} })
    expect(result.via).toBe('none')
    // Pass-through mode signs nothing, so the anchor fan-out is never
    // consulted and no posture is surfaced.
    expect(result.anchor_posture).toBeUndefined()
    await client.close()
  })

  it('flushAnchors resolves even when no fan-out was ever built', async () => {
    const client = createAtribClient({ daemon: { mode: 'off' }, key: null })
    await expect(client.flushAnchors()).resolves.toBeUndefined()
    await client.close()
  })
})

describe('attribution receipt strictness', () => {
  it('a receipt whose every field is wrong-typed is treated as absent', () => {
    const block = parseAttributionReceiptBlock({
      'dev.atrib/attribution': {
        receipt: {
          record_hash: 123,
          creator_key: [],
          context_id: {},
          event_type: true,
          chain_root: null,
          log_submission: 9,
        },
      },
    })
    expect(block).toBeNull()
  })

  it('array-valued receipt and record fields are dropped', () => {
    const block = parseAttributionReceiptBlock({
      'dev.atrib/attribution': { token: 'a.b', receipt: [], record: [] },
    })
    expect(block).toEqual({ token: 'a.b' })
  })
})
