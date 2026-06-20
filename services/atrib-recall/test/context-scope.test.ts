// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  base64urlEncode,
  genesisChainRoot,
  getPublicKey,
  signRecord,
  EVENT_TYPE_TOOL_CALL_URI,
} from '@atrib/mcp'
import type { AtribRecord } from '@atrib/mcp'

const KEY = new Uint8Array(32).fill(7)
const CTX_A = 'a'.repeat(32)
const CTX_B = 'b'.repeat(32)

async function makeSigned(contextId: string, timestamp: number): Promise<AtribRecord> {
  const pub = await getPublicKey(KEY)
  return signRecord(
    {
      spec_version: 'atrib/1.0',
      event_type: EVENT_TYPE_TOOL_CALL_URI,
      context_id: contextId,
      creator_key: base64urlEncode(pub),
      chain_root: genesisChainRoot(contextId),
      content_id: `sha256:${String(timestamp).repeat(64).slice(0, 64)}`,
      timestamp,
      signature: '',
    } as AtribRecord,
    KEY,
  )
}

async function importRecall(): Promise<typeof import('../src/index.js')> {
  vi.resetModules()
  return import('../src/index.js')
}

afterEach(() => {
  delete process.env.ATRIB_CONTEXT_ID
  delete process.env.CLAUDE_CODE_SESSION_ID
  vi.resetModules()
})

describe('recall context_scope', () => {
  it('defaults omitted context_id to cross-context recall even when env has a context', async () => {
    process.env.ATRIB_CONTEXT_ID = CTX_A
    const { recall, clearRecallMirrorCache } = await importRecall()
    const tmp = mkdtempSync(join(tmpdir(), 'atrib-context-scope-'))
    const file = join(tmp, 'records.jsonl')
    try {
      writeFileSync(
        file,
        [await makeSigned(CTX_A, 1), await makeSigned(CTX_B, 2)]
          .map((r) => JSON.stringify(r))
          .join('\n'),
      )

      const crossContext = await recall({}, file)
      expect(crossContext.total).toBe(2)
      expect(crossContext.records.map((r) => r.context_id)).toEqual([CTX_B, CTX_A])

      const envScoped = await recall({ context_scope: 'env' }, file)
      expect(envScoped.total).toBe(1)
      expect(envScoped.records[0]!.context_id).toBe(CTX_A)

      const explicitWins = await recall({ context_id: CTX_B, context_scope: 'env' }, file)
      expect(explicitWins.total).toBe(1)
      expect(explicitWins.records[0]!.context_id).toBe(CTX_B)
    } finally {
      clearRecallMirrorCache()
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})
