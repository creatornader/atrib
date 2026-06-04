// SPDX-License-Identifier: Apache-2.0

import {
  canonicalRecord,
  hexEncode,
  sha256,
  type AtribRecord,
  type OnRecordSidecar,
  type ProofBundle,
} from '@atrib/mcp'
import { type EvidenceVerificationBlock } from '@atrib/verify'
import {
  runMcpOAuthEvidenceHarness,
  type McpOAuthEvidenceHarnessResult,
} from './mcp-oauth-evidence-harness.js'

const DEFAULT_LOG_ENDPOINT = 'https://log.atrib.dev/v1'
const DEFAULT_ARCHIVE_ENDPOINT = 'https://archive.atrib.dev/v1'
const DEFAULT_EXPLORER_ORIGIN = 'https://explore.atrib.dev'
const FIXTURE_ACCESS_TOKEN = 'fixture-access-token'
const API_LEAVES = new Set(['entries', 'lookup', 'records', 'record', 'evidence'])

type FetchLike = typeof fetch

export interface LiveMcpOAuthArchiveOptions {
  logEndpoint?: string
  archiveEndpoint?: string
  explorerOrigin?: string
  fetchImpl?: FetchLike
  runHarness?: () => Promise<McpOAuthEvidenceHarnessResult>
}

export interface LiveMcpOAuthArchiveEvidenceSummary {
  protocol: string | null
  valid: boolean | null
  issuer: string | null
  subject: string | null
  scope: string[]
  attenuation_ok: boolean | null
  delegation_ok: boolean | null
  constraints_total: number
  constraints_failed: number
  constraints_unresolved: number
}

export interface LiveMcpOAuthArchiveReceipt {
  record_hash: string
  context_id: string
  args_hash: string
  result_hash: string
  log_index: number | null
  log_lookup_url: string
  archive_record_url: string
  archive_evidence_url: string
  explorer_action_url: string
  evidence_summary: LiveMcpOAuthArchiveEvidenceSummary
  raw_bearer_token_published: false
}

interface ArchiveEvidenceResponse {
  evidence?: EvidenceVerificationBlock[]
}

function recordHash(record: AtribRecord): string {
  return `sha256:${hexEncode(sha256(canonicalRecord(record)))}`
}

function hashHex(hash: string): string {
  return hash.startsWith('sha256:') ? hash.slice('sha256:'.length) : hash
}

function endpoint(base: string, leaf: string, suffix?: string): string {
  const url = new URL(base)
  const parts = url.pathname.split('/').filter(Boolean)
  if (API_LEAVES.has(parts.at(-1) ?? '')) parts.pop()
  if (parts.at(-1) !== 'v1') parts.push('v1')
  parts.push(leaf)
  if (suffix) parts.push(suffix)
  url.pathname = `/${parts.join('/')}`
  url.search = ''
  url.hash = ''
  return url.toString()
}

function explorerActionUrl(origin: string, hash: string): string {
  const url = new URL(origin)
  url.pathname = `/action/${hash}`
  url.search = ''
  url.hash = ''
  return url.toString()
}

async function readJson<T>(res: Response, label: string): Promise<T> {
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`${label} failed with HTTP ${res.status}: ${text.slice(0, 500)}`)
  }
  return JSON.parse(text) as T
}

async function submitRecord(
  fetchImpl: FetchLike,
  logEndpoint: string,
  record: AtribRecord,
): Promise<ProofBundle> {
  const res = await fetchImpl(endpoint(logEndpoint, 'entries'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(record),
  })
  return readJson<ProofBundle>(res, 'log submission')
}

async function submitArchive(
  fetchImpl: FetchLike,
  archiveEndpoint: string,
  record: AtribRecord,
  proof: ProofBundle,
  sidecar: OnRecordSidecar,
): Promise<void> {
  const res = await fetchImpl(endpoint(archiveEndpoint, 'records'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      record,
      proof,
      _local: sidecar,
    }),
  })
  await readJson<unknown>(res, 'archive submission')
}

function summarizeEvidence(
  evidence: EvidenceVerificationBlock[] | undefined,
): LiveMcpOAuthArchiveEvidenceSummary {
  const block = evidence?.find((entry) => entry.protocol === 'mcp_oauth') ?? evidence?.[0]
  const constraints = block?.constraints ?? []
  return {
    protocol: block?.protocol ?? null,
    valid: block?.valid ?? null,
    issuer: block?.issuer ?? null,
    subject: block?.subject ?? null,
    scope: block?.scope ?? [],
    attenuation_ok: block?.attenuation_ok ?? null,
    delegation_ok: block?.delegation_ok ?? null,
    constraints_total: constraints.length,
    constraints_failed: constraints.filter((entry) => entry.status === 'failed').length,
    constraints_unresolved: constraints.filter((entry) => entry.status === 'unresolved').length,
  }
}

export async function createLiveMcpOAuthArchiveReceipt(
  options: LiveMcpOAuthArchiveOptions = {},
): Promise<LiveMcpOAuthArchiveReceipt> {
  const fetchImpl = options.fetchImpl ?? fetch
  const logEndpoint = options.logEndpoint ?? DEFAULT_LOG_ENDPOINT
  const archiveEndpoint = options.archiveEndpoint ?? DEFAULT_ARCHIVE_ENDPOINT
  const explorerOrigin = options.explorerOrigin ?? DEFAULT_EXPLORER_ORIGIN
  const harness = await (options.runHarness ?? runMcpOAuthEvidenceHarness)()
  if (!harness.record.args_hash) {
    throw new Error('MCP/OAuth archive receipt requires args_hash disclosure')
  }
  if (!harness.record.result_hash) {
    throw new Error('MCP/OAuth archive receipt requires result_hash disclosure')
  }
  const hash = recordHash(harness.record)
  const hex = hashHex(hash)
  const proof = await submitRecord(fetchImpl, logEndpoint, harness.record)
  await submitArchive(fetchImpl, archiveEndpoint, harness.record, proof, harness.sidecar)

  const evidenceUrl = endpoint(archiveEndpoint, 'evidence', hex)
  const archiveRecordUrl = endpoint(archiveEndpoint, 'record', hex)
  const evidenceRes = await fetchImpl(evidenceUrl)
  const evidenceText = await evidenceRes.text()
  if (!evidenceRes.ok) {
    throw new Error(
      `archive evidence retrieval failed with HTTP ${evidenceRes.status}: ${evidenceText.slice(0, 500)}`,
    )
  }
  if (evidenceText.includes(FIXTURE_ACCESS_TOKEN)) {
    throw new Error('archive evidence response exposed the raw bearer token')
  }

  const evidence = JSON.parse(evidenceText) as ArchiveEvidenceResponse
  const logIndex = typeof proof.log_index === 'number' ? proof.log_index : null

  return {
    record_hash: hash,
    context_id: harness.record.context_id,
    args_hash: harness.record.args_hash,
    result_hash: harness.record.result_hash,
    log_index: logIndex,
    log_lookup_url: endpoint(logEndpoint, 'lookup', hex),
    archive_record_url: archiveRecordUrl,
    archive_evidence_url: evidenceUrl,
    explorer_action_url: explorerActionUrl(explorerOrigin, hash),
    evidence_summary: summarizeEvidence(evidence.evidence),
    raw_bearer_token_published: false,
  }
}
