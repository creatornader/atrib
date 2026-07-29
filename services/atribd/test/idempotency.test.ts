// SPDX-License-Identifier: Apache-2.0

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { createAtribdBackend } from '../src/backend.js'
import {
  createWriteIdempotencyStore,
  IDEMPOTENCY_META_KEY,
  idempotencyKeyFromRequest,
  validateIdempotencyKey,
  writeActionBinding,
} from '../src/idempotency.js'

const CONTEXT_ID = 'a'.repeat(32)
const KEY = 'retry-key-00000001'
const CORPUS = resolve(dirname(fileURLToPath(import.meta.url)), '../../../spec/conformance/atribd')

interface IdempotencyFixture {
  name: string
  scenario: string
  expected: Record<string, unknown>
}

const manifest = JSON.parse(readFileSync(join(CORPUS, 'manifest.json'), 'utf8')) as {
  families: { name: string; cases: string[] }[]
}
const idempotencyFamily = manifest.families.find((family) => family.name === 'write-idempotency')
if (!idempotencyFamily) throw new Error('manifest is missing write-idempotency')
const fixtures = new Map(
  idempotencyFamily.cases.map((path) => {
    const fixture = JSON.parse(readFileSync(join(CORPUS, path), 'utf8')) as IdempotencyFixture
    return [fixture.scenario, fixture] as const
  }),
)

function corpusCase(scenario: string): IdempotencyFixture {
  const fixture = fixtures.get(scenario)
  if (!fixture) throw new Error(`write-idempotency corpus is missing ${scenario}`)
  return fixture
}

function result(recordHash: string) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ record_hash: recordHash }) }],
  }
}

function writeRequest(content: string, key = KEY) {
  return {
    name: 'emit',
    arguments: { context_id: CONTEXT_ID, content: { what: content } },
    _meta: { [IDEMPOTENCY_META_KEY]: key },
  }
}

describe('write idempotency store', () => {
  const replayCase = corpusCase('completed-retry-replays-original')
  it(replayCase.name, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'atribd-idempotency-'))
    const path = join(dir, 'state.json')
    try {
      const first = createWriteIdempotencyStore({ profile: 'test', stateFile: path })
      const binding = writeActionBinding(writeRequest('same action'))
      const begin = await first.begin(KEY, binding)
      expect(begin.kind).toBe('owner')
      if (begin.kind !== 'owner') throw new Error('expected owner')
      await first.complete(begin.keyHash, begin.binding, result(`sha256:${'1'.repeat(64)}`))
      await first.flush()

      const restarted = createWriteIdempotencyStore({ profile: 'test', stateFile: path })
      const replay = await restarted.begin(KEY, binding)
      expect(replay.kind).toBe(replayCase.expected['decision'])
      expect(replay).toEqual({
        kind: 'replay',
        result: result(`sha256:${'1'.repeat(64)}`),
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  const changedBindingCase = corpusCase('changed-binding-rejected')
  it(changedBindingCase.name, async () => {
    const store = createWriteIdempotencyStore({ stateFile: false })
    const firstBinding = writeActionBinding(writeRequest('first action'))
    const begin = await store.begin(KEY, firstBinding)
    expect(begin.kind).toBe('owner')
    if (begin.kind !== 'owner') throw new Error('expected owner')
    await store.complete(begin.keyHash, begin.binding, result(`sha256:${'2'.repeat(64)}`))

    const changed = await store.begin(KEY, writeActionBinding(writeRequest('changed action')))
    expect(changed.kind).toBe(changedBindingCase.expected['decision'])
    expect(await store.begin(KEY, firstBinding)).toEqual({
      kind: 'replay',
      result: result(`sha256:${'2'.repeat(64)}`),
    })
  })

  const pendingCase = corpusCase('restart-pending-indeterminate')
  it(pendingCase.name, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'atribd-idempotency-pending-'))
    const path = join(dir, 'state.json')
    try {
      const binding = writeActionBinding(writeRequest('uncertain action'))
      const first = createWriteIdempotencyStore({ profile: 'test', stateFile: path })
      expect((await first.begin(KEY, binding)).kind).toBe('owner')
      await first.flush()

      const restarted = createWriteIdempotencyStore({ profile: 'test', stateFile: path })
      const decision = await restarted.begin(KEY, binding)
      expect(decision.kind).toBe(pendingCase.expected['decision'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('validates and binds the request metadata without storing the raw key', () => {
    expect(idempotencyKeyFromRequest(writeRequest('action'))).toBe(KEY)
    expect(writeActionBinding(writeRequest('action'))).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(() => validateIdempotencyKey('short')).toThrow(/16-128/)
    expect(() => validateIdempotencyKey(`valid-key-000000\u0000`)).toThrow(/visible ASCII/)
  })

  it('expires a completed result when its replay window closes', async () => {
    let now = 1_000
    const store = createWriteIdempotencyStore({
      stateFile: false,
      windowMs: 100,
      now: () => now,
    })
    const binding = writeActionBinding(writeRequest('expiring action'))
    const begin = await store.begin(KEY, binding)
    expect(begin.kind).toBe('owner')
    if (begin.kind !== 'owner') throw new Error('expected owner')
    await store.complete(begin.keyHash, begin.binding, result(`sha256:${'7'.repeat(64)}`))

    now += 101
    expect((await store.begin(KEY, binding)).kind).toBe('owner')
  })
})

describe('backend duplicate-safe writes', () => {
  const concurrentCase = corpusCase('concurrent-duplicate-one-dispatch')
  it(concurrentCase.name, async () => {
    let dispatches = 0
    const backend = await createAtribdBackend({
      idempotencyStateFile: false,
      primitives: [
        [
          'emit',
          () => {
            const mcp = new McpServer({ name: 'fake-emit', version: '0.0.0' })
            mcp.registerTool(
              'emit',
              {
                description: 'Fake write',
                inputSchema: {
                  context_id: z.string(),
                  content: z.record(z.string(), z.unknown()),
                },
              },
              async () => {
                dispatches += 1
                await new Promise((resolve) => setTimeout(resolve, 20))
                return result(`sha256:${'3'.repeat(64)}`)
              },
            )
            return { mcp }
          },
        ],
      ],
    })
    try {
      const [left, right] = await Promise.all([
        backend.callTool(writeRequest('same action')),
        backend.callTool(writeRequest('same action')),
      ])
      expect(dispatches).toBe(concurrentCase.expected['dispatches'])
      expect(left).toEqual(right)
      expect(backend.diagnostics().idempotency.completed).toBe(1)
    } finally {
      await backend.close()
    }
  })

  const timeoutCase = corpusCase('timeout-locks-until-settlement')
  it(timeoutCase.name, async () => {
    let releaseFirst!: () => void
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const order: string[] = []
    const backend = await createAtribdBackend({
      toolTimeoutMs: 10,
      idempotencyStateFile: false,
      primitives: [
        [
          'emit',
          () => {
            const mcp = new McpServer({ name: 'fake-emit', version: '0.0.0' })
            mcp.registerTool(
              'emit',
              {
                description: 'Fake write',
                inputSchema: {
                  context_id: z.string(),
                  content: z.record(z.string(), z.unknown()),
                },
              },
              async (args) => {
                const label = String((args.content as { what?: unknown }).what)
                order.push(`start:${label}`)
                if (label === 'first') await firstGate
                order.push(`end:${label}`)
                return result(`sha256:${label === 'first' ? '4'.repeat(64) : '5'.repeat(64)}`)
              },
            )
            return { mcp }
          },
        ],
      ],
    })
    try {
      const first = backend.callTool(writeRequest('first', 'retry-key-00000002'))
      await expect(first).rejects.toThrow(/timed out/)
      const second = backend.callTool(writeRequest('second', 'retry-key-00000003'))
      await new Promise((resolve) => setTimeout(resolve, 15))
      expect(order).toEqual(['start:first'])
      releaseFirst()
      await second
      expect(order).toEqual(['start:first', 'end:first', 'start:second', 'end:second'])
    } finally {
      releaseFirst()
      await backend.close()
    }
  })

  const missingContextCase = corpusCase('missing-context-rejected')
  it(missingContextCase.name, async () => {
    const saved = new Map<string, string | undefined>()
    for (const key of [
      'ATRIB_CONTEXT_ID',
      'ATRIB_ACTIVE_SESSION_PROFILE',
      'ATRIB_AGENT',
      'CLAUDE_CODE_SESSION_ID',
      'CODEX_THREAD_ID',
    ]) {
      saved.set(key, process.env[key])
      delete process.env[key]
    }
    const backend = await createAtribdBackend({
      idempotencyStateFile: false,
      primitives: [
        [
          'emit',
          () => {
            const mcp = new McpServer({ name: 'fake-emit', version: '0.0.0' })
            mcp.registerTool(
              'emit',
              {
                description: 'Fake write',
                inputSchema: { content: z.record(z.string(), z.unknown()) },
              },
              async () => result(`sha256:${'6'.repeat(64)}`),
            )
            return { mcp }
          },
        ],
      ],
    })
    try {
      await expect(
        backend.callTool({
          name: 'emit',
          arguments: { content: { what: 'missing context' } },
          _meta: { [IDEMPOTENCY_META_KEY]: KEY },
        }),
      ).rejects.toMatchObject({ code: missingContextCase.expected['error_code'] })
    } finally {
      await backend.close()
      for (const [key, value] of saved) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }
  })
})
