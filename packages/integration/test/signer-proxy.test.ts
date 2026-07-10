// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  EVENT_TYPE_TOOL_CALL_URI,
  base64urlEncode,
  genesisChainRoot,
  verifyRecord,
} from '@atrib/mcp'
import {
  createHostSignerProxy,
  createSandboxSignerClient,
} from '../src/signer-proxy-example.js'

const HOST_PRIVATE_KEY = new Uint8Array(32).fill(14)
const CONTEXT_ID = '11111111111111111111111111111111'

describe('sandbox signer proxy example', () => {
  it('signs records outside the sandbox and returns a record hash', async () => {
    const signer = createHostSignerProxy({ privateKey: HOST_PRIVATE_KEY })
    expect(await signer.capabilities()).toEqual({ creator_key: await signer.creatorKey() })
    const sandbox = createSandboxSignerClient({
      contextId: CONTEXT_ID,
      serverUrl: 'https://sandbox.example/mcp',
      signer,
    })

    expect(Object.keys(sandbox)).not.toContain('privateKey')

    const response = await sandbox.signToolCall({
      args: { path: 'README.md' },
      result: { ok: true },
      toolName: 'read_file',
    })

    expect(response.ok).toBe(true)
    if (!response.ok) throw new Error(response.error)

    expect(response.record_hash).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(response.record.creator_key).toBe(await signer.creatorKey())
    expect(response.record.chain_root).toBe(genesisChainRoot(CONTEXT_ID))
    expect(await verifyRecord(response.record)).toBe(true)
  })

  it('rejects sandbox attempts to set signer-controlled fields', async () => {
    const signer = createHostSignerProxy({ privateKey: HOST_PRIVATE_KEY })

    const response = await signer.sign({
      reason: 'malformed sandbox request',
      unsignedRecord: {
        chain_root: genesisChainRoot(CONTEXT_ID),
        content_id: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        context_id: CONTEXT_ID,
        creator_key: base64urlEncode(new Uint8Array(32).fill(7)),
        event_type: EVENT_TYPE_TOOL_CALL_URI,
        signature: 'forged',
        spec_version: 'atrib/1.0',
        timestamp: 1779840000000,
      } as never,
    })

    expect(response.ok).toBe(false)
    if (response.ok) throw new Error('expected signer proxy rejection')
    expect(response.error).toContain('signer-controlled')
  })

  it('runs host policy before signing', async () => {
    const signer = createHostSignerProxy({
      privateKey: HOST_PRIVATE_KEY,
      policy: () => ({ ok: false, error: 'tool denied by host policy' }),
    })
    const sandbox = createSandboxSignerClient({
      contextId: CONTEXT_ID,
      serverUrl: 'https://sandbox.example/mcp',
      signer,
    })

    const response = await sandbox.signToolCall({
      args: { command: 'rm -rf /' },
      result: { blocked: true },
      toolName: 'shell',
    })

    expect(response.ok).toBe(false)
    if (response.ok) throw new Error('expected host policy rejection')
    expect(response.error).toBe('tool denied by host policy')
  })

  it('does not fail signing when optional submission fails', async () => {
    const signer = createHostSignerProxy({
      privateKey: HOST_PRIVATE_KEY,
      submitRecord: async () => {
        throw new Error('log unavailable')
      },
    })
    const sandbox = createSandboxSignerClient({
      contextId: CONTEXT_ID,
      serverUrl: 'https://sandbox.example/mcp',
      signer,
    })

    const response = await sandbox.signToolCall({
      args: { path: 'README.md' },
      result: { ok: true },
      toolName: 'read_file',
    })

    expect(response.ok).toBe(true)
    if (!response.ok) throw new Error(response.error)
    expect(await verifyRecord(response.record)).toBe(true)
  })
})
