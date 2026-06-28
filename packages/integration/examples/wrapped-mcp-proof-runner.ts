// SPDX-License-Identifier: Apache-2.0

import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  canonicalRecord,
  hexEncode,
  sha256,
  verifyInclusion,
  verifyRecord,
  type AtribRecord,
  type ProofBundle,
} from '@atrib/mcp'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const EVENT_TYPE_TOOL_CALL = 'https://atrib.dev/v1/types/tool_call'

type LocalLogServer = {
  endpoint: string
  submissions: CapturedLogSubmission[]
  close(): Promise<void>
}

type CapturedLogSubmission = {
  record: AtribRecord
  record_hash: string
  proof: ProofBundle
  public_endpoint: string | null
}

type LogMode = 'local' | 'public'

export type PacketCall = {
  name: string
  arguments?: Record<string, unknown>
  expectText?: string
}

export type CleanupOnFailure = {
  name: string
  arguments?: Record<string, unknown>
  afterTool?: string
}

type PacketUpstream =
  | {
      type?: 'stdio'
      command: string
      args?: string[]
      env?: Record<string, string>
    }
  | {
      type: 'http'
      url: string
      headers?: Record<string, string>
    }

export type WrappedMcpPacketResult = {
  ok: true
  mode: 'fixture' | 'live'
  packet: string
  upstream_shape: string
  signed_records: number
  operations: string[]
  record_hashes: string[]
  log_indexes: number[]
  log: {
    mode: LogMode
    endpoint: string
    publish_policy: 'local-capture-only' | 'accepted-run-after-verification'
    inclusion_verified: boolean
    proofs: Array<{
      record_hash: string
      log_index: number
      leaf_hash: string
      checkpoint: string
      inclusion_proof: string[]
    }>
  }
  verifier: {
    record_valid: boolean
    checked_records: number
    event_type: string
    args_hash_present: boolean
    result_hash_present: boolean
  }
  privacy: {
    public_records_hash_only: boolean
    private_needles_absent_from_public_records: boolean
  }
}

export function hashText(value: string): string {
  return `sha256:${hexEncode(sha256(new TextEncoder().encode(value)))}`
}

export function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function recordHash(record: AtribRecord): string {
  return `sha256:${hexEncode(sha256(canonicalRecord(record)))}`
}

function parseCheckpoint(checkpoint: string): { treeSize: number; rootHash: string } {
  const body = checkpoint.split('\n\n')[0]
  const lines = body?.trimEnd().split('\n') ?? []
  const treeSize = Number(lines[1])
  const rootHash = lines[2]
  if (!Number.isInteger(treeSize) || treeSize < 1 || !rootHash) {
    throw new Error('malformed checkpoint in log proof')
  }
  return { treeSize, rootHash }
}

function verifyProof(proof: ProofBundle): boolean {
  const checkpoint = parseCheckpoint(proof.checkpoint)
  const rootHash = new Uint8Array(Buffer.from(checkpoint.rootHash, 'base64'))
  const leafHash = new Uint8Array(Buffer.from(proof.leaf_hash, 'base64'))
  const proofHashes = proof.inclusion_proof.map(
    (item) => new Uint8Array(Buffer.from(item, 'base64')),
  )
  return verifyInclusion(proof.log_index, checkpoint.treeSize, leafHash, proofHashes, rootHash)
}

async function startCaptureLog(options: { checkpoint: string }): Promise<LocalLogServer> {
  const submissions: CapturedLogSubmission[] = []
  const server = createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/v1/entries') {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'not_found' }))
      return
    }

    let body = ''
    for await (const chunk of req) body += chunk
    try {
      const record = JSON.parse(body) as AtribRecord
      const hash = recordHash(record)
      const proof = {
        log_index: submissions.length,
        checkpoint: options.checkpoint,
        inclusion_proof: [],
        leaf_hash: Buffer.alloc(32).toString('base64'),
      }
      submissions.push({
        record,
        record_hash: hash,
        proof,
        public_endpoint: null,
      })
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(proof))
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          error: 'capture_log_failed',
          message: err instanceof Error ? err.message : 'unknown error',
        }),
      )
    }
  })

  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error) => reject(err)
    server.once('error', onError)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', onError)
      resolve()
    })
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('local log did not bind to a TCP port')
  }

  return {
    endpoint: `http://127.0.0.1:${address.port}/v1/entries`,
    submissions,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()))
      }),
  }
}

async function submitRecordToPublicLog(
  record: AtribRecord,
  publicLogEndpoint: string,
): Promise<CapturedLogSubmission> {
  const body = JSON.stringify(record)
  const hash = recordHash(record)
  const upstream = await fetch(publicLogEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-atrib-Priority': record.event_type.endsWith('/transaction') ? 'high' : 'normal',
    },
    body,
  })
  const responseBody = await upstream.text()
  if (!upstream.ok) {
    throw new Error(
      `public log submission failed for ${hash}: status ${upstream.status} ${responseBody.slice(0, 300)}`,
    )
  }
  return {
    record,
    record_hash: hash,
    proof: JSON.parse(responseBody) as ProofBundle,
    public_endpoint: publicLogEndpoint,
  }
}

async function publishAcceptedRecords(
  records: AtribRecord[],
  publicLogEndpoint: string,
): Promise<CapturedLogSubmission[]> {
  const submissions: CapturedLogSubmission[] = []
  for (const record of records) {
    submissions.push(await submitRecordToPublicLog(record, publicLogEndpoint))
  }
  return submissions
}

function cleanEnv(extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') env[key] = value
  }
  return { ...env, ...extra }
}

async function waitFor(predicate: () => boolean, label: string, timeoutMs = 5000): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`timed out waiting for ${label}`)
}

function mirrorRecords(recordFile: string): AtribRecord[] {
  const raw = readFileSync(recordFile, 'utf8').trim()
  if (!raw) throw new Error('record mirror is empty')

  return raw.split('\n').map((line) => {
    const parsed = JSON.parse(line) as unknown
    const candidate =
      typeof parsed === 'object' &&
      parsed !== null &&
      'record' in parsed &&
      typeof (parsed as { record?: unknown }).record === 'object'
        ? (parsed as { record: AtribRecord }).record
        : (parsed as AtribRecord)

    if (
      typeof candidate.context_id !== 'string' ||
      typeof candidate.signature !== 'string' ||
      typeof candidate.creator_key !== 'string'
    ) {
      throw new Error('record mirror did not contain a signed atrib record')
    }

    return candidate
  })
}

function toolText(result: unknown): string {
  if (typeof result !== 'object' || result === null) return ''
  const content = (result as { content?: unknown }).content
  if (!Array.isArray(content)) return ''
  return content
    .map((item) => {
      if (typeof item !== 'object' || item === null) return ''
      const text = (item as { text?: unknown }).text
      return typeof text === 'string' ? text : ''
    })
    .join('\n')
}

export function redactUpstreamDiagnostic(message: string, privateNeedles: string[]): string {
  let redacted = message
  for (const needle of privateNeedles) {
    if (needle) redacted = redacted.split(needle).join('[redacted-private-field]')
  }
  return redacted
    .replace(/bb_[A-Za-z0-9_-]+/gu, '[redacted-browserbase-session]')
    .replace(/https:\/\/browserbase[^\s"'`<>]+/giu, '[redacted-browserbase-url]')
    .replace(/AIza[0-9A-Za-z_-]+/gu, '[redacted-google-key]')
    .replace(/fc-[A-Za-z0-9_-]+/gu, '[redacted-firecrawl-key]')
}

function upstreamErrorMessage(toolName: string, result: unknown, privateNeedles: string[]): string {
  const diagnostic = redactUpstreamDiagnostic(toolText(result), privateNeedles).trim()
  const suffix = diagnostic ? `: ${diagnostic.slice(0, 1200)}` : ''
  return `upstream returned an error for ${toolName}${suffix}`
}

function findNeedlePath(value: unknown, needle: string, path: string): string | undefined {
  if (typeof value === 'string') return value.includes(needle) ? path : undefined
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findNeedlePath(value[index], needle, `${path}[${index}]`)
      if (found) return found
    }
    return undefined
  }
  if (typeof value === 'object' && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      const found = findNeedlePath(child, needle, `${path}.${key}`)
      if (found) return found
    }
  }
  return undefined
}

export async function runWrappedMcpPacket(options: {
  packet: string
  mode?: 'fixture' | 'live'
  logMode?: LogMode
  publicLogEndpoint?: string
  upstreamShape: string
  exampleDir: string
  integrationDir: string
  fixtureServer?: string
  upstream?: PacketUpstream
  expectedTools: string[]
  calls: PacketCall[]
  cleanupOnFailure?: CleanupOnFailure
  timeoutMs?: number
  privateNeedles: string[]
}): Promise<WrappedMcpPacketResult> {
  const wrapperMain = join(options.integrationDir, '..', 'mcp-wrap', 'dist', 'main.js')
  if (!existsSync(wrapperMain)) {
    throw new Error(
      'missing @atrib/mcp-wrap dist/main.js. Run `pnpm --filter @atrib/mcp-wrap build` first.',
    )
  }

  const tempDir = mkdtempSync(join(tmpdir(), `atrib-${options.packet}-`))
  const configPath = join(tempDir, 'wrap-config.json')
  const recordFile = join(tempDir, 'records.jsonl')
  const logFile = join(tempDir, 'wrapper.log')
  const logMode = options.logMode ?? 'local'
  const privateNeedles = options.privateNeedles.filter((needle) => needle.length > 0)
  const publicLogEndpoint = options.publicLogEndpoint ?? 'https://log.atrib.dev/v1/entries'
  const captureLog = await startCaptureLog({
    checkpoint: `${options.packet}-local`,
  })
  const client = new Client({ name: `${options.packet}-packet-host`, version: '0.1.0' })
  const upstream =
    options.upstream ??
    (options.fixtureServer
      ? {
          command: 'pnpm',
          args: ['exec', 'tsx', options.fixtureServer],
        }
      : undefined)
  if (!upstream) throw new Error('runWrappedMcpPacket requires fixtureServer or upstream')

  const config = {
    name: options.packet,
    agent: `${options.packet}-proof`,
    upstream,
    serverUrl: `${options.packet}://mcp.local`,
    logEndpoint: captureLog.endpoint,
    recordFile,
    logFile,
    autoChain: true,
    autoChainFallback: 'fresh',
    disclosure: {
      tool_name: 'verbatim',
      args: 'plain-sha256',
      result: 'plain-sha256',
    },
  }
  writeFileSync(configPath, JSON.stringify(config, null, 2))

  const transport = new StdioClientTransport({
    command: 'node',
    args: [wrapperMain, configPath],
    env: cleanEnv({ ATRIB_PRIVATE_KEY: randomBytes(32).toString('base64url') }),
    stderr: 'pipe',
  })
  transport.stderr?.on('data', () => {})
  const completedCalls: string[] = []
  let timedOut = false
  const timeout =
    options.timeoutMs && options.timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true
          void transport.close().catch(() => {})
          void client.close().catch(() => {})
        }, options.timeoutMs)
      : undefined

  async function cleanupAfterFailedRun(): Promise<void> {
    const cleanup = options.cleanupOnFailure
    if (!cleanup) return
    if (cleanup.afterTool && !completedCalls.includes(cleanup.afterTool)) return
    if (completedCalls.includes(cleanup.name)) return
    await client
      .callTool({
        name: cleanup.name,
        arguments: cleanup.arguments ?? {},
      })
      .catch(() => {})
  }

  try {
    await client.connect(transport)
    const tools = await client.listTools()
    const toolNames = new Set(tools.tools.map((tool) => tool.name))
    for (const expected of options.expectedTools) {
      if (!toolNames.has(expected)) {
        throw new Error(`expected ${expected} tool, saw: ${[...toolNames].join(', ')}`)
      }
    }

    for (const call of options.calls) {
      const result = await client.callTool({
        name: call.name,
        arguments: call.arguments ?? {},
      })
      if (
        typeof result === 'object' &&
        result !== null &&
        (result as { isError?: unknown }).isError === true
      ) {
        throw new Error(upstreamErrorMessage(call.name, result, privateNeedles))
      }
      if (call.expectText && !toolText(result).includes(call.expectText)) {
        throw new Error(`unexpected ${call.name} result; expected marker was not present`)
      }
      completedCalls.push(call.name)
    }

    await waitFor(() => existsSync(recordFile), 'record mirror')
    await waitFor(
      () => captureLog.submissions.length >= options.calls.length,
      `${logMode} log submissions`,
      logMode === 'public' ? 15000 : 5000,
    )

    const records = mirrorRecords(recordFile)
    const operations = records.map((record) => {
      if (!record.tool_name) throw new Error('signed record is missing tool_name')
      return record.tool_name
    })
    if (records.length !== options.calls.length) {
      throw new Error(`expected ${options.calls.length} signed records, got ${records.length}`)
    }
    const expectedOrder = options.calls.map((call) => call.name)
    if (operations.join(',') !== expectedOrder.join(',')) {
      throw new Error(`unexpected signed tool order: ${operations.join(',')}`)
    }

    for (const record of records) {
      if (record.event_type !== EVENT_TYPE_TOOL_CALL) {
        throw new Error(`expected tool_call record, got ${record.event_type}`)
      }
      if (!record.args_hash || !record.result_hash) {
        throw new Error(`expected args_hash and result_hash disclosures for ${record.tool_name}`)
      }
      if (!(await verifyRecord(record))) {
        throw new Error(`record signature failed verification for ${record.tool_name}`)
      }
    }

    const publicRecordJson = JSON.stringify(records)
    for (const needle of privateNeedles) {
      if (publicRecordJson.includes(needle)) {
        const path = findNeedlePath(records, needle, 'records') ?? 'records'
        throw new Error(`public records leaked private material at ${path}`)
      }
    }

    const recordHashes = records.map(
      (record) => `sha256:${hexEncode(sha256(canonicalRecord(record)))}`,
    )
    const capturedHashes = captureLog.submissions.map((submission) => submission.record_hash)
    if (capturedHashes.join(',') !== recordHashes.join(',')) {
      throw new Error('captured log submissions did not match verified record mirror')
    }

    const acceptedSubmissions =
      logMode === 'public'
        ? await publishAcceptedRecords(records, publicLogEndpoint)
        : captureLog.submissions
    const proofs = acceptedSubmissions.map((submission) => ({
      record_hash: submission.record_hash,
      log_index: submission.proof.log_index,
      leaf_hash: submission.proof.leaf_hash,
      checkpoint: submission.proof.checkpoint,
      inclusion_proof: submission.proof.inclusion_proof,
    }))
    const inclusionVerified =
      logMode === 'public'
        ? acceptedSubmissions.every((submission) => verifyProof(submission.proof))
        : false
    if (logMode === 'public' && !inclusionVerified) {
      throw new Error('public log inclusion verification failed')
    }

    return {
      ok: true,
      mode: options.mode ?? 'fixture',
      packet: options.packet,
      upstream_shape: options.upstreamShape,
      signed_records: records.length,
      operations,
      record_hashes: recordHashes,
      log_indexes: acceptedSubmissions.map((submission) => submission.proof.log_index),
      log: {
        mode: logMode,
        endpoint: logMode === 'public' ? publicLogEndpoint : captureLog.endpoint,
        publish_policy:
          logMode === 'public' ? 'accepted-run-after-verification' : 'local-capture-only',
        inclusion_verified: inclusionVerified,
        proofs,
      },
      verifier: {
        record_valid: true,
        checked_records: records.length,
        event_type: EVENT_TYPE_TOOL_CALL,
        args_hash_present: records.every((record) => Boolean(record.args_hash)),
        result_hash_present: records.every((record) => Boolean(record.result_hash)),
      },
      privacy: {
        public_records_hash_only: true,
        private_needles_absent_from_public_records: true,
      },
    }
  } catch (error) {
    if (timedOut) {
      throw new Error(`packet timed out after ${options.timeoutMs}ms`)
    }
    await cleanupAfterFailedRun()
    throw error
  } finally {
    if (timeout) clearTimeout(timeout)
    await client.close().catch(() => {})
    await captureLog.close().catch(() => {})
    rmSync(tempDir, { recursive: true, force: true })
  }
}
