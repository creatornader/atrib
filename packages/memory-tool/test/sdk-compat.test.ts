// SPDX-License-Identifier: Apache-2.0

import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import { betaMemoryTool } from '@anthropic-ai/sdk/helpers/beta/memory'
import { BetaLocalFilesystemMemoryTool } from '@anthropic-ai/sdk/tools/memory/node'
import type { BetaMemoryTool20250818Command } from '@anthropic-ai/sdk/resources/beta'
import { canonicalRecord, genesisChainRoot, hexEncode, sha256, verifyRecord } from '@atrib/mcp'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAtribMemoryTool, type AtribMemorySidecar } from '../src/index.js'

let root: string
let backend: BetaLocalFilesystemMemoryTool
let memory: Awaited<ReturnType<typeof createAtribMemoryTool>>
let tool: ReturnType<typeof betaMemoryTool>
let sidecars: AtribMemorySidecar[]

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'atrib-anthropic-compat-'))
  backend = await BetaLocalFilesystemMemoryTool.init(root)
  sidecars = []
  memory = await createAtribMemoryTool(backend, {
    privateKey: new Uint8Array(32).fill(44),
    contextId: '44'.repeat(16),
    logSubmission: 'disabled',
    onRecord: (_record, sidecar) => {
      sidecars.push(sidecar)
    },
  })
  tool = betaMemoryTool(memory)
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function verifyReceipts() {
  const records = memory.getSignedRecords()
  for (const [index, record] of records.entries()) {
    expect(await verifyRecord(record)).toBe(true)
    expect(record.chain_root).toBe(
      index === 0
        ? genesisChainRoot(memory.contextId)
        : `sha256:${hexEncode(sha256(canonicalRecord(records[index - 1]!)))}`,
    )
  }
}

describe('Anthropic native Memory Tool compatibility', () => {
  it('dispatches every command, reads back mutations, and keeps file contents private', async () => {
    const path = '/memories/private.txt'
    const secret = 'private memory SDK compatibility'
    await tool.run({ command: 'create', path, file_text: `${secret}\nstatus=pending` })
    await tool.run({ command: 'insert', path, insert_line: 1, insert_text: 'inserted' })
    await tool.run({
      command: 'str_replace',
      path,
      old_str: 'status=pending',
      new_str: 'status=verified',
    })
    await tool.run({ command: 'rename', old_path: path, new_path: '/memories/renamed.txt' })
    expect(await tool.run({ command: 'view', path: '/memories/renamed.txt' })).toContain(
      'status=verified',
    )
    expect(await readFile(join(root, 'memories/renamed.txt'), 'utf8')).toBe(
      `${secret}\ninserted\nstatus=verified`,
    )
    await tool.run({ command: 'delete', path: '/memories/renamed.txt' })
    expect(await readdir(join(root, 'memories'))).toEqual([])
    expect(memory.getSignedRecords().map((record) => record.tool_name)).toEqual([
      'anthropic.memory.create',
      'anthropic.memory.insert',
      'anthropic.memory.str_replace',
      'anthropic.memory.rename',
      'anthropic.memory.delete',
    ])
    expect(JSON.stringify(memory.getSignedRecords())).not.toContain(secret)
    expect(JSON.stringify(sidecars)).toContain(secret)
    await verifyReceipts()
  })

  it('preserves the actual filesystem error object and signs the failure', async () => {
    await tool.run({ command: 'create', path: '/memories/existing.txt', file_text: 'unchanged' })
    const native = vi.spyOn(backend, 'create')
    const result = Promise.resolve(
      tool.run({ command: 'create', path: '/memories/existing.txt', file_text: 'replacement' }),
    )
    const wrappedError = await result.catch((error: unknown) => error)
    const nativeError = await Promise.resolve(native.mock.results[0]!.value).catch(
      (error: unknown) => error,
    )
    expect(wrappedError).toBeInstanceOf(Error)
    expect(wrappedError).toBe(nativeError)
    expect(sidecars.at(-1)?.status).toBe('error')
    expect(await readFile(join(root, 'memories/existing.txt'), 'utf8')).toBe('unchanged')
    await verifyReceipts()
  })

  it.each([
    { command: 'delete', path: '/memories/missing.txt' },
    { command: 'str_replace', path: '/memories/existing.txt', old_str: 'absent', new_str: 'bad' },
    { command: 'insert', path: '/memories/existing.txt', insert_line: 99, insert_text: 'bad' },
    { command: 'create', path: '/memories/../../escape.txt', file_text: 'bad' },
  ] satisfies BetaMemoryTool20250818Command[])(
    'rejects invalid $command input without changing stored data',
    async (command) => {
      await tool.run({ command: 'create', path: '/memories/existing.txt', file_text: 'unchanged' })
      await expect(Promise.resolve(tool.run(command))).rejects.toBeInstanceOf(Error)
      expect(await readFile(join(root, 'memories/existing.txt'), 'utf8')).toBe('unchanged')
      expect(await readdir(join(root, 'memories'))).toEqual(['existing.txt'])
      expect(sidecars.at(-1)?.status).toBe('error')
      expect(memory.getSignedRecords()).toHaveLength(2)
      await verifyReceipts()
    },
  )

  it('rejects symlink escapes and preserves the outside file', async () => {
    const outside = join(root, 'outside')
    await writeFile(outside, 'unchanged')
    await symlink(outside, join(root, 'memories/link'))
    await expect(
      Promise.resolve(
        tool.run({
          command: 'str_replace',
          path: '/memories/link',
          old_str: 'unchanged',
          new_str: 'bad',
        }),
      ),
    ).rejects.toThrow('symlink')
    expect(await readFile(outside, 'utf8')).toBe('unchanged')
    expect(sidecars[0]?.status).toBe('error')
    await verifyReceipts()
  })

  it('signs native reads when requested and tolerates a failing record callback', async () => {
    memory = await createAtribMemoryTool(backend, {
      privateKey: new Uint8Array(32).fill(44),
      contextId: '44'.repeat(16),
      logSubmission: 'disabled',
      signReads: true,
      onRecord: () => {
        throw new Error('fixture callback unavailable')
      },
    })
    tool = betaMemoryTool(memory)
    await tool.run({ command: 'create', path: '/memories/read.txt', file_text: 'readback' })
    expect(await tool.run({ command: 'view', path: '/memories/read.txt' })).toContain('readback')
    expect(memory.getSignedRecords()).toHaveLength(2)
    await verifyReceipts()
  })

  it.each(['create', 'rejected-path', 'provider-error'])(
    'runs the native Messages tool runner: %s',
    async (mode) => {
      const requests: {
        messages: { content: unknown }[]
        tools: { name: string; type: string }[]
      }[] = []
      const server = createServer(async (req, res) => {
        let body = ''
        for await (const chunk of req) body += chunk.toString()
        requests.push(JSON.parse(body))
        res.setHeader('content-type', 'application/json')
        if (mode === 'provider-error') {
          res.writeHead(503).end(
            JSON.stringify({
              type: 'error',
              error: { type: 'overloaded_error', message: 'fixture provider unavailable' },
            }),
          )
          return
        }
        const first = requests.length === 1
        res.end(
          JSON.stringify({
            id: `fixture-${requests.length}`,
            type: 'message',
            role: 'assistant',
            model: 'fixture-model',
            content: first
              ? [
                  {
                    type: 'tool_use',
                    id: 'memory-call',
                    name: 'memory',
                    input: {
                      command: 'create',
                      path:
                        mode === 'rejected-path'
                          ? '/memories/../../escape.txt'
                          : '/memories/runner.txt',
                      file_text: 'runner private content',
                    },
                  },
                ]
              : [{ type: 'text', text: 'done' }],
            stop_reason: first ? 'tool_use' : 'end_turn',
            stop_sequence: null,
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
        )
      })
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('fixture did not bind')
      const client = new Anthropic({
        apiKey: 'fixture-key',
        baseURL: `http://127.0.0.1:${address.port}`,
        maxRetries: 0,
      })
      try {
        const runner = client.beta.messages.toolRunner({
          model: 'fixture-model',
          max_tokens: 128,
          messages: [{ role: 'user', content: 'Use the memory tool' }],
          tools: [tool],
        })
        if (mode === 'provider-error') {
          await expect(runner.runUntilDone()).rejects.toMatchObject({ status: 503 })
          expect(memory.getSignedRecords()).toHaveLength(0)
          expect(await readdir(join(root, 'memories'))).toEqual([])
        } else {
          expect((await runner.runUntilDone()).stop_reason).toBe('end_turn')
          expect(requests).toHaveLength(2)
          expect(requests[0]!.tools).toEqual([{ name: 'memory', type: 'memory_20250818' }])
          const results = requests[1]!.messages.at(-1)!.content as {
            type: string
            tool_use_id: string
            is_error?: boolean
          }[]
          expect(results[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'memory-call' })
          expect(results[0]!.is_error ?? false).toBe(mode === 'rejected-path')
          expect(sidecars[0]?.status).toBe(mode === 'rejected-path' ? 'error' : 'ok')
          expect(await readdir(join(root, 'memories'))).toEqual(
            mode === 'rejected-path' ? [] : ['runner.txt'],
          )
          await verifyReceipts()
        }
      } finally {
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        )
      }
    },
  )
})
