// SPDX-License-Identifier: Apache-2.0

import { execFile as execFileCallback } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
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

interface CapturedRecord {
  record_hash: string
  record: AtribRecord
  proof: ProofBundle
  created_at: number
}

interface ProofResponse {
  run_id: string
  upstream_url: string
  connection: {
    id: string
    state: string
  }
  wrapped_count: number
  tool_result: {
    status?: string
    order?: { id?: string }
    structuredContent?: {
      status?: string
      meta_seen?: {
        has_traceparent?: boolean
        keys?: string[]
      }
    }
  }
  gap_nodes: unknown[]
  captured: CapturedRecord[]
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

export async function ensureSecretFile(): Promise<void> {
  let secrets: Record<string, string>
  try {
    secrets = JSON.parse(await readFile(SECRETS_PATH, 'utf8')) as Record<string, string>
  } catch {
    secrets = {}
  }

  if (typeof secrets.ATRIB_PRIVATE_KEY === 'string' && secrets.ATRIB_PRIVATE_KEY.length > 0) {
    return
  }

  secrets.ATRIB_PRIVATE_KEY = base64url(randomBytes(32))
  await mkdir(dirname(SECRETS_PATH), { recursive: true })
  await writeFile(SECRETS_PATH, `${JSON.stringify(secrets, null, 2)}\n`, { mode: 0o600 })
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

export async function runClientProof(workerUrl: string): Promise<ProofResponse> {
  const response = await fetch(`${workerUrl}/run-client-proof`, { method: 'POST' })
  if (!response.ok) {
    throw new Error(`POST /run-client-proof failed: ${response.status} ${await response.text()}`)
  }
  return (await response.json()) as ProofResponse
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
  const workerUrl = await runWranglerDeploy()
  const proof = await runClientProof(workerUrl)

  if (proof.wrapped_count < 1) {
    throw new Error(`Expected at least one wrapped MCP connection, got ${proof.wrapped_count}`)
  }
  if (proof.tool_result.status !== 'completed') {
    throw new Error(`Expected completed checkout result, got ${JSON.stringify(proof.tool_result)}`)
  }
  if (proof.tool_result.structuredContent?.meta_seen?.has_traceparent !== true) {
    throw new Error(
      `Upstream MCP did not observe atrib trace metadata: ${JSON.stringify(proof.tool_result)}`,
    )
  }
  if (proof.gap_nodes.length < 1) {
    throw new Error('Expected at least one unsigned gap node for the unwrapped upstream MCP server')
  }
  if (proof.captured.length !== 1) {
    throw new Error(
      `Expected one captured fallback transaction record, got ${proof.captured.length}`,
    )
  }

  const verifications = []
  for (const item of proof.captured) {
    const expectedHash = recordHash(item.record)
    if (expectedHash !== item.record_hash) {
      throw new Error(`Record hash mismatch: ${item.record_hash} != ${expectedHash}`)
    }
    if (!item.record.event_type.endsWith('/transaction')) {
      throw new Error(`Expected transaction record, got ${item.record.event_type}`)
    }
    const signatureOk = await verifyRecord(item.record)
    const inclusionOk = verifyProof(item.proof)
    if (!signatureOk || !inclusionOk) {
      throw new Error(
        `Verification failed for ${item.record_hash}: signature=${signatureOk} inclusion=${inclusionOk}`,
      )
    }
    verifications.push({
      record_hash: item.record_hash,
      event_type: item.record.event_type,
      context_id: item.record.context_id,
      log_index: item.proof.log_index,
      signature_ok: signatureOk,
      inclusion_ok: inclusionOk,
    })
  }

  const contextEntries = await fetchContextEntries(proof.captured[0]!.record.context_id)
  const run = {
    ran_at: new Date().toISOString(),
    worker_url: workerUrl,
    run_id: proof.run_id,
    upstream_url: proof.upstream_url,
    connection: proof.connection,
    wrapped_count: proof.wrapped_count,
    tool_result: proof.tool_result,
    gap_nodes: proof.gap_nodes,
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
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
