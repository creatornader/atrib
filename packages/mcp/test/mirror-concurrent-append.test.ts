// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { appendFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const hooks = vi.hoisted(() => ({
  onOpen: undefined as (() => void) | undefined,
  readStreams: 0,
}))

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  return {
    ...actual,
    open: (async (...args: Parameters<typeof actual.open>) => {
      hooks.onOpen?.()
      return actual.open(...args)
    }) as typeof actual.open,
  }
})

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  return {
    ...actual,
    createReadStream: ((...args: Parameters<typeof actual.createReadStream>) => {
      hooks.readStreams += 1
      return actual.createReadStream(...args)
    }) as typeof actual.createReadStream,
  }
})

const {
  base64urlEncode,
  canonicalRecord,
  genesisChainRoot,
  getPublicKey,
  hexEncode,
  inheritChainContext,
  sha256,
  signRecord,
} = await import('../src/index.js')
type AtribRecord = import('../src/index.js').AtribRecord

const TEST_KEY = new Uint8Array(32).fill(23)
const CTX_A = 'a'.repeat(32)
const CTX_B = 'b'.repeat(32)

async function makeRecord(contextId: string, timestamp: number): Promise<AtribRecord> {
  const pubKey = await getPublicKey(TEST_KEY)
  const unsigned = {
    spec_version: 'atrib/1.0' as const,
    content_id: `sha256:${timestamp.toString(16).padStart(64, '0')}`,
    creator_key: base64urlEncode(pubKey),
    chain_root: genesisChainRoot(contextId),
    event_type: 'https://atrib.dev/v1/types/tool_call' as const,
    context_id: contextId,
    timestamp,
    signature: '',
  }
  return signRecord(unsigned as AtribRecord, TEST_KEY)
}

function ref(record: AtribRecord): string {
  return `sha256:${hexEncode(sha256(canonicalRecord(record)))}`
}

let tmpDir: string
let mirrorPath: string
let siblingPath: string

const resolve = (contextId: string) =>
  inheritChainContext({
    callerContextId: contextId,
    mirrorPath,
    env: {},
    randomContextId: () => 'f'.repeat(32),
  })

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'atrib-mirror-concurrent-'))
  mirrorPath = join(tmpDir, 'a.jsonl')
  siblingPath = join(tmpDir, 'b.jsonl')
  await writeFile(mirrorPath, JSON.stringify(await makeRecord(CTX_A, 1)) + '\n')
  await writeFile(siblingPath, JSON.stringify(await makeRecord(CTX_B, 1)) + '\n')
  // Prime the advisory tail index with a full scan.
  await resolve(CTX_A)
  hooks.readStreams = 0
})

afterEach(async () => {
  hooks.onOpen = undefined
  await rm(tmpDir, { recursive: true, force: true })
})

describe('mirror tail index under concurrent appends', () => {
  it('folds in a sibling append made during the incremental read without a full scan', async () => {
    const appendedA = await makeRecord(CTX_A, 2)
    const concurrentB = await makeRecord(CTX_B, 3)
    appendFileSync(mirrorPath, JSON.stringify(appendedA) + '\n')
    let fired = false
    hooks.onOpen = () => {
      if (fired) return
      fired = true
      appendFileSync(siblingPath, JSON.stringify(concurrentB) + '\n')
    }

    expect((await resolve(CTX_A)).chainRoot).toBe(ref(appendedA))
    expect(hooks.readStreams).toBe(0)

    hooks.onOpen = undefined
    expect((await resolve(CTX_B)).chainRoot).toBe(ref(concurrentB))
    expect(hooks.readStreams).toBe(0)
  })

  it('returns a consistent tail when appends never stop, then catches up', async () => {
    const appendedA = await makeRecord(CTX_A, 2)
    appendFileSync(mirrorPath, JSON.stringify(appendedA) + '\n')
    const pending: AtribRecord[] = []
    for (let i = 0; i < 10; i += 1) pending.push(await makeRecord(CTX_B, 10 + i))
    let written = 0
    hooks.onOpen = () => {
      const next = pending[written]
      if (!next) return
      written += 1
      appendFileSync(siblingPath, JSON.stringify(next) + '\n')
    }

    expect((await resolve(CTX_A)).chainRoot).toBe(ref(appendedA))
    expect(hooks.readStreams).toBe(0)

    hooks.onOpen = undefined
    const latestB = pending[written - 1]!
    expect((await resolve(CTX_B)).chainRoot).toBe(ref(latestB))
    expect(hooks.readStreams).toBe(0)
  })

  it('picks up a same-context append and a new sibling file made during the read', async () => {
    const appendedA = await makeRecord(CTX_A, 2)
    const racingA = await makeRecord(CTX_A, 5)
    const newFileB = await makeRecord(CTX_B, 6)
    appendFileSync(mirrorPath, JSON.stringify(appendedA) + '\n')
    let fired = false
    hooks.onOpen = () => {
      if (fired) return
      fired = true
      appendFileSync(mirrorPath, JSON.stringify(racingA) + '\n')
      writeFileSync(join(tmpDir, 'c.jsonl'), JSON.stringify(newFileB) + '\n')
    }

    expect((await resolve(CTX_A)).chainRoot).toBe(ref(racingA))
    hooks.onOpen = undefined
    expect((await resolve(CTX_B)).chainRoot).toBe(ref(newFileB))
    expect(hooks.readStreams).toBe(0)
  })

  it('still falls back to a full scan when a sibling is truncated during the read', async () => {
    const appendedA = await makeRecord(CTX_A, 2)
    const replacementB = await makeRecord(CTX_B, 4)
    appendFileSync(mirrorPath, JSON.stringify(appendedA) + '\n')
    let fired = false
    hooks.onOpen = () => {
      if (fired) return
      fired = true
      // Same inode, smaller size: not an append.
      writeFileSync(siblingPath, '')
    }

    expect((await resolve(CTX_A)).chainRoot).toBe(ref(appendedA))
    expect(hooks.readStreams).toBeGreaterThan(0)
    hooks.onOpen = undefined
    await writeFile(siblingPath, JSON.stringify(replacementB) + '\n')
    expect((await resolve(CTX_B)).chainRoot).toBe(ref(replacementB))
  })
})
