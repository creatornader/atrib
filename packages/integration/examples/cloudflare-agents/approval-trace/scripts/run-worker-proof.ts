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
import { buildGraph } from '@atrib/graph-node'

const execFile = promisify(execFileCallback)
const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT_DIR = resolve(HERE, '..')
const SECRETS_PATH = resolve(PROJECT_DIR, '.tmp/secrets.json')
const RUNS_DIR = resolve(PROJECT_DIR, 'runs')

type WorkflowStatus =
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'executing'
  | 'succeeded'
  | 'failed'
type SignerRole = 'agent' | 'human' | 'action_mcp'

interface TraceRecord {
  label: string
  signer: SignerRole
  record_hash: string
  record: AtribRecord
  body: unknown
  args: unknown
  result: unknown
  proof: ProofBundle | null
}

interface TraceResponse {
  run_id: string
  status: WorkflowStatus
  context_id: string
  trace_packet: {
    answer: {
      decision: 'approved' | 'rejected' | null
      executed: boolean
      outcome: 'not_run' | 'success' | 'error' | 'pending'
      changed: string[]
    }
    differentiators: Array<{ name: string; evidence_labels: string[] }>
    timeline: Array<{
      label: string
      signer: SignerRole
      record_hash: string
      informed_by: string[]
    }>
  }
  records: TraceRecord[]
}

interface ParsedCheckpoint {
  treeSize: number
  rootHash: string
}

interface GraphEdgeLike {
  type: string
  source: string
  target: string
}

interface GraphNodeLike {
  id: string
  verification_state?: string
}

interface GraphResponseLike {
  nodes: GraphNodeLike[]
  edges: GraphEdgeLike[]
}

function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '')
}

function recordHash(record: AtribRecord): string {
  return `sha256:${hexEncode(sha256(canonicalRecord(record)))}`
}

function parseCheckpoint(checkpoint: string): ParsedCheckpoint {
  const body = checkpoint.split('\n\n')[0]
  const lines = body?.trimEnd().split('\n') ?? []
  const treeSize = Number(lines[1])
  const rootHash = lines[2]
  if (!Number.isInteger(treeSize) || treeSize < 1 || !rootHash) {
    throw new Error(`Malformed checkpoint body: ${body}`)
  }
  return { treeSize, rootHash }
}

function verifyProof(proof: ProofBundle): boolean {
  const checkpoint = parseCheckpoint(proof.checkpoint)
  const rootHash = new Uint8Array(Buffer.from(checkpoint.rootHash, 'base64'))
  const leafHash = new Uint8Array(Buffer.from(proof.leaf_hash, 'base64'))
  const proofHashes = proof.inclusion_proof.map(
    (item: string) => new Uint8Array(Buffer.from(item, 'base64')),
  )
  return verifyInclusion(proof.log_index, checkpoint.treeSize, leafHash, proofHashes, rootHash)
}

async function ensureSecretFile(): Promise<void> {
  let secrets: Record<string, string> = {}
  try {
    secrets = JSON.parse(await readFile(SECRETS_PATH, 'utf8')) as Record<string, string>
  } catch {
    secrets = {}
  }

  let changed = false
  for (const name of [
    'ATRIB_AGENT_PRIVATE_KEY',
    'ATRIB_HUMAN_APPROVER_PRIVATE_KEY',
    'ATRIB_ACTION_MCP_PRIVATE_KEY',
  ]) {
    if (!secrets[name]) {
      secrets[name] = base64url(randomBytes(32))
      changed = true
    }
  }

  if (!changed) return
  await mkdir(dirname(SECRETS_PATH), { recursive: true })
  await writeFile(SECRETS_PATH, `${JSON.stringify(secrets, null, 2)}\n`, { mode: 0o600 })
}

async function runWranglerDeploy(): Promise<string> {
  const { stdout, stderr } = await execFile(
    'pnpm',
    ['exec', 'wrangler', 'deploy', '--secrets-file', '.tmp/secrets.json'],
    { cwd: PROJECT_DIR, maxBuffer: 1024 * 1024 * 10 },
  )
  const combined = `${stdout}\n${stderr}`
  const urls = combined.match(/https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev/giu)
  const workerUrl = urls?.at(-1)
  if (!workerUrl) throw new Error(`Could not find workers.dev URL in wrangler output:\n${combined}`)
  return workerUrl.replace(/\/$/u, '')
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  let lastError = ''
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (response.ok) return (await response.json()) as T
    lastError = `${response.status} ${await response.text()}`
    if (response.status < 500) break
    await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)))
  }
  throw new Error(`${url} failed: ${lastError}`)
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url} failed: ${response.status} ${await response.text()}`)
  return (await response.json()) as T
}

async function runApproved(workerUrl: string, simulateError: boolean): Promise<TraceResponse> {
  const runId = `${simulateError ? 'error' : 'approved'}-${crypto.randomUUID()}`
  await postJson<TraceResponse>(`${workerUrl}/api/runs`, {
    run_id: runId,
    prompt:
      'A scheduled agent follow-up found a bug-labeled Workers issue with enough evidence to publish a triage reply.',
  })
  return postJson<TraceResponse>(`${workerUrl}/api/runs/${runId}/approve`, {
    reason: 'Payload matches the issue scope and expected Cloudflare support target.',
    simulate_error: simulateError,
  })
}

async function runRejected(workerUrl: string): Promise<TraceResponse> {
  const runId = `rejected-${crypto.randomUUID()}`
  await postJson<TraceResponse>(`${workerUrl}/api/runs`, {
    run_id: runId,
    prompt:
      'A scheduled agent follow-up found a bug-labeled Workers issue with enough evidence to publish a triage reply.',
  })
  return postJson<TraceResponse>(`${workerUrl}/api/runs/${runId}/reject`, {
    reason: 'The reviewer decided this issue reply should not be published.',
  })
}

function refsEqual(actual: string[] | undefined, expected: string[]): boolean {
  const a = [...(actual ?? [])].sort()
  const e = [...expected].sort()
  return a.length === e.length && a.every((value, index) => value === e[index])
}

function hasGraphEdge(
  graph: GraphResponseLike,
  type: string,
  source: string,
  target: string,
): boolean {
  return graph.edges.some(
    (edge) => edge.type === type && edge.source === source && edge.target === target,
  )
}

async function verifyTrace(
  trace: TraceResponse,
): Promise<Array<{ name: string; ok: boolean; detail?: string }>> {
  const checks: Array<{ name: string; ok: boolean; detail?: string }> = []
  const push = (name: string, ok: boolean, detail?: string) => checks.push({ name, ok, detail })
  const byLabel = new Map(trace.records.map((record) => [record.label, record]))
  const trigger = byLabel.get('trigger')
  const proposal = byLabel.get('proposal')
  const approval = byLabel.get('approval') ?? byLabel.get('rejection')
  const execution = byLabel.get('execution')
  const outcome = byLabel.get('outcome')
  const handoff = byLabel.get('handoff')
  const graph = (await buildGraph(
    trace.records.map((record) => record.record),
    [],
    { compactIntraSessionEdges: true },
  )) as GraphResponseLike
  const graphNodeIds = new Set(graph.nodes.map((node) => node.id))

  for (const item of trace.records) {
    push(`${trace.run_id}:${item.label}: hash`, recordHash(item.record) === item.record_hash)
    push(`${trace.run_id}:${item.label}: signature`, await verifyRecord(item.record))
    push(`${trace.run_id}:${item.label}: context`, item.record.context_id === trace.context_id)
    push(`${trace.run_id}:${item.label}: proof present`, Boolean(item.proof))
    if (item.proof) push(`${trace.run_id}:${item.label}: inclusion`, verifyProof(item.proof))
  }

  push(`${trace.run_id}: trigger exists`, Boolean(trigger))
  push(`${trace.run_id}: proposal exists`, Boolean(proposal))
  push(`${trace.run_id}: decision exists`, Boolean(approval))
  push(
    `${trace.run_id}: graph nodes cover records`,
    trace.records.every((record) => graphNodeIds.has(record.record_hash)),
  )
  push(
    `${trace.run_id}: graph signatures valid`,
    graph.nodes
      .filter((node) => graphNodeIds.has(node.id))
      .every((node) => node.verification_state === 'signature_valid'),
  )
  push(
    `${trace.run_id}: proposal points at trigger`,
    Boolean(trigger && proposal && refsEqual(proposal.record.informed_by, [trigger.record_hash])),
  )
  push(
    `${trace.run_id}: graph trigger edge`,
    Boolean(
      trigger &&
      proposal &&
      hasGraphEdge(graph, 'INFORMED_BY', proposal.record_hash, trigger.record_hash),
    ),
  )
  push(
    `${trace.run_id}: decision points at proposal`,
    Boolean(proposal && refsEqual(approval?.record.informed_by, [proposal.record_hash])),
  )
  push(
    `${trace.run_id}: graph decision edge`,
    Boolean(
      proposal &&
      approval &&
      hasGraphEdge(graph, 'INFORMED_BY', approval.record_hash, proposal.record_hash),
    ),
  )
  push(
    `${trace.run_id}: differentiators present`,
    [
      'Autonomous trigger context',
      'Decision context',
      'Semantic causal chain',
      'Trustless audit',
      'Signer separation',
    ].every((name) => trace.trace_packet.differentiators.some((item) => item.name === name)),
  )

  const agentKey = proposal?.record.creator_key
  const humanKey = approval?.record.creator_key
  const actionKey = execution?.record.creator_key
  push(
    `${trace.run_id}: agent and human signers differ`,
    Boolean(agentKey && humanKey && agentKey !== humanKey),
  )
  if (actionKey) {
    push(
      `${trace.run_id}: human and action signers differ`,
      Boolean(humanKey && humanKey !== actionKey),
    )
  }

  if (trace.status === 'rejected') {
    push(`${trace.run_id}: rejected did not execute`, !execution && !outcome && !handoff)
    push(
      `${trace.run_id}: rejected packet outcome`,
      trace.trace_packet.answer.outcome === 'not_run',
    )
  } else {
    push(`${trace.run_id}: execution exists`, Boolean(execution))
    push(`${trace.run_id}: outcome exists`, Boolean(outcome))
    push(`${trace.run_id}: handoff exists`, Boolean(handoff))
    push(
      `${trace.run_id}: execution points at approval`,
      Boolean(approval && refsEqual(execution?.record.informed_by, [approval.record_hash])),
    )
    push(
      `${trace.run_id}: graph preview edge`,
      Boolean(
        approval &&
        byLabel.get('preview') &&
        hasGraphEdge(
          graph,
          'INFORMED_BY',
          byLabel.get('preview')!.record_hash,
          approval.record_hash,
        ),
      ),
    )
    push(
      `${trace.run_id}: graph execution edge`,
      Boolean(
        approval &&
        execution &&
        hasGraphEdge(graph, 'INFORMED_BY', execution.record_hash, approval.record_hash),
      ),
    )
    push(
      `${trace.run_id}: outcome points at execution`,
      Boolean(execution && refsEqual(outcome?.record.informed_by, [execution.record_hash])),
    )
    push(
      `${trace.run_id}: graph outcome edge`,
      Boolean(
        execution &&
        outcome &&
        hasGraphEdge(graph, 'INFORMED_BY', outcome.record_hash, execution.record_hash),
      ),
    )
    push(
      `${trace.run_id}: handoff points at approval and outcome`,
      Boolean(
        approval &&
        outcome &&
        refsEqual(handoff?.record.informed_by, [approval.record_hash, outcome.record_hash]),
      ),
    )
    push(
      `${trace.run_id}: graph handoff edges`,
      Boolean(
        approval &&
        outcome &&
        handoff &&
        hasGraphEdge(graph, 'INFORMED_BY', handoff.record_hash, approval.record_hash) &&
        hasGraphEdge(graph, 'INFORMED_BY', handoff.record_hash, outcome.record_hash),
      ),
    )
    push(
      `${trace.run_id}: final outcome matches status`,
      trace.status === 'failed'
        ? trace.trace_packet.answer.outcome === 'error'
        : trace.trace_packet.answer.outcome === 'success',
    )
  }

  return checks
}

async function main() {
  await ensureSecretFile()
  const workerUrl = await runWranglerDeploy()
  await new Promise((resolve) => setTimeout(resolve, 1500))
  const page = await (await fetch(workerUrl)).text()
  const checks: Array<{ name: string; ok: boolean; detail?: string }> = [
    {
      name: 'interactive UI renders',
      ok:
        page.includes('data-testid="approval-trace-app"') &&
        page.includes('Cloudflare Agent Trace') &&
        page.includes('HITL halt') &&
        page.includes('Live agent progress') &&
        page.includes('Signed records will appear here as the workflow runs.') &&
        page.includes('Approve and resume'),
    },
  ]

  const traces = [
    await runApproved(workerUrl, false),
    await runRejected(workerUrl),
    await runApproved(workerUrl, true),
  ]
  for (const trace of traces) checks.push(...(await verifyTrace(trace)))

  const ok = checks.every((check) => check.ok)
  const run = {
    ran_at: new Date().toISOString(),
    ok,
    worker_url: workerUrl,
    checks,
    traces,
  }

  await mkdir(RUNS_DIR, { recursive: true })
  const outPath = resolve(
    RUNS_DIR,
    `${new Date().toISOString().replaceAll(':', '').replaceAll('.', '')}.worker.json`,
  )
  await writeFile(outPath, `${JSON.stringify(run, null, 2)}\n`)
  console.log(JSON.stringify(run, null, 2))
  console.error(`wrote ${outPath}`)

  if (!ok) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
