// SPDX-License-Identifier: Apache-2.0

import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MCPClient } from '@mastra/mcp'
import { isValidationError, noopObserve } from '@mastra/core/tools'
import { canonicalRecord, hexEncode, sha256, verifyRecord } from '@atrib/mcp'
import { MastraRuntimeReceiptRecorder } from '../src/mastra-runtime-receipt.js'
import { mastraCompatibilityServer } from '../examples/mastra-runtime/mastra-compat-server.js'

type ServerConfig = ConstructorParameters<typeof MCPClient>[0]['servers'][string]
type InputHandler = NonNullable<ServerConfig['inputRequests']>
const clients: MCPClient[] = []
afterEach(async () => {
  for (const client of clients.splice(0)) await client.disconnect()
})

async function fixture(inputRequests?: InputHandler) {
  const root = join(process.cwd(), '..', '..')
  const client = new MCPClient({
    id: `atrib-mastra2-${randomUUID()}`,
    timeout: 10000,
    servers: {
      fixture: {
        command: join(
          root,
          'node_modules',
          '.bin',
          process.platform === 'win32' ? 'tsx.cmd' : 'tsx',
        ),
        args: [join(process.cwd(), 'examples/mastra-runtime/mastra-compat-server.ts')],
        cwd: process.cwd(),
        stderr: 'pipe',
        protocolVersion: '2026-07-28',
        ...(inputRequests ? { inputRequests } : {}),
      },
    },
  })
  clients.push(client)
  const tools = await client.listTools()
  return {
    tools,
    stats: () => tools.fixture_inspect_calls!.execute!({}, { observe: noopObserve }),
  }
}

describe('Mastra MCP 2 native compatibility', () => {
  it('rejects invalid input before the handler and recovers over the same stdio connection', async () => {
    const f = await fixture()
    const invalid = await f.tools.fixture_probe!.execute!({ value: 42 }, { observe: noopObserve })
    expect(isValidationError(invalid)).toBe(true)
    expect(await f.stats()).toMatchObject({ probe: 0 })
    expect(
      await f.tools.fixture_probe!.execute!({ value: 'recovered' }, { observe: noopObserve }),
    ).toEqual({
      echo: 'recovered',
      protocol: '2026-07-28',
    })
    expect(await f.stats()).toMatchObject({ probe: 1 })
  }, 15000)

  it('preserves backend exceptions, error receipts, recovery and private payloads', async () => {
    const f = await fixture()
    const recorder = new MastraRuntimeReceiptRecorder({
      privateKey: new Uint8Array(32).fill(26),
      contextId: '44444444444444444444444444444444',
      logSubmission: 'disabled',
    })
    const run = (fail: boolean) =>
      recorder.toolCall({
        surface: 'mcp-client-tool',
        serverName: 'fixture',
        toolName: 'probe',
        namespacedToolName: 'fixture_probe',
        toolCallId: `probe-${fail}`,
        args: { value: 'private fixture payload', fail },
        run: () =>
          f.tools.fixture_probe!.execute!(
            { value: 'private fixture payload', fail },
            { observe: noopObserve },
          ),
      })
    await expect(run(true)).rejects.toThrow('fixture backend denied')
    expect(await run(false)).toMatchObject({ echo: 'private fixture payload' })
    const records = recorder.getSignedRecords()
    expect(records).toHaveLength(2)
    expect(recorder.getSidecars().map((sidecar) => sidecar.status)).toEqual(['error', 'ok'])
    expect(records[1]!.chain_root).toBe(`sha256:${hexEncode(sha256(canonicalRecord(records[0]!)))}`)
    for (const record of records) expect(await verifyRecord(record)).toBe(true)
    expect(JSON.stringify(records)).not.toContain('private fixture payload')
    expect(JSON.stringify(recorder.getSidecars())).toContain('private fixture payload')
    expect(await f.stats()).toMatchObject({ probe: 2 })
  }, 15000)

  it('suspends and resumes one MCP request through the native input handler', async () => {
    let questions = 0
    const f = await fixture(async ({ key, params }) => {
      questions++
      expect(key).toBe('input')
      expect(params.mode).toBe('form')
      return { action: 'accept', content: { approved: true } }
    })
    expect(
      await f.tools.fixture_confirm!.execute!({ action: 'local-only' }, { observe: noopObserve }),
    ).toEqual({
      confirmed: true,
      action: 'local-only',
    })
    expect(questions).toBe(1)
    expect(await f.stats()).toEqual({ probe: 0, confirm: 2, completions: 1 })
  }, 15000)

  for (const answer of ['decline', 'malformed', 'absent'] as const) {
    it(`does not complete a suspended request after ${answer} input`, async () => {
      const handler: InputHandler | undefined =
        answer === 'absent'
          ? undefined
          : async () =>
              answer === 'decline'
                ? { action: 'decline' }
                : { action: 'accept', content: { approved: 'not-a-boolean' } }
      const f = await fixture(handler)
      await expect(
        f.tools.fixture_confirm!.execute!({ action: 'local-only' }, { observe: noopObserve }),
      ).rejects.toThrow()
      expect(await f.stats()).toMatchObject({ completions: 0 })
      expect(
        await f.tools.fixture_probe!.execute!({ value: 'still-usable' }, { observe: noopObserve }),
      ).toMatchObject({
        echo: 'still-usable',
      })
    }, 15000)
  }

  it('keeps direct executeTool suspension explicit and validates resume data', async () => {
    try {
      const suspended = await mastraCompatibilityServer.executeTool('confirm', {
        action: 'direct-only',
      })
      expect(suspended.status).toBe('suspended')
      if (suspended.status !== 'suspended') throw new Error('expected fixture suspension')
      await expect(
        mastraCompatibilityServer.executeTool(
          'confirm',
          { action: 'direct-only' },
          {
            resumeData: { approved: 'invalid' },
            suspendPayload: suspended.suspendPayload,
          },
        ),
      ).rejects.toThrow()
      const completed = await mastraCompatibilityServer.executeTool(
        'confirm',
        { action: 'direct-only' },
        {
          resumeData: { approved: true },
          suspendPayload: suspended.suspendPayload,
        },
      )
      expect(completed).toEqual({
        status: 'completed',
        output: { confirmed: true, action: 'direct-only' },
      })
    } finally {
      await mastraCompatibilityServer.close()
    }
  })
})
