// SPDX-License-Identifier: Apache-2.0

import { execFile as execFileCallback } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import {
  canonicalRecord,
  hexEncode,
  sha256,
  verifyInclusion,
  verifyRecord,
  type AtribRecord,
  type ProofBundle,
} from '@atrib/mcp/worker'

const execFile = promisify(execFileCallback)
const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT_DIR = resolve(HERE, '..')
const SECRETS_PATH = resolve(PROJECT_DIR, '.tmp/secrets.json')
const RUNS_DIR = resolve(PROJECT_DIR, 'runs')
const LOG_ENDPOINT = 'https://log.atrib.dev/v1'

interface ListedRecord {
  record_hash: string
  tool_name: string | null
  created_at: number
  record: AtribRecord
  sidecar: unknown
}

interface ListedRecordResponse {
  count: number
  records: ListedRecord[]
}

interface ParsedCheckpoint {
  treeSize: number
  rootHash: string
}

export function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '')
}

export function recordHash(record: AtribRecord): string {
  return `sha256:${hexEncode(sha256(canonicalRecord(record)))}`
}

export function parseTextContent(result: unknown): string {
  const content = (result as { content?: Array<{ type?: string; text?: string }> }).content
  const text = content?.find((item) => item.type === 'text')?.text
  if (!text) {
    throw new Error(`MCP result did not contain text content: ${JSON.stringify(result)}`)
  }
  return text
}

export function parseCheckpoint(checkpoint: string): ParsedCheckpoint {
  const body = checkpoint.split('\n\n')[0]
  const lines = body?.trimEnd().split('\n') ?? []
  const treeSize = Number(lines[1])
  const rootHash = lines[2]
  if (!Number.isInteger(treeSize) || treeSize < 1 || !rootHash) {
    throw new Error(`Malformed checkpoint body: ${body}`)
  }
  return { treeSize, rootHash }
}

export async function ensureSecretFile(serverUrl?: string): Promise<boolean> {
  let secrets: Record<string, string> = {}
  try {
    secrets = JSON.parse(await readFile(SECRETS_PATH, 'utf8')) as Record<string, string>
  } catch {
    secrets = {}
  }

  let changed = false
  if (typeof secrets.ATRIB_PRIVATE_KEY !== 'string' || secrets.ATRIB_PRIVATE_KEY.length === 0) {
    secrets.ATRIB_PRIVATE_KEY = base64url(randomBytes(32))
    changed = true
  }

  if (serverUrl && secrets.ATRIB_SERVER_URL !== serverUrl) {
    secrets.ATRIB_SERVER_URL = serverUrl
    changed = true
  }

  if (!changed) return false

  await mkdir(dirname(SECRETS_PATH), { recursive: true })
  await writeFile(SECRETS_PATH, `${JSON.stringify(secrets, null, 2)}\n`, { mode: 0o600 })
  return true
}

export async function runWranglerDeploy(): Promise<string> {
  const { stdout, stderr } = await execFile(
    'pnpm',
    ['exec', 'wrangler', 'deploy', '--secrets-file', '.tmp/secrets.json'],
    {
      cwd: PROJECT_DIR,
      maxBuffer: 1024 * 1024 * 10,
    },
  )
  const combined = `${stdout}\n${stderr}`
  const urls = combined.match(/https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev/giu)
  const workerUrl = urls?.at(-1)
  if (!workerUrl) {
    throw new Error(`Could not find workers.dev URL in wrangler output:\n${combined}`)
  }
  return workerUrl.replace(/\/$/u, '')
}

export async function connectClient(workerUrl: string): Promise<Client> {
  const client = new Client(
    { name: 'atrib-cloudflare-live-proof-runner', version: '1.0.0' },
    { capabilities: {} },
  )
  const transport = new StreamableHTTPClientTransport(new URL(`${workerUrl}/mcp`))
  await client.connect(transport)
  return client
}

export async function submitForProof(record: AtribRecord): Promise<ProofBundle> {
  const response = await fetch(`${LOG_ENDPOINT}/entries`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-atrib-Priority': record.event_type.endsWith('/transaction') ? 'high' : 'normal',
    },
    body: JSON.stringify(record),
  })
  if (!response.ok) {
    throw new Error(
      `POST /v1/entries failed for ${recordHash(record)}: ${response.status} ${await response.text()}`,
    )
  }
  return (await response.json()) as ProofBundle
}

export function verifyProof(proof: ProofBundle): boolean {
  const checkpoint = parseCheckpoint(proof.checkpoint)
  const rootHash = new Uint8Array(Buffer.from(checkpoint.rootHash, 'base64'))
  const leafHash = new Uint8Array(Buffer.from(proof.leaf_hash, 'base64'))
  const proofHashes = proof.inclusion_proof.map(
    (item) => new Uint8Array(Buffer.from(item, 'base64')),
  )
  return verifyInclusion(proof.log_index, checkpoint.treeSize, leafHash, proofHashes, rootHash)
}

export async function fetchContextEntries(contextId: string): Promise<unknown> {
  const response = await fetch(`${LOG_ENDPOINT}/by-context/${contextId}`)
  if (!response.ok) {
    throw new Error(
      `GET /v1/by-context/${contextId} failed: ${response.status} ${await response.text()}`,
    )
  }
  return response.json()
}

export async function main() {
  await ensureSecretFile()
  let workerUrl = await runWranglerDeploy()
  const mcpUrl = `${workerUrl}/mcp`
  if (await ensureSecretFile(mcpUrl)) {
    workerUrl = await runWranglerDeploy()
  }
  const client = await connectClient(workerUrl)

  try {
    await client.listTools()
    await client.callTool({
      name: 'record_outcome',
      arguments: {
        action: 'cloudflare-live-proof',
        outcome: 'worked',
        diagnostic: 'McpAgent Durable Object stored the outcome and atrib wrapped the tool call.',
      },
    })
    const recall = await client.callTool({
      name: 'recall_outcomes',
      arguments: {
        action: 'cloudflare-live-proof',
        limit: 3,
      },
    })
    await client.callTool({ name: 'flush_atrib_queue', arguments: {} })
    const listed = await client.callTool({ name: 'list_signed_records', arguments: { limit: 10 } })
    await client.callTool({ name: 'flush_atrib_queue', arguments: {} })

    const parsed = JSON.parse(parseTextContent(listed)) as ListedRecordResponse
    if (parsed.records.length < 2) {
      throw new Error(`Expected at least two signed records, got ${parsed.records.length}`)
    }

    const verifications = []
    for (const item of parsed.records) {
      const expectedHash = recordHash(item.record)
      if (expectedHash !== item.record_hash) {
        throw new Error(
          `Record hash mismatch for ${item.tool_name}: ${item.record_hash} != ${expectedHash}`,
        )
      }
      const signatureOk = await verifyRecord(item.record)
      const proof = await submitForProof(item.record)
      const inclusionOk = verifyProof(proof)
      if (!signatureOk || !inclusionOk) {
        throw new Error(
          `Verification failed for ${item.record_hash}: signature=${signatureOk} inclusion=${inclusionOk}`,
        )
      }
      verifications.push({
        record_hash: item.record_hash,
        tool_name: item.tool_name,
        event_type: item.record.event_type,
        context_id: item.record.context_id,
        log_index: proof.log_index,
        signature_ok: signatureOk,
        inclusion_ok: inclusionOk,
      })
    }

    const contextEntries = await fetchContextEntries(parsed.records[0]!.record.context_id)
    const run = {
      ran_at: new Date().toISOString(),
      worker_url: workerUrl,
      mcp_url: `${workerUrl}/mcp`,
      recall_result: JSON.parse(parseTextContent(recall)) as unknown,
      verifications,
      context_entries: contextEntries,
    }

    await mkdir(RUNS_DIR, { recursive: true })
    const outPath = resolve(
      RUNS_DIR,
      `${new Date().toISOString().replaceAll(':', '').replaceAll('.', '')}.json`,
    )
    await writeFile(outPath, `${JSON.stringify(run, null, 2)}\n`)

    console.log(JSON.stringify(run, null, 2))
    console.error(`wrote ${outPath}`)
  } finally {
    await client.close()
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
