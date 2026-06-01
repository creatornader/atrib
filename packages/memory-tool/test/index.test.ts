import { describe, expect, it } from 'vitest'
import type { MemoryToolHandlers } from '@anthropic-ai/sdk/helpers/beta/memory'
import { createAtribMemoryTool, resolvePrivateKey, type AtribMemorySidecar } from '../src/index.js'
import {
  base64urlEncode,
  canonicalRecord,
  genesisChainRoot,
  hexEncode,
  sha256,
  verifyRecord,
} from '@atrib/mcp'
import type { AtribRecord } from '@atrib/mcp'

const privateKey = new Uint8Array(32).fill(7)

function handlers(): MemoryToolHandlers {
  return {
    view: async ({ path }) => `viewed ${path}`,
    create: async ({ path }) => `created ${path}`,
    str_replace: async ({ path }) => `edited ${path}`,
    insert: async ({ path }) => `inserted ${path}`,
    delete: async ({ path }) => `deleted ${path}`,
    rename: async ({ old_path, new_path }) => `renamed ${old_path} to ${new_path}`,
  }
}

class ClassBackedHandlers implements MemoryToolHandlers {
  prefix = 'class-backed'

  async view({ path }: Parameters<MemoryToolHandlers['view']>[0]) {
    return `${this.prefix} viewed ${path}`
  }

  async create({ path }: Parameters<MemoryToolHandlers['create']>[0]) {
    return `${this.prefix} created ${path}`
  }

  async str_replace({ path }: Parameters<MemoryToolHandlers['str_replace']>[0]) {
    return `${this.prefix} edited ${path}`
  }

  async insert({ path }: Parameters<MemoryToolHandlers['insert']>[0]) {
    return `${this.prefix} inserted ${path}`
  }

  async delete({ path }: Parameters<MemoryToolHandlers['delete']>[0]) {
    return `${this.prefix} deleted ${path}`
  }

  async rename({ old_path, new_path }: Parameters<MemoryToolHandlers['rename']>[0]) {
    return `${this.prefix} renamed ${old_path} to ${new_path}`
  }
}

describe('@atrib/memory-tool', () => {
  it('passes through handler results while signing mutating commands', async () => {
    const records: AtribRecord[] = []
    const memory = await createAtribMemoryTool(handlers(), {
      privateKey,
      contextId: '4bf92f3577b34da6a3ce929d0e0e4736',
      logSubmission: 'disabled',
      now: () => Date.now(),
      onRecord: (record) => records.push(record),
    })

    const result = await memory.create({
      command: 'create',
      path: '/memories/preferences.txt',
      file_text: 'timezone=America/Chicago',
    })

    expect(result).toBe('created /memories/preferences.txt')
    expect(records).toHaveLength(1)
    expect(records[0]!.tool_name).toBe('anthropic.memory.create')
    expect(records[0]!.args_hash).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(records[0]!.result_hash).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(JSON.stringify(records[0])).not.toContain('America/Chicago')
    expect(await verifyRecord(records[0]!)).toBe(true)
  })

  it('does not sign view by default', async () => {
    const memory = await createAtribMemoryTool(handlers(), {
      privateKey,
      logSubmission: 'disabled',
    })

    await memory.view({ command: 'view', path: '/memories' })

    expect(memory.getSignedRecords()).toHaveLength(0)
  })

  it('passes through without signing when no private key is configured', async () => {
    const previous = process.env.ATRIB_PRIVATE_KEY
    delete process.env.ATRIB_PRIVATE_KEY

    try {
      const memory = await createAtribMemoryTool(handlers(), {
        logSubmission: 'disabled',
      })
      const result = await memory.create({
        command: 'create',
        path: '/memories/no-key.txt',
        file_text: 'body',
      })

      expect(result).toBe('created /memories/no-key.txt')
      expect(memory.creatorKey).toBe('')
      expect(memory.getSignedRecords()).toHaveLength(0)
    } finally {
      if (previous === undefined) delete process.env.ATRIB_PRIVATE_KEY
      else process.env.ATRIB_PRIVATE_KEY = previous
    }
  })

  it('passes through without signing when the configured key is invalid', async () => {
    const memory = await createAtribMemoryTool(handlers(), {
      privateKey: 'not-a-valid-seed',
      logSubmission: 'disabled',
    })

    const result = await memory.delete({
      command: 'delete',
      path: '/memories/invalid-key.txt',
    })

    expect(result).toBe('deleted /memories/invalid-key.txt')
    expect(memory.getSignedRecords()).toHaveLength(0)
  })

  it('preserves this binding for class-backed handlers', async () => {
    const memory = await createAtribMemoryTool(new ClassBackedHandlers(), {
      privateKey,
      logSubmission: 'disabled',
    })

    await expect(
      memory.create({
        command: 'create',
        path: '/memories/class.txt',
        file_text: 'body',
      }),
    ).resolves.toBe('class-backed created /memories/class.txt')
  })

  it('can sign view commands when enabled', async () => {
    const records: AtribRecord[] = []
    const memory = await createAtribMemoryTool(handlers(), {
      privateKey,
      signReads: true,
      logSubmission: 'disabled',
      onRecord: (record) => records.push(record),
    })

    await memory.view({ command: 'view', path: '/memories' })

    expect(records).toHaveLength(1)
    expect(records[0]!.tool_name).toBe('anthropic.memory.view')
  })

  it('chains multiple signed memory commands in one context', async () => {
    const contextId = '4bf92f3577b34da6a3ce929d0e0e4736'
    const memory = await createAtribMemoryTool(handlers(), {
      privateKey,
      contextId,
      logSubmission: 'disabled',
    })

    await memory.create({
      command: 'create',
      path: '/memories/a.txt',
      file_text: 'a',
    })
    await memory.delete({ command: 'delete', path: '/memories/a.txt' })

    const records = memory.getSignedRecords()
    const firstHash = `sha256:${hexEncode(sha256(canonicalRecord(records[0]!)))}`
    expect(records).toHaveLength(2)
    expect(records[0]!.chain_root).toBe(genesisChainRoot(contextId))
    expect(records[1]!.chain_root).toBe(firstHash)
    expect(records[1]!.chain_root).not.toBe(genesisChainRoot(contextId))
  })

  it('signs failed memory mutations without changing the thrown error', async () => {
    const error = new Error('disk full')
    const records: AtribRecord[] = []
    const sidecars: AtribMemorySidecar[] = []
    const memory = await createAtribMemoryTool(
      {
        ...handlers(),
        create: async () => {
          throw error
        },
      },
      {
        privateKey,
        logSubmission: 'disabled',
        onRecord: (record, sidecar) => {
          records.push(record)
          sidecars.push(sidecar)
        },
      },
    )

    await expect(
      memory.create({
        command: 'create',
        path: '/memories/failure.txt',
        file_text: 'body',
      }),
    ).rejects.toThrow(error)

    expect(records).toHaveLength(1)
    expect(sidecars[0]!.status).toBe('error')
    expect(sidecars[0]!.error?.message).toBe('disk full')
  })

  it('accepts base64url and hex private key strings', () => {
    const b64 = base64urlEncode(privateKey)
    expect(resolvePrivateKey(b64)).toEqual(privateKey)
    expect(resolvePrivateKey(Buffer.from(privateKey).toString('hex'))).toEqual(privateKey)
  })
})
