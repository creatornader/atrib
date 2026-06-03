// SPDX-License-Identifier: Apache-2.0

import { createRequire } from 'node:module'
import { Mastra } from '@mastra/core/mastra'
import { InMemoryStore } from '@mastra/core/storage'
import { createStep, createWorkflow } from '@mastra/core/workflows'
import { canonicalRecord, hexEncode, sha256, verifyRecord } from '@atrib/mcp'
import { z } from 'zod'
import { MastraRuntimeReceiptRecorder } from '../../src/mastra-runtime-receipt.js'

const require = createRequire(import.meta.url)
const contextId = '6d61737472612d776f726b666c6f7731'
const privateKey = Buffer.from(
  '2031425364758697a8b9cacbdcedfeef2031425364758697a8b9cacbdcedfeef',
  'hex',
)
const privatePhrase = 'violet Mastra workflow note stays local'
const baseTimestamp = 1_779_840_200_000

const workflowName = 'vendorApprovalWorkflow'
const runId = 'mastra-workflow-run-1'
const approvalStepId = 'approval-gate'

type SmokeResult = {
  ok: true
  note: string
  mastra: {
    core: string
    storage: 'InMemoryStore'
    workflow: 'createWorkflow/createStep'
    run: 'Run.start/Run.resume'
  }
  context_id: string
  workflow: {
    name: typeof workflowName
    run_id: typeof runId
    suspended_status: 'suspended'
    final_status: 'success'
    resume_labels: string[]
  }
  signed_records: number
  operations: string[]
  record_hashes: string[]
  causal_links: {
    suspend_informed_by_start: true
    resume_informed_by_suspend: true
    result_informed_by_resume: true
  }
  final_receipt: {
    status: 'approved'
    sku: string
    quantity: number
    approved_by: string
  }
  privacy: {
    public_records_hash_only: true
    local_sidecars_keep_payloads: true
  }
  caveats: string[]
}

export async function runMastraWorkflowSuspendResumeSmoke(): Promise<SmokeResult> {
  const recorder = new MastraRuntimeReceiptRecorder({
    privateKey,
    contextId,
    serverUrl: 'mastra://atrib-workflow-smoke',
    logSubmission: 'disabled',
    now: timestampClock(baseTimestamp),
  })
  const workflow = buildWorkflow()
  const mastra = new Mastra({
    storage: new InMemoryStore({ id: 'atrib-mastra-workflow-smoke' }),
    workflows: { [workflowName]: workflow },
    logger: false,
  })
  const registeredWorkflow = mastra.getWorkflow(workflowName)
  const run = await registeredWorkflow.createRun({ runId })
  const inputData = {
    sku: 'atlas-kit',
    quantity: 2,
    internal_note: privatePhrase,
  }

  const startHash = await recorder.workflowEvent({
    surface: 'workflow-suspend-resume',
    workflowName,
    runId,
    eventName: 'workflow-start',
    payload: {
      api: 'Run.start',
      input_data: inputData,
      storage: 'InMemoryStore',
    },
    result: { status: 'starting' },
  })

  const suspended = await run.start({
    inputData,
    outputOptions: { includeState: true, includeResumeLabels: true },
  })
  if (suspended.status !== 'suspended') {
    throw new Error(`Mastra workflow did not suspend: ${suspended.status}`)
  }

  const suspendHash = await recorder.workflowEvent({
    surface: 'workflow-suspend-resume',
    workflowName,
    runId,
    stepName: approvalStepId,
    eventName: 'step-suspended',
    payload: {
      step_result: summarizeStepResult(suspended.steps?.[approvalStepId]),
      resume_labels: summarizeResumeLabels(suspended.resumeLabels),
      suspended_steps: suspended.suspended,
    },
    result: { status: suspended.status },
    informedBy: informedBy(startHash),
  })

  const resumeData = {
    approved_by: 'nora',
    approval_reason: privatePhrase,
  }
  const resumeHash = await recorder.workflowEvent({
    surface: 'workflow-suspend-resume',
    workflowName,
    runId,
    stepName: approvalStepId,
    eventName: 'workflow-resume',
    payload: {
      api: 'Run.resume',
      step: approvalStepId,
      resume_data: resumeData,
    },
    result: { status: 'resuming' },
    informedBy: informedBy(suspendHash),
  })

  const resumed = await run.resume({
    step: approvalStepId,
    resumeData,
    outputOptions: { includeState: true, includeResumeLabels: true },
  })
  if (resumed.status !== 'success') {
    throw new Error(`Mastra workflow did not finish after resume: ${resumed.status}`)
  }

  const resultHash = await recorder.workflowEvent({
    surface: 'workflow-suspend-resume',
    workflowName,
    runId,
    eventName: 'workflow-result',
    payload: {
      step_result: summarizeStepResult(resumed.steps?.[approvalStepId]),
      step_execution_path: resumed.stepExecutionPath,
      workflow_result: resumed.result,
    },
    result: { status: resumed.status, result: resumed.result },
    informedBy: informedBy(resumeHash),
  })

  await recorder.flushAtrib()
  const records = recorder.getSignedRecords()
  const sidecars = recorder.getSidecars()
  const invalid = []
  for (const record of records) {
    if (!(await verifyRecord(record))) invalid.push(record.tool_name)
  }
  if (invalid.length > 0) {
    throw new Error(`invalid signed record(s): ${invalid.join(', ')}`)
  }

  const publicRecordJson = JSON.stringify(records)
  if (publicRecordJson.includes(privatePhrase)) {
    throw new Error('public records leaked the private Mastra workflow payload')
  }
  if (!JSON.stringify(sidecars).includes(privatePhrase)) {
    throw new Error('local sidecars should keep inspectable Mastra workflow material')
  }

  const recordHashes = records.map(
    (record) => `sha256:${hexEncode(sha256(canonicalRecord(record)))}`,
  )
  const finalReceipt = unwrapWorkflowResult(resumed.result)

  return {
    ok: true,
    note: 'Runs a real Mastra createWorkflow/createStep flow through suspend and resume with InMemoryStore snapshots, then signs hash-only atrib workflow receipts.',
    mastra: {
      core: packageVersion('@mastra/core'),
      storage: 'InMemoryStore',
      workflow: 'createWorkflow/createStep',
      run: 'Run.start/Run.resume',
    },
    context_id: contextId,
    workflow: {
      name: workflowName,
      run_id: runId,
      suspended_status: 'suspended',
      final_status: 'success',
      resume_labels: Object.keys(suspended.resumeLabels ?? {}),
    },
    signed_records: records.length,
    operations: records.map((record) => record.tool_name ?? ''),
    record_hashes: recordHashes,
    causal_links: {
      suspend_informed_by_start: records[1]?.informed_by?.[0] === startHash,
      resume_informed_by_suspend: records[2]?.informed_by?.[0] === suspendHash,
      result_informed_by_resume: records[3]?.informed_by?.[0] === resumeHash,
    },
    final_receipt: finalReceipt,
    privacy: {
      public_records_hash_only: true,
      local_sidecars_keep_payloads: true,
    },
    caveats: [
      'This proves a local Mastra workflow suspend/resume path, not hosted Mastra Platform.',
      'It does not cover Mastra memory, tracing export, eval replay, or a full @atrib/agent Mastra adapter.',
      'It uses InMemoryStore so resume has a real persisted snapshot without external credentials.',
    ],
  }

  function informedBy(hash: string | undefined): string[] | undefined {
    return hash ? [hash] : undefined
  }

  function unwrapWorkflowResult(result: unknown): SmokeResult['final_receipt'] {
    const value = result as {
      status?: unknown
      sku?: unknown
      quantity?: unknown
      approved_by?: unknown
    }
    if (
      value.status !== 'approved' ||
      typeof value.sku !== 'string' ||
      typeof value.quantity !== 'number' ||
      typeof value.approved_by !== 'string'
    ) {
      throw new Error(`unexpected Mastra workflow result: ${JSON.stringify(result)}`)
    }
    return {
      status: 'approved',
      sku: value.sku,
      quantity: value.quantity,
      approved_by: value.approved_by,
    }
  }
}

function buildWorkflow() {
  const inputSchema = z.object({
    sku: z.string(),
    quantity: z.number(),
    internal_note: z.string(),
  })
  const proposalSchema = z.object({
    sku: z.string(),
    quantity: z.number(),
    risk: z.string(),
    internal_note: z.string(),
  })
  const resumeSchema = z.object({
    approved_by: z.string(),
    approval_reason: z.string(),
  })
  const suspendSchema = z.object({
    question: z.string(),
    sku: z.string(),
    quantity: z.number(),
    risk: z.string(),
    internal_note: z.string(),
  })
  const outputSchema = z.object({
    status: z.literal('approved'),
    sku: z.string(),
    quantity: z.number(),
    approved_by: z.string(),
    approval_reason: z.string(),
    internal_note: z.string(),
  })

  const draftProposal = createStep({
    id: 'draft-proposal',
    inputSchema,
    outputSchema: proposalSchema,
    execute: async ({ inputData }) => ({
      sku: inputData.sku,
      quantity: inputData.quantity,
      risk: 'requires-human-approval',
      internal_note: inputData.internal_note,
    }),
  })
  const approvalGate = createStep({
    id: approvalStepId,
    inputSchema: proposalSchema,
    outputSchema,
    resumeSchema,
    suspendSchema,
    execute: async ({ inputData, resumeData, suspend }) => {
      if (!resumeData) {
        return suspend(
          {
            question: 'Approve the vendor order?',
            sku: inputData.sku,
            quantity: inputData.quantity,
            risk: inputData.risk,
            internal_note: inputData.internal_note,
          },
          { resumeLabel: 'human-approval' },
        )
      }
      return {
        status: 'approved' as const,
        sku: inputData.sku,
        quantity: inputData.quantity,
        approved_by: resumeData.approved_by,
        approval_reason: resumeData.approval_reason,
        internal_note: inputData.internal_note,
      }
    },
  })

  return createWorkflow({
    id: workflowName,
    inputSchema,
    outputSchema,
  })
    .then(draftProposal)
    .then(approvalGate)
    .commit()
}

function summarizeResumeLabels(value: unknown): Record<string, unknown> {
  const labels = value as Record<string, { stepId?: unknown; foreachIndex?: unknown }> | undefined
  if (!labels) return {}
  return Object.fromEntries(
    Object.entries(labels).map(([label, entry]) => [
      label,
      {
        step_id: entry.stepId,
        ...(entry.foreachIndex !== undefined ? { foreach_index: entry.foreachIndex } : {}),
      },
    ]),
  )
}

function summarizeStepResult(value: unknown): unknown {
  const step = value as
    | {
        status?: unknown
        output?: unknown
        suspendPayload?: unknown
        resumePayload?: unknown
        suspendOutput?: unknown
      }
    | undefined
  if (!step) return undefined
  return {
    status: step.status,
    ...(step.output !== undefined ? { output: step.output } : {}),
    ...(step.suspendPayload !== undefined ? { suspend_payload: step.suspendPayload } : {}),
    ...(step.resumePayload !== undefined ? { resume_payload: step.resumePayload } : {}),
    ...(step.suspendOutput !== undefined ? { suspend_output: step.suspendOutput } : {}),
  }
}

function packageVersion(name: '@mastra/core'): string {
  const pkg = require(`${name}/package.json`) as { version: string }
  return pkg.version
}

function timestampClock(start: number): () => number {
  let offset = 0
  return () => start + offset++
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMastraWorkflowSuspendResumeSmoke()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2))
    })
    .catch(() => {
      console.error('Mastra workflow suspend/resume smoke failed')
      process.exitCode = 1
    })
}
