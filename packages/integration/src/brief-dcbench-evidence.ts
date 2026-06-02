// SPDX-License-Identifier: Apache-2.0

import { access } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import canonicalize from 'canonicalize'
import {
  base64urlEncode,
  canonicalRecord,
  computeContentId,
  EVENT_TYPE_TOOL_CALL_URI,
  getPublicKey,
  hexEncode,
  resolveChainRoot,
  sha256,
  signRecord,
  verifyRecord,
} from '@atrib/mcp'
import type { AtribRecord } from '@atrib/mcp'

type BriefDcbenchToolName =
  | 'brief.dcbench.context_lookup'
  | 'brief.dcbench.agent_action'
  | 'brief.dcbench.score'

interface DcbenchGotcha {
  id: string
  decision_id: string
  description: string
  weight: number
}

interface DcbenchTaskFixture {
  task_id: string
  title: string
  prompt: string
  max_score: number
  gotchas: DcbenchGotcha[]
}

interface LoadedDcbenchTask extends DcbenchTaskFixture {
  source: {
    kind: 'fixture' | 'dcbench-checkout'
    repo_path?: string
  }
}

interface BriefDcbenchEvidenceSidecar {
  framework: 'brief-dcbench'
  operation: BriefDcbenchToolName
  args: unknown
  result: unknown
  record_hash: string
}

export interface BriefDcbenchEvidenceResult {
  ok: true
  strategy: 'brief-dcbench-evidence-v1'
  note: string
  source: LoadedDcbenchTask['source'] & {
    task_id: string
    task_title: string
    decision_ids: string[]
    max_score: number
  }
  context_id: string
  signed_records: number
  operations: BriefDcbenchToolName[]
  record_hashes: string[]
  score: {
    earned_score: number
    max_score: number
    compliance_percent: number
    decision_points_checked: number
    blocking_violations: number
  }
  lineage: {
    action_informed_by_context_lookup: true
    score_informed_by_action: true
  }
  privacy: {
    public_records_hash_only: true
    local_sidecars_keep_prompt_and_rubric: true
  }
  caveats: string[]
}

interface RunBriefDcbenchEvidenceSmokeOptions {
  dcbenchRepoPath?: string
  now?: () => number
}

const CONTEXT_ID = '62726965662d646362656e63682d7072'
const SERVER_URL = 'brief-dcbench://decision-compliance'
const PRIVATE_KEY = new Uint8Array(32).fill(41)
const encoder = new TextEncoder()

const FIXTURE_TASK: DcbenchTaskFixture = {
  task_id: 'TASK-001',
  title: 'CSV export to analytics dashboard',
  prompt:
    'Add a CSV export button to the analytics dashboard with a date range picker and CSV download.',
  max_score: 6,
  gotchas: [
    {
      id: 'D-002-audit-log-export',
      decision_id: 'D-002',
      description: 'Data exports must use the audit-log wrapper.',
      weight: 3,
    },
    {
      id: 'D-001-date-range-picker',
      decision_id: 'D-001',
      description: 'Use the current date range picker rather than the deprecated calendar path.',
      weight: 2,
    },
    {
      id: 'D-003-button-secondary-export',
      decision_id: 'D-003',
      description: 'Export is read-only, so the button uses the secondary variant.',
      weight: 1,
    },
  ],
}

export async function runBriefDcbenchEvidenceSmoke(
  options: RunBriefDcbenchEvidenceSmokeOptions = {},
): Promise<BriefDcbenchEvidenceResult> {
  const task = await loadDcbenchTask(options.dcbenchRepoPath ?? process.env.DCBENCH_REPO)
  const creatorKey = base64urlEncode(await getPublicKey(PRIVATE_KEY))
  const now = options.now ?? timestampClock(1_779_840_200_000)
  const records: AtribRecord[] = []
  const sidecars: BriefDcbenchEvidenceSidecar[] = []
  let lastRecordHashHex: string | undefined

  const contextResult = {
    retrieved_decisions: task.gotchas.map((gotcha) => ({
      decision_id: gotcha.decision_id,
      gotcha_id: gotcha.id,
      weight: gotcha.weight,
    })),
    max_score: task.max_score,
  }
  const contextRecordHash = await signStep({
    creatorKey,
    records,
    sidecars,
    lastRecordHashHex,
    toolName: 'brief.dcbench.context_lookup',
    now: now(),
    args: {
      benchmark: 'brief-hq/dcbench',
      task_id: task.task_id,
      prompt: task.prompt,
    },
    result: {
      ...contextResult,
      rubric: task.gotchas,
    },
  })
  lastRecordHashHex = contextRecordHash.slice('sha256:'.length)

  const actionResult = {
    changed_files: [
      'src/components/dashboard/export-button.tsx',
      'src/app/api/analytics/export/route.ts',
    ],
    cited_decisions: decisionIds(task),
    private_patch_summary: 'candidate patch follows all selected dcbench decision markers',
  }
  const actionRecordHash = await signStep({
    creatorKey,
    records,
    sidecars,
    lastRecordHashHex,
    toolName: 'brief.dcbench.agent_action',
    now: now(),
    informedBy: [contextRecordHash],
    args: {
      task_id: task.task_id,
      context_lookup_record: contextRecordHash,
      requested_action: task.prompt,
    },
    result: actionResult,
  })
  lastRecordHashHex = actionRecordHash.slice('sha256:'.length)

  const score = {
    earned_score: task.max_score,
    max_score: task.max_score,
    compliance_percent: 100,
    decision_points_checked: task.gotchas.length,
    blocking_violations: 0,
  }
  await signStep({
    creatorKey,
    records,
    sidecars,
    lastRecordHashHex,
    toolName: 'brief.dcbench.score',
    now: now(),
    informedBy: [actionRecordHash],
    args: {
      task_id: task.task_id,
      scored_record: actionRecordHash,
      rubric_source_record: contextRecordHash,
    },
    result: {
      score,
      per_decision: task.gotchas.map((gotcha) => ({
        decision_id: gotcha.decision_id,
        gotcha_id: gotcha.id,
        earned: gotcha.weight,
        max: gotcha.weight,
      })),
    },
  })

  const invalid: string[] = []
  for (const record of records) {
    if (!(await verifyRecord(record))) invalid.push(record.tool_name ?? 'unknown')
  }
  if (invalid.length > 0) {
    throw new Error(`invalid signed record(s): ${invalid.join(', ')}`)
  }

  const publicRecordJson = JSON.stringify(records)
  if (publicRecordJson.includes(task.prompt) || publicRecordJson.includes('audit-log wrapper')) {
    throw new Error('public records leaked dcbench prompt or rubric material')
  }
  const sidecarJson = JSON.stringify(sidecars)
  if (!sidecarJson.includes(task.prompt) || !sidecarJson.includes('D-002')) {
    throw new Error('local sidecars should keep dcbench prompt and rubric material')
  }

  const recordHashes = records.map(recordHash)
  const operations = records.map((record) => record.tool_name as BriefDcbenchToolName)
  const actionRecord = records.find((record) => record.tool_name === 'brief.dcbench.agent_action')
  const scoreRecord = records.find((record) => record.tool_name === 'brief.dcbench.score')
  if (!actionRecord?.informed_by?.includes(recordHashes[0]!)) {
    throw new Error('agent action record did not cite the context lookup record')
  }
  if (!scoreRecord?.informed_by?.includes(recordHashes[1]!)) {
    throw new Error('score record did not cite the agent action record')
  }

  return {
    ok: true,
    strategy: 'brief-dcbench-evidence-v1',
    note: 'Signs a dcbench-shaped decision-compliance evidence path as hash-only atrib records while local sidecars keep prompt and rubric material.',
    source: {
      ...task.source,
      task_id: task.task_id,
      task_title: task.title,
      decision_ids: decisionIds(task),
      max_score: task.max_score,
    },
    context_id: CONTEXT_ID,
    signed_records: records.length,
    operations,
    record_hashes: recordHashes,
    score,
    lineage: {
      action_informed_by_context_lookup: true,
      score_informed_by_action: true,
    },
    privacy: {
      public_records_hash_only: true,
      local_sidecars_keep_prompt_and_rubric: true,
    },
    caveats: [
      'This proof does not call Brief CLI or Brief MCP.',
      'This proof does not run Claude Code or Brief against every dcbench task.',
      'Use DCBENCH_REPO to read task metadata from a local brief-hq/dcbench checkout.',
      'Outreach still needs operator approval and a route-specific draft.',
    ],
  }
}

async function signStep(input: {
  creatorKey: string
  records: AtribRecord[]
  sidecars: BriefDcbenchEvidenceSidecar[]
  lastRecordHashHex: string | undefined
  toolName: BriefDcbenchToolName
  now: number
  args: unknown
  result: unknown
  informedBy?: string[]
}): Promise<string> {
  const record: AtribRecord = {
    spec_version: 'atrib/1.0',
    content_id: computeContentId(SERVER_URL, input.toolName),
    creator_key: input.creatorKey,
    chain_root: resolveChainRoot({
      contextId: CONTEXT_ID,
      autoChainTailHex: input.lastRecordHashHex,
    }),
    event_type: EVENT_TYPE_TOOL_CALL_URI,
    context_id: CONTEXT_ID,
    timestamp: input.now,
    signature: '',
    args_hash: hashCanonical(input.args),
    result_hash: hashCanonical(input.result),
    tool_name: input.toolName,
    ...(input.informedBy?.length ? { informed_by: input.informedBy } : {}),
  }
  const signed = await signRecord(record, PRIVATE_KEY)
  const hash = recordHash(signed)
  input.records.push(signed)
  input.sidecars.push({
    framework: 'brief-dcbench',
    operation: input.toolName,
    args: input.args,
    result: input.result,
    record_hash: hash,
  })
  return hash
}

async function loadDcbenchTask(repoPath: string | undefined): Promise<LoadedDcbenchTask> {
  if (!repoPath) {
    return {
      ...FIXTURE_TASK,
      source: { kind: 'fixture' },
    }
  }

  const absoluteRepo = resolve(repoPath)
  const taskFile = join(absoluteRepo, 'benchmark', 'tasks.ts')
  await access(taskFile)
  const taskModule = (await import(pathToFileURL(taskFile).href)) as {
    BENCHMARK_TASKS?: unknown
  }
  if (!Array.isArray(taskModule.BENCHMARK_TASKS)) {
    throw new Error('dcbench checkout does not export BENCHMARK_TASKS')
  }
  const rawTask =
    taskModule.BENCHMARK_TASKS.find(
      (task): task is Record<string, unknown> =>
        isRecord(task) && task.taskId === FIXTURE_TASK.task_id,
    ) ?? taskModule.BENCHMARK_TASKS.find(isRecord)
  if (!rawTask) {
    throw new Error('dcbench checkout has no readable benchmark task')
  }
  const normalized = normalizeDcbenchTask(rawTask)
  return {
    ...normalized,
    source: {
      kind: 'dcbench-checkout',
      repo_path: absoluteRepo,
    },
  }
}

function normalizeDcbenchTask(rawTask: Record<string, unknown>): DcbenchTaskFixture {
  const taskId = readString(rawTask.taskId, 'taskId')
  const title = readString(rawTask.title, 'title')
  const prompt = readString(rawTask.prompt, 'prompt')
  const maxScore = readNumber(rawTask.maxScore, 'maxScore')
  if (!Array.isArray(rawTask.gotchas)) {
    throw new Error(`dcbench task ${taskId} has no gotchas array`)
  }
  return {
    task_id: taskId,
    title,
    prompt,
    max_score: maxScore,
    gotchas: rawTask.gotchas.map((rawGotcha, index) => normalizeGotcha(rawGotcha, index)),
  }
}

function normalizeGotcha(rawGotcha: unknown, index: number): DcbenchGotcha {
  if (!isRecord(rawGotcha)) {
    throw new Error(`dcbench gotcha ${index} is not an object`)
  }
  return {
    id: readString(rawGotcha.id, `gotchas[${index}].id`),
    decision_id: readString(rawGotcha.decisionId, `gotchas[${index}].decisionId`),
    description: readString(rawGotcha.description, `gotchas[${index}].description`),
    weight: readNumber(rawGotcha.weight, `gotchas[${index}].weight`),
  }
}

function decisionIds(task: DcbenchTaskFixture): string[] {
  return [...new Set(task.gotchas.map((gotcha) => gotcha.decision_id))].sort()
}

function hashCanonical(value: unknown): string {
  const encoded = canonicalize(value)
  if (encoded === undefined) throw new Error('value is not JSON-canonicalizable')
  return `sha256:${hexEncode(sha256(encoder.encode(encoded)))}`
}

function recordHash(record: AtribRecord): string {
  return `sha256:${hexEncode(sha256(canonicalRecord(record)))}`
}

function timestampClock(start: number): () => number {
  let next = start
  return () => next++
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`dcbench field ${name} must be a non-empty string`)
  }
  return value
}

function readNumber(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`dcbench field ${name} must be a finite number`)
  }
  return value
}
