// SPDX-License-Identifier: Apache-2.0

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { verifyRecord, type AtribRecord } from '@atrib/mcp'
import { DaemonClient } from '../src/daemon.js'

const ROOT = resolve(__dirname, '..', '..', '..')
const SERVER = resolve(
  ROOT,
  'docs',
  'extensions',
  'dev.atrib-attribution',
  'independent-server.py',
)
const RECEIPT = resolve(
  ROOT,
  'spec',
  'conformance',
  'mcp-extension',
  'cases',
  'receipt--consistent.json',
)
const CONTEXT_ID = '5e'.repeat(16)
let child: ChildProcessWithoutNullStreams | undefined

afterEach(() => {
  child?.kill('SIGKILL')
  child = undefined
})

function startIndependentServer(): Promise<string> {
  return new Promise((resolveReady, rejectReady) => {
    child = spawn('python3', [SERVER, RECEIPT], { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(
      () => rejectReady(new Error(`independent server did not start: ${stderr}`)),
      10_000,
    )
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
      const newline = stdout.indexOf('\n')
      if (newline < 0) return
      clearTimeout(timer)
      resolveReady((JSON.parse(stdout.slice(0, newline)) as { endpoint: string }).endpoint)
    })
    child.once('exit', (code) => {
      clearTimeout(timer)
      rejectReady(new Error(`independent server exited with ${code}: ${stderr}`))
    })
  })
}

describe('independent dev.atrib/attribution server', () => {
  it(
    'interoperates with the atrib TypeScript client without atrib server code',
    { timeout: 20_000 },
    async () => {
      const endpoint = await startIndependentServer()
      const client = new DaemonClient(
        { endpoint, connectTimeoutMs: 5_000, callTimeoutMs: 5_000 },
        { attributionAccept: ['token', 'record'] },
      )
      const outcome = await client.callTool(
        'independent_attest',
        { context_id: CONTEXT_ID },
        { contextId: CONTEXT_ID },
      )
      expect(outcome.ok, outcome.ok ? undefined : outcome.reason).toBe(true)
      if (!outcome.ok) return
      expect(outcome.transport.protocol_version).toBe('2026-07-28')
      expect(outcome.transport.protocol_era).toBe('modern')
      expect(outcome.transport.attribution.declared).toBe(true)
      expect(outcome.attribution?.verification).toEqual({ valid: true, mismatched: [] })
      expect(outcome.attribution?.block.receipt.context_id).toBe(CONTEXT_ID)
      expect(outcome.attribution?.block.receipt.record_hash).toMatch(/^sha256:[0-9a-f]{64}$/)
      expect(outcome.attribution?.block.receipt.creator_key).toBe(
        outcome.attribution?.block.record?.creator_key,
      )
      expect(outcome.attribution?.block.receipt.chain_root).toBe(
        outcome.attribution?.block.record?.chain_root,
      )
      expect(await verifyRecord(outcome.attribution?.block.record as AtribRecord)).toBe(true)
    },
  )
})
