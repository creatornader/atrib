import { execFile as execFileCallback } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { canonicalRecord, hexEncode, sha256, type AtribRecord } from '@atrib/mcp'
import type { Ap2ViEvidenceBundle } from '@atrib/verify'
import { generateAp2LocalParticipantArtifacts, readJsonFile } from './ap2-local-participant.js'
import { runAp2LiveInterop, type Ap2LiveInteropSummary } from './ap2-live-interop.js'

const execFile = promisify(execFileCallback)

export interface GoogleEvidencePacket {
  result: unknown
  evidence: Ap2ViEvidenceBundle
  transactionRecord: AtribRecord
  source: string
  nowSeconds: number
}

export interface GoogleEvidencePacketFiles {
  resultJson: string
  evidenceJson: string
  transactionRecordJson: string
  source?: string
  nowSeconds?: number
}

export interface RuntimeCheck {
  key: string
  ok: boolean
  detail: string
}

export interface GoogleAgentAnalyticsRow {
  timestamp: string
  event_type: string
  agent: string
  session_id: string
  invocation_id: string
  user_id: string
  trace_id: string
  span_id: string
  parent_span_id: string
  status: string
  error_message: string
  is_truncated: boolean
  atrib_record_hash: string
  atrib_parent_record_hashes: string
  protocol: string
}

export interface GoogleEvidenceGate {
  allowed: boolean
  decision: 'allow_next_action' | 'reject_next_action'
  reason: string
  packet_source: string
  content_id: string | null
  record_hash: string
  checks: RuntimeCheck[]
  verifier_errors: string[]
  analytics_row: GoogleAgentAnalyticsRow
  next_action_context: {
    protocol: 'AP2'
    atrib_content_id: string | null
    informed_by: string[]
    runtime_decision: 'allow_next_action' | 'reject_next_action'
  }
}

export interface BigQueryWriteResult {
  ok: boolean
  project_id: string
  dataset: string
  table: string
  job_id: string | null
  location: string
}

export interface BigQueryWriteOptions {
  projectId?: string
  dataset?: string
  table?: string
  location?: string
  accessToken?: string
}

export const GOOGLE_EVIDENCE_RUNTIME_SERVICE = 'atrib-google-evidence-runtime'
export const DEFAULT_RUNTIME_CONTEXT_ID = 'google-ap2-runtime-replay-20260609'
export const DEFAULT_RUNTIME_NOW_SECONDS = 1779840000

export async function buildReplayPacket(options: {
  resultJson: string
  evidenceJson: string
  contextId?: string
  nowSeconds?: number
}): Promise<GoogleEvidencePacket> {
  const nowSeconds = options.nowSeconds ?? DEFAULT_RUNTIME_NOW_SECONDS
  const outDir = await mkdtemp(join(tmpdir(), 'atrib-google-runtime-'))
  const artifacts = await generateAp2LocalParticipantArtifacts({
    result: await readJsonFile(options.resultJson),
    evidence: await readJsonFile(options.evidenceJson),
    outDir,
    nowSeconds,
    contextId: options.contextId ?? DEFAULT_RUNTIME_CONTEXT_ID,
  })
  return {
    result: artifacts.result,
    evidence: artifacts.evidence,
    transactionRecord: artifacts.transactionRecord,
    source: 'committed AP2 / VI replay fixture',
    nowSeconds,
  }
}

export async function loadPacketFromFiles(
  files: GoogleEvidencePacketFiles,
): Promise<GoogleEvidencePacket> {
  return {
    result: await readJsonFile(files.resultJson),
    evidence: (await readJsonFile(files.evidenceJson)) as Ap2ViEvidenceBundle,
    transactionRecord: (await readJsonFile(files.transactionRecordJson)) as AtribRecord,
    source: files.source ?? 'operator-provided AP2 packet',
    nowSeconds: files.nowSeconds ?? DEFAULT_RUNTIME_NOW_SECONDS,
  }
}

export async function buildGoogleEvidenceGate(
  packet: GoogleEvidencePacket,
): Promise<GoogleEvidenceGate> {
  const summary = await runAp2LiveInterop({
    result: packet.result,
    evidence: packet.evidence,
    evidenceOptions: { nowSeconds: packet.nowSeconds },
    transactionRecord: packet.transactionRecord,
    requireCounterpartyAttestation: true,
  })
  return gateFromSummary(packet, summary)
}

export function recordHashForRecord(record: AtribRecord): string {
  return `sha256:${hexEncode(sha256(canonicalRecord(record)))}`
}

export async function writeAnalyticsRowToBigQuery(
  row: GoogleAgentAnalyticsRow,
  options: BigQueryWriteOptions = {},
): Promise<BigQueryWriteResult> {
  const projectId =
    options.projectId ??
    process.env.BIGQUERY_PROJECT ??
    process.env.GOOGLE_CLOUD_PROJECT ??
    process.env.GCLOUD_PROJECT
  const dataset = options.dataset ?? process.env.BIGQUERY_DATASET ?? 'atrib_agent_analytics'
  const table = options.table ?? process.env.BIGQUERY_TABLE ?? 'events'
  const location = options.location ?? process.env.BIGQUERY_LOCATION ?? 'US'

  if (!projectId) {
    throw new Error('GOOGLE_CLOUD_PROJECT or BIGQUERY_PROJECT is required for BigQuery writes')
  }

  const accessToken = options.accessToken ?? (await getGoogleAccessToken())
  const columns = [
    'timestamp',
    'event_type',
    'agent',
    'session_id',
    'invocation_id',
    'user_id',
    'trace_id',
    'span_id',
    'parent_span_id',
    'status',
    'error_message',
    'is_truncated',
    'atrib_record_hash',
    'atrib_parent_record_hashes',
    'protocol',
  ] as const
  const query = `INSERT INTO \`${projectId}.${dataset}.${table}\` (${columns
    .map((column) => `\`${column}\``)
    .join(', ')}) VALUES (${columns.map((column) => `@${column}`).join(', ')})`
  const response = await fetch(
    `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(projectId)}/queries`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        query,
        useLegacySql: false,
        parameterMode: 'NAMED',
        location,
        timeoutMs: 10000,
        queryParameters: columns.map((column) => ({
          name: column,
          parameterType: { type: column === 'is_truncated' ? 'BOOL' : 'STRING' },
          parameterValue: {
            value:
              column === 'timestamp'
                ? row.timestamp
                : column === 'is_truncated'
                  ? String(row[column])
                  : row[column],
          },
        })),
      }),
    },
  )

  const body = (await response.json()) as BigQueryQueryResponse
  if (!response.ok || body.errors?.length) {
    const message = body.error?.message ?? body.errors?.map((error) => error.message).join('; ')
    throw new Error(message ?? `BigQuery query failed with HTTP ${response.status}`)
  }

  const jobId = body.jobReference?.jobId ?? null
  if (jobId && body.jobComplete === false) {
    await waitForBigQueryJob(projectId, jobId, location, accessToken)
  }

  return { ok: true, project_id: projectId, dataset, table, job_id: jobId, location }
}

export function merchantAdapterContract(): Record<string, unknown> {
  return {
    endpoint: 'POST /v1/verify-ap2',
    accepted_body: {
      result: 'AP2 result JSON from a merchant, payment participant, or official sample run',
      evidence: 'AP2 / Verifiable Intent evidence bundle',
      transactionRecord: 'optional atrib transaction record with counterparty signer',
      nowSeconds: 'optional verifier clock override for replay',
      writeAnalytics: 'optional boolean. Writes the gate row to BigQuery when configured.',
    },
    allow_condition:
      'The runtime allows the next action only after AP2 detection, AP2 / VI evidence verification, atrib record verification, and counterparty attestation pass.',
    output:
      'A policy decision, verifier checks, content id, atrib record hash, next action context, and BigQuery-shaped analytics row.',
  }
}

function gateFromSummary(
  packet: GoogleEvidencePacket,
  summary: Ap2LiveInteropSummary,
): GoogleEvidenceGate {
  const recordHash = recordHashForRecord(packet.transactionRecord)
  const contentId = summary.detection.contentId ?? packet.transactionRecord.content_id ?? null
  const crossAttestation = summary.recordVerification?.cross_attestation
  const checks: RuntimeCheck[] = [
    {
      key: 'ap2_transaction_detected',
      ok: summary.detection.detected && summary.detection.protocol === 'AP2',
      detail: contentId === null ? 'No AP2 content id found.' : `AP2 content id ${contentId}`,
    },
    {
      key: 'ap2_vi_evidence_verified',
      ok: summary.evidence?.valid === true,
      detail:
        summary.evidence?.valid === true
          ? 'AP2 receipt and VI evidence verified.'
          : 'AP2 / VI evidence did not verify.',
    },
    {
      key: 'atrib_transaction_record_verified',
      ok: summary.recordVerification?.valid === true,
      detail:
        summary.recordVerification?.valid === true
          ? `atrib transaction record ${recordHash}`
          : 'atrib transaction record did not verify.',
    },
    {
      key: 'counterparty_attestation_verified',
      ok: crossAttestation?.missing === false && Number(crossAttestation.signers_valid ?? 0) >= 2,
      detail:
        crossAttestation?.missing === false
          ? `${String(crossAttestation.signers_valid ?? 0)} signer attestations valid.`
          : 'Counterparty attestation missing.',
    },
  ]
  const allowed = summary.ok
  const decision = allowed ? 'allow_next_action' : 'reject_next_action'
  const reason = allowed
    ? 'Verified AP2 evidence can become executable context for the next agent action.'
    : `Next action blocked: ${summary.errors.join(', ')}`
  const analyticsRow = buildAnalyticsRow(
    packet.transactionRecord,
    recordHash,
    contentId,
    allowed,
    summary,
  )
  return {
    allowed,
    decision,
    reason,
    packet_source: packet.source,
    content_id: contentId,
    record_hash: recordHash,
    checks,
    verifier_errors: summary.errors,
    analytics_row: analyticsRow,
    next_action_context: {
      protocol: 'AP2',
      atrib_content_id: contentId,
      informed_by: [recordHash],
      runtime_decision: decision,
    },
  }
}

function buildAnalyticsRow(
  record: AtribRecord,
  recordHash: string,
  contentId: string | null,
  allowed: boolean,
  summary: Ap2LiveInteropSummary,
): GoogleAgentAnalyticsRow {
  const timestamp = new Date(record.timestamp).toISOString()
  const traceSeed = sha256Text(`trace:${recordHash}`)
  const spanSeed = sha256Text(`span:${recordHash}`)
  const parents = record.informed_by ?? []
  return {
    timestamp,
    event_type: allowed ? 'atrib.ap2.next_action_allowed' : 'atrib.ap2.next_action_rejected',
    agent: GOOGLE_EVIDENCE_RUNTIME_SERVICE,
    session_id: record.context_id,
    invocation_id: contentId ?? record.content_id,
    user_id: 'google-stack-demo-operator',
    trace_id: traceSeed.slice(0, 32),
    span_id: spanSeed.slice(0, 16),
    parent_span_id: '',
    status: allowed ? 'OK' : 'ERROR',
    error_message: summary.errors.join(','),
    is_truncated: false,
    atrib_record_hash: recordHash,
    atrib_parent_record_hashes: JSON.stringify(parents),
    protocol: 'AP2',
  }
}

async function getGoogleAccessToken(): Promise<string> {
  if (process.env.GOOGLE_OAUTH_ACCESS_TOKEN) return process.env.GOOGLE_OAUTH_ACCESS_TOKEN

  const metadataToken = await getMetadataAccessToken()
  if (metadataToken) return metadataToken

  try {
    const result = await execFile('gcloud', ['auth', 'print-access-token'], {
      timeout: 5000,
      maxBuffer: 1024 * 1024,
    })
    const token = result.stdout.trim()
    if (token) return token
  } catch {
    // The caller gets the actionable failure below.
  }

  throw new Error('Unable to get a Google access token from metadata server or gcloud')
}

async function getMetadataAccessToken(): Promise<string | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 1600)
  try {
    const response = await fetch(
      'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
      {
        headers: { 'metadata-flavor': 'Google' },
        signal: controller.signal,
      },
    )
    if (!response.ok) return null
    const body = (await response.json()) as { access_token?: string }
    return body.access_token ?? null
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

async function waitForBigQueryJob(
  projectId: string,
  jobId: string,
  location: string,
  accessToken: string,
): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await delay(500)
    const response = await fetch(
      `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(
        projectId,
      )}/queries/${encodeURIComponent(jobId)}?location=${encodeURIComponent(location)}&timeoutMs=1000`,
      { headers: { authorization: `Bearer ${accessToken}` } },
    )
    const body = (await response.json()) as BigQueryQueryResponse
    if (!response.ok || body.errors?.length) {
      const message = body.error?.message ?? body.errors?.map((error) => error.message).join('; ')
      throw new Error(message ?? `BigQuery job polling failed with HTTP ${response.status}`)
    }
    if (body.jobComplete !== false) return
  }
  throw new Error(`BigQuery job ${jobId} did not complete before the runtime timeout`)
}

function sha256Text(value: string): string {
  return hexEncode(sha256(new TextEncoder().encode(value)))
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

interface BigQueryQueryResponse {
  jobComplete?: boolean
  jobReference?: { jobId?: string }
  errors?: Array<{ message?: string }>
  error?: { message?: string }
}
