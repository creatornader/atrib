import { exec as execCallback } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { detectTransaction, type TransactionDetection } from '@atrib/agent'
import type { AtribRecord } from '@atrib/mcp'
import {
  verifyRecord,
  verifyAp2ViEvidenceAsync,
  type Ap2ViEvidenceBundle,
  type Ap2ViEvidenceVerification,
  type RecordVerificationResult,
  type VerifyAp2ViEvidenceOptions,
} from '@atrib/verify'

const exec = promisify(execCallback)

export interface Ap2LiveInteropInput {
  result: unknown
  evidence?: Ap2ViEvidenceBundle
  evidenceOptions?: VerifyAp2ViEvidenceOptions
  requireEvidence?: boolean
  transactionRecord?: AtribRecord
  requireCounterpartyAttestation?: boolean
}

export interface Ap2LiveInteropSummary {
  ok: boolean
  detection: TransactionDetection
  evidence?: Ap2ViEvidenceVerification
  recordVerification?: RecordVerificationResult
  errors: string[]
}

export interface Ap2LiveInteropEnv {
  command: string | undefined
  resultJsonPath: string | undefined
  evidenceJsonPath: string | undefined
  transactionRecordJsonPath: string | undefined
  nowSeconds: number | undefined
  allowDetectionOnly: boolean
  requireCounterpartyAttestation: boolean
}

export async function runAp2LiveInterop(
  input: Ap2LiveInteropInput,
): Promise<Ap2LiveInteropSummary> {
  const errors: string[] = []
  const detection = detectTransaction('ap2_live_interop', input.result)

  if (!detection.detected || detection.protocol !== 'AP2') {
    errors.push('ap2_transaction_not_detected')
  }

  let evidence: Ap2ViEvidenceVerification | undefined
  if (input.evidence) {
    evidence = await verifyAp2ViEvidenceAsync(input.evidence, input.evidenceOptions)
    if (!evidence.valid) errors.push('ap2_vi_evidence_invalid')
  } else if (input.requireEvidence !== false) {
    errors.push('ap2_vi_evidence_missing')
  }

  let recordVerification: RecordVerificationResult | undefined
  if (input.transactionRecord) {
    recordVerification = await verifyRecord(input.transactionRecord, {
      ...(input.evidence ? { ap2ViEvidence: input.evidence } : {}),
      ...(input.evidenceOptions ? { ap2ViEvidenceOptions: input.evidenceOptions } : {}),
    })
    if (!recordVerification.valid) errors.push('atrib_transaction_record_invalid')
    if (detection.contentId && input.transactionRecord.content_id !== detection.contentId) {
      errors.push('atrib_transaction_content_id_mismatch')
    }
    if (recordVerification.cross_attestation?.missing !== false) {
      errors.push('atrib_counterparty_attestation_missing')
    }
  } else if (input.requireCounterpartyAttestation) {
    errors.push('atrib_transaction_record_missing')
  }

  const summary: Ap2LiveInteropSummary = {
    ok: errors.length === 0,
    detection,
    errors,
  }
  if (evidence !== undefined) summary.evidence = evidence
  if (recordVerification !== undefined) summary.recordVerification = recordVerification

  return summary
}

export function envToAp2LiveInteropConfig(env: NodeJS.ProcessEnv = process.env): Ap2LiveInteropEnv {
  const nowSeconds =
    env.ATRIB_AP2_INTEROP_NOW_SECONDS === undefined
      ? undefined
      : Number(env.ATRIB_AP2_INTEROP_NOW_SECONDS)

  if (nowSeconds !== undefined && !Number.isFinite(nowSeconds)) {
    throw new Error('ATRIB_AP2_INTEROP_NOW_SECONDS must be numeric when set')
  }

  return {
    command: env.ATRIB_AP2_INTEROP_COMMAND,
    resultJsonPath: env.ATRIB_AP2_INTEROP_RESULT_JSON,
    evidenceJsonPath: env.ATRIB_AP2_INTEROP_EVIDENCE_JSON,
    transactionRecordJsonPath: env.ATRIB_AP2_INTEROP_TRANSACTION_RECORD_JSON,
    nowSeconds,
    allowDetectionOnly: env.ATRIB_AP2_INTEROP_ALLOW_DETECTION_ONLY === '1',
    requireCounterpartyAttestation: env.ATRIB_AP2_INTEROP_REQUIRE_COUNTERPARTY_ATTESTATION === '1',
  }
}

export async function runAp2LiveInteropFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): Promise<Ap2LiveInteropSummary> {
  const config = envToAp2LiveInteropConfig(env)

  if (config.command) {
    await exec(config.command, { maxBuffer: 20 * 1024 * 1024 })
  }

  if (!config.resultJsonPath) {
    throw new Error('ATRIB_AP2_INTEROP_RESULT_JSON is required')
  }
  if (!config.evidenceJsonPath && !config.allowDetectionOnly) {
    throw new Error(
      'ATRIB_AP2_INTEROP_EVIDENCE_JSON is required unless ATRIB_AP2_INTEROP_ALLOW_DETECTION_ONLY=1',
    )
  }

  const result = await readJson(config.resultJsonPath)
  const evidence =
    config.evidenceJsonPath === undefined
      ? undefined
      : ((await readJson(config.evidenceJsonPath)) as Ap2ViEvidenceBundle)
  const transactionRecord =
    config.transactionRecordJsonPath === undefined
      ? undefined
      : ((await readJson(config.transactionRecordJsonPath)) as AtribRecord)

  const input: Ap2LiveInteropInput = {
    result,
    requireEvidence: !config.allowDetectionOnly,
    requireCounterpartyAttestation: config.requireCounterpartyAttestation,
  }
  if (evidence !== undefined) input.evidence = evidence
  if (transactionRecord !== undefined) input.transactionRecord = transactionRecord
  if (config.nowSeconds !== undefined) input.evidenceOptions = { nowSeconds: config.nowSeconds }

  return runAp2LiveInterop(input)
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown
}
