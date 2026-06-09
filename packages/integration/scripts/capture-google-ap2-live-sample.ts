#!/usr/bin/env node
/* eslint-disable no-console */
import { parseArgs } from 'node:util'
import { captureGoogleAp2LiveSample } from '../src/google-ap2-live-capture.js'

const args = process.argv.slice(2)
if (args[0] === '--') args.shift()

const { values } = parseArgs({
  args,
  options: {
    'agent-url': { type: 'string' },
    'trigger-url': { type: 'string' },
    'out-dir': { type: 'string' },
    'artifact-out-dir': { type: 'string' },
    'temp-db-dir': { type: 'string' },
    'context-id': { type: 'string' },
    'session-id': { type: 'string' },
    'first-prompt': { type: 'string' },
    'approval-text': { type: 'string' },
    'fallback-approval-text': { type: 'string' },
    budget: { type: 'string' },
    'trigger-price': { type: 'string' },
    'message-timeout-ms': { type: 'string' },
  },
})

const outDir = values['out-dir']
if (!outDir) throw new Error('--out-dir is required')

const budget = parseOptionalNumber(values.budget, '--budget')
const triggerPrice = parseOptionalNumber(values['trigger-price'], '--trigger-price')
const messageTimeoutMs = parseOptionalNumber(values['message-timeout-ms'], '--message-timeout-ms')

const result = await captureGoogleAp2LiveSample({
  outDir,
  ...(values['agent-url'] ? { agentUrl: values['agent-url'] } : {}),
  ...(values['trigger-url'] ? { triggerUrl: values['trigger-url'] } : {}),
  ...(values['artifact-out-dir'] ? { artifactOutDir: values['artifact-out-dir'] } : {}),
  ...(values['temp-db-dir'] ? { tempDbDir: values['temp-db-dir'] } : {}),
  ...(values['context-id'] ? { contextId: values['context-id'] } : {}),
  ...(values['session-id'] ? { sessionId: values['session-id'] } : {}),
  ...(values['first-prompt'] ? { firstPrompt: values['first-prompt'] } : {}),
  ...(values['approval-text'] ? { approvalText: values['approval-text'] } : {}),
  ...(values['fallback-approval-text']
    ? { fallbackApprovalText: values['fallback-approval-text'] }
    : {}),
  ...(budget === undefined ? {} : { budget }),
  ...(triggerPrice === undefined ? {} : { triggerPrice }),
  ...(messageTimeoutMs === undefined ? {} : { messageTimeoutMs }),
})

console.log(
  JSON.stringify(
    {
      ok: result.interop?.ok ?? true,
      session_id: result.sessionId,
      task_id: result.taskId,
      order_id: result.purchaseComplete['order_id'],
      events_json: result.files.events,
      transcript_json: result.files.transcript,
      summary_json: result.files.summary,
      artifact_files: result.artifactFiles,
      interop: result.interop
        ? {
            ok: result.interop.ok,
            errors: result.interop.errors,
            detection: result.interop.detection,
            evidence_valid: result.interop.evidence?.valid,
            transaction_accepted: result.interop.evidence?.transactionAccepted,
            cross_attestation: result.interop.recordVerification?.cross_attestation,
          }
        : undefined,
    },
    null,
    2,
  ),
)

if (result.interop && !result.interop.ok) process.exitCode = 1

function parseOptionalNumber(value: string | undefined, label: string): number | undefined {
  if (value === undefined) return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be numeric`)
  return parsed
}
