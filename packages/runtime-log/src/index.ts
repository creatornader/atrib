// SPDX-License-Identifier: Apache-2.0

import canonicalize from 'canonicalize'
import { sha256 as nobleSha256 } from '@noble/hashes/sha2.js'

export const LOG_WINDOW_MANIFEST_SCHEMA =
  'https://atrib.dev/schemas/runtime-log/log-window-manifest/v0' as const

export const RUNTIME_LOG_CANONICALIZATION_V0 = {
  algorithm: 'jcs-sha256-v0',
  event_hash_rule: 'sha256(JCS(runtime event payload))',
  window_root_rule: 'sha256(JCS(ordered event refs))',
  manifest_hash_rule: 'sha256(JCS(log_window_manifest))',
  projection_root_rule: 'sha256(JCS(sorted projection refs))',
  side_effect_receipt_root_rule: 'sha256(JCS(sorted side-effect receipt refs))',
} as const satisfies RuntimeLogCanonicalization

export type Sha256Uri = `sha256:${string}`
export type RuntimeLogSourceId = string
export type RuntimeLogPosition = string | number

export interface RuntimeLogSourceRef {
  readonly id: RuntimeLogSourceId
  readonly kind?: string
  readonly version?: string
  readonly uri?: string
}

export interface RuntimeLogRuntimeRef {
  readonly name: string
  readonly version: string
  readonly environment?: string
}

export interface SessionDefinitionRef {
  readonly id: string
  readonly digest: Sha256Uri
  readonly format?: string
  readonly uri?: string
}

export interface LogWindowBounds {
  readonly start: RuntimeLogPosition
  readonly end: RuntimeLogPosition
  readonly label?: string
}

export interface RuntimeLogEventRef {
  readonly event_id: string
  readonly position: RuntimeLogPosition
  readonly event_hash: Sha256Uri
  readonly kind?: string
  readonly timestamp?: string
  readonly parent_event_hashes?: readonly Sha256Uri[]
}

export interface RuntimeLogProjectionRef {
  readonly name: string
  readonly format: string
  readonly root_hash: Sha256Uri
  readonly event_count?: number
  readonly uri?: string
}

export interface RuntimeLogForkRef {
  readonly parent_window_manifest_hash: Sha256Uri
  readonly fork_event_hash?: Sha256Uri
  readonly reason?: string
}

export interface RuntimeLogCompactionRef {
  readonly source_window_manifest_hash: Sha256Uri
  readonly compacted_event_root: Sha256Uri
  readonly summary_hash?: Sha256Uri
}

export interface RuntimeLogSideEffectReceiptRef {
  readonly protocol: string
  readonly receipt_hash: Sha256Uri
  readonly record_hash?: Sha256Uri
  readonly uri?: string
}

export interface RuntimeLogCanonicalization {
  readonly algorithm: 'jcs-sha256-v0'
  readonly event_hash_rule: string
  readonly window_root_rule: string
  readonly manifest_hash_rule: string
  readonly projection_root_rule?: string
  readonly side_effect_receipt_root_rule?: string
}

export type RuntimeLogRedactionMode = 'none' | 'hash-only' | 'redacted'

export interface RuntimeLogRedactionPolicy {
  readonly mode: RuntimeLogRedactionMode
  readonly rule?: string
  readonly fields?: readonly string[]
}

export type RuntimeLogPrivacyPosture =
  'host-owned' | 'local-mirror' | 'archive-ref' | 'public-fixture'

export interface RuntimeLogVerifierPolicy {
  readonly require_event_root?: boolean
  readonly require_session_definition?: boolean
  readonly require_projection_roots?: readonly string[]
  readonly require_receipt_protocols?: readonly string[]
  readonly require_fork_parent?: boolean
  readonly require_compaction_source?: boolean
  readonly trusted_sources?: readonly string[]
}

export interface ProjectionBundle {
  readonly projections: readonly RuntimeLogProjectionRef[]
  readonly root_hash: Sha256Uri
}

export interface ForkBundle {
  readonly fork: RuntimeLogForkRef
  readonly parent_manifest?: LogWindowManifest
}

export interface CompactionBundle {
  readonly compaction: RuntimeLogCompactionRef
  readonly source_manifest?: LogWindowManifest
  readonly compacted_events?: readonly RuntimeLogEventRef[]
}

export interface SideEffectReceiptBundle {
  readonly receipts: readonly RuntimeLogSideEffectReceiptRef[]
  readonly root_hash: Sha256Uri
}

export interface LogWindowManifest {
  readonly schema: typeof LOG_WINDOW_MANIFEST_SCHEMA
  readonly source: RuntimeLogSourceRef
  readonly runtime: RuntimeLogRuntimeRef
  readonly session: SessionDefinitionRef
  readonly window: LogWindowBounds
  readonly event_count: number
  readonly event_root: Sha256Uri
  readonly projection_root?: Sha256Uri
  readonly projections?: readonly RuntimeLogProjectionRef[]
  readonly fork?: RuntimeLogForkRef
  readonly compaction?: RuntimeLogCompactionRef
  readonly side_effect_receipts_root?: Sha256Uri
  readonly side_effect_receipts?: readonly RuntimeLogSideEffectReceiptRef[]
  readonly canonicalization: RuntimeLogCanonicalization
  readonly redaction: RuntimeLogRedactionPolicy
  readonly privacy_posture: RuntimeLogPrivacyPosture
  readonly verifier_policy: RuntimeLogVerifierPolicy
  readonly created_at?: string
}

export interface CreateLogWindowManifestInput {
  readonly source: RuntimeLogSourceRef
  readonly runtime: RuntimeLogRuntimeRef
  readonly session: SessionDefinitionRef
  readonly window: LogWindowBounds
  readonly events: readonly RuntimeLogEventRef[]
  readonly projections?: readonly RuntimeLogProjectionRef[]
  readonly fork?: RuntimeLogForkRef
  readonly compaction?: RuntimeLogCompactionRef
  readonly side_effect_receipts?: readonly RuntimeLogSideEffectReceiptRef[]
  readonly canonicalization?: RuntimeLogCanonicalization
  readonly redaction?: RuntimeLogRedactionPolicy
  readonly privacy_posture: RuntimeLogPrivacyPosture
  readonly verifier_policy: RuntimeLogVerifierPolicy
  readonly created_at?: string
}

export interface LogWindowManifestEvidence {
  readonly session_definition?: unknown
  readonly events?: readonly RuntimeLogEventRef[]
  readonly projections?: readonly RuntimeLogProjectionRef[]
  readonly fork_parent_manifest?: LogWindowManifest
  readonly compaction_source_manifest?: LogWindowManifest
  readonly compaction_events?: readonly RuntimeLogEventRef[]
  readonly side_effect_receipts?: readonly RuntimeLogSideEffectReceiptRef[]
}

export type ManifestVerificationIssueSeverity = 'error' | 'warning'

export type ManifestVerificationIssueCode =
  | 'unsupported_manifest_schema'
  | 'untrusted_source'
  | 'session_definition_missing'
  | 'session_definition_digest_mismatch'
  | 'event_refs_missing'
  | 'event_root_mismatch'
  | 'event_count_mismatch'
  | 'window_bounds_mismatch'
  | 'required_projection_missing'
  | 'projection_root_missing'
  | 'projection_root_mismatch'
  | 'fork_parent_missing'
  | 'fork_parent_mismatch'
  | 'compaction_source_missing'
  | 'compaction_source_mismatch'
  | 'compaction_events_missing'
  | 'compaction_event_root_mismatch'
  | 'required_receipt_missing'
  | 'side_effect_receipts_root_missing'
  | 'side_effect_receipts_root_mismatch'
  | 'withheld_field_present'

export interface ManifestVerificationIssue {
  readonly severity: ManifestVerificationIssueSeverity
  readonly code: ManifestVerificationIssueCode
  readonly message: string
}

export interface BindingVerificationResult {
  readonly valid: boolean
  readonly expected?: Sha256Uri
  readonly actual?: Sha256Uri
  readonly issues: readonly ManifestVerificationIssue[]
}

export interface CompactionBindingVerificationResult {
  readonly valid: boolean
  readonly checks: {
    readonly compaction_source?: boolean
    readonly compaction_event_root?: boolean
  }
  readonly issues: readonly ManifestVerificationIssue[]
}

export interface ManifestVerificationResult {
  readonly valid: boolean
  readonly manifest_hash: Sha256Uri
  readonly checks: {
    readonly schema: boolean
    readonly source?: boolean
    readonly session_definition?: boolean
    readonly event_root?: boolean
    readonly window_bounds?: boolean
    readonly projection_root?: boolean
    readonly fork_parent?: boolean
    readonly compaction_source?: boolean
    readonly compaction_event_root?: boolean
    readonly side_effect_receipts_root?: boolean
    readonly withheld_fields?: boolean
  }
  readonly issues: readonly ManifestVerificationIssue[]
  readonly errors: readonly string[]
  readonly warnings: readonly string[]
}

export interface RuntimeLogSignedRecordRef {
  readonly record_hash: Sha256Uri
  readonly uri?: string
  readonly privacy_posture?: 'public-log' | 'local-mirror' | 'archive-ref'
}

export interface RuntimeLogInspectionLink {
  readonly label: string
  readonly uri: string
  readonly kind:
    | 'source-runtime-log'
    | 'session-definition'
    | 'projection'
    | 'side-effect-receipt'
    | 'signed-record'
  readonly privacy_posture:
    RuntimeLogPrivacyPosture | 'public-log' | 'public-archive' | 'caller-supplied'
}

export interface RuntimeLogInspection {
  readonly schema: 'https://atrib.dev/schemas/runtime-log/inspection/v0'
  readonly title: string
  readonly manifest_hash: Sha256Uri
  readonly claim: {
    readonly valid: boolean
    readonly issue_codes: readonly ManifestVerificationIssueCode[]
    readonly summary: string
  }
  readonly source_identity: {
    readonly source: RuntimeLogSourceRef
    readonly runtime: RuntimeLogRuntimeRef
    readonly privacy_posture: RuntimeLogPrivacyPosture
  }
  readonly window: {
    readonly session_id: string
    readonly session_definition_hash: Sha256Uri
    readonly bounds: LogWindowBounds
    readonly event_count: number
    readonly event_root: Sha256Uri
  }
  readonly roots: {
    readonly projection_root: Sha256Uri | null
    readonly side_effect_receipts_root: Sha256Uri | null
  }
  readonly bindings: {
    readonly fork_parent_manifest_hash: Sha256Uri | null
    readonly fork_event_hash: Sha256Uri | null
    readonly compaction_source_manifest_hash: Sha256Uri | null
    readonly compaction_event_root: Sha256Uri | null
  }
  readonly redaction: {
    readonly mode: RuntimeLogRedactionMode
    readonly fields: readonly string[]
    readonly raw_runtime_bodies_shown: false
    readonly posture: string
  }
  readonly evidence_supplied: {
    readonly session_definition: boolean
    readonly event_refs: number
    readonly projections: number
    readonly side_effect_receipts: number
    readonly fork_parent_manifest: boolean
    readonly compaction_source_manifest: boolean
    readonly compaction_events: number
  }
  readonly signed_record: RuntimeLogSignedRecordRef | null
  readonly verifier_result: ManifestVerificationResult
  readonly links: readonly RuntimeLogInspectionLink[]
}

export interface BuildRuntimeLogInspectionInput {
  readonly manifest: LogWindowManifest
  readonly evidence?: LogWindowManifestEvidence
  readonly title?: string
  readonly signed_record?: RuntimeLogSignedRecordRef
}

type ManifestCheckAccumulator = {
  schema: boolean
  source?: boolean
  session_definition?: boolean
  event_root?: boolean
  window_bounds?: boolean
  projection_root?: boolean
  fork_parent?: boolean
  compaction_source?: boolean
  compaction_event_root?: boolean
  side_effect_receipts_root?: boolean
  withheld_fields?: boolean
}

type CompactionBindingCheckAccumulator = {
  compaction_source?: boolean
  compaction_event_root?: boolean
}

export interface LogWindowBundle {
  readonly manifest: LogWindowManifest
  readonly events?: readonly RuntimeLogEventRef[]
  readonly projections?: readonly RuntimeLogProjectionRef[]
  readonly side_effect_receipts?: readonly RuntimeLogSideEffectReceiptRef[]
}

export interface LogWindowRequest {
  readonly session_id: string
  readonly start: RuntimeLogPosition
  readonly end: RuntimeLogPosition
}

export interface RuntimeLogSource {
  readonly source: RuntimeLogSourceRef
  exportWindow(request: LogWindowRequest): LogWindowBundle | Promise<LogWindowBundle>
}

export function createLogWindowManifest(input: CreateLogWindowManifestInput): LogWindowManifest {
  const projections = normalizeProjectionRefs(input.projections ?? [])
  const receipts = normalizeSideEffectReceiptRefs(input.side_effect_receipts ?? [])

  return {
    schema: LOG_WINDOW_MANIFEST_SCHEMA,
    source: input.source,
    runtime: input.runtime,
    session: input.session,
    window: input.window,
    event_count: input.events.length,
    event_root: hashLogWindow(input.events),
    ...(projections.length > 0
      ? {
          projection_root: hashProjectionBundle(projections),
          projections,
        }
      : {}),
    ...(input.fork ? { fork: input.fork } : {}),
    ...(input.compaction ? { compaction: input.compaction } : {}),
    ...(receipts.length > 0
      ? {
          side_effect_receipts_root: hashSideEffectReceipts(receipts),
          side_effect_receipts: receipts,
        }
      : {}),
    canonicalization: input.canonicalization ?? RUNTIME_LOG_CANONICALIZATION_V0,
    redaction: input.redaction ?? { mode: 'hash-only' },
    privacy_posture: input.privacy_posture,
    verifier_policy: input.verifier_policy,
    ...(input.created_at ? { created_at: input.created_at } : {}),
  }
}

export function verifyLogWindowManifest(
  manifest: LogWindowManifest,
  evidence: LogWindowManifestEvidence = {},
): ManifestVerificationResult {
  const issues: ManifestVerificationIssue[] = []
  const checks: ManifestCheckAccumulator = {
    schema: manifest.schema === LOG_WINDOW_MANIFEST_SCHEMA,
  }

  if (!checks.schema) {
    addIssue(
      issues,
      'error',
      'unsupported_manifest_schema',
      `unsupported manifest schema: ${manifest.schema}`,
    )
  }

  if (manifest.verifier_policy.trusted_sources) {
    checks.source = manifest.verifier_policy.trusted_sources.includes(manifest.source.id)
    if (!checks.source) {
      addIssue(
        issues,
        'error',
        'untrusted_source',
        `source ${manifest.source.id} is not in verifier_policy.trusted_sources`,
      )
    }
  }

  if (evidence.session_definition !== undefined) {
    const sessionDigest = hashSessionDefinition(evidence.session_definition)
    checks.session_definition = sessionDigest === manifest.session.digest
    if (!checks.session_definition) {
      addIssue(
        issues,
        'error',
        'session_definition_digest_mismatch',
        `session_definition digest mismatch: expected ${manifest.session.digest}, got ${sessionDigest}`,
      )
    }
  } else if (manifest.verifier_policy.require_session_definition) {
    addIssue(
      issues,
      'error',
      'session_definition_missing',
      'session_definition evidence was not supplied',
    )
  }

  if (evidence.events) {
    const eventRoot = hashLogWindow(evidence.events)
    checks.event_root = eventRoot === manifest.event_root
    if (!checks.event_root) {
      addIssue(
        issues,
        'error',
        'event_root_mismatch',
        `event_root mismatch: expected ${manifest.event_root}, got ${eventRoot}`,
      )
    }
    if (manifest.event_count !== evidence.events.length) {
      addIssue(
        issues,
        'error',
        'event_count_mismatch',
        `event_count mismatch: expected ${manifest.event_count}, got ${evidence.events.length}`,
      )
    }
    const firstEvent = evidence.events[0]
    const lastEvent = evidence.events[evidence.events.length - 1]
    if (firstEvent && lastEvent) {
      checks.window_bounds =
        positionsEqual(firstEvent.position, manifest.window.start) &&
        positionsEqual(lastEvent.position, manifest.window.end)
      if (!checks.window_bounds) {
        addIssue(
          issues,
          'error',
          'window_bounds_mismatch',
          `window bounds mismatch: expected ${formatPosition(manifest.window.start)}..${formatPosition(
            manifest.window.end,
          )}, got ${formatPosition(firstEvent.position)}..${formatPosition(lastEvent.position)}`,
        )
      }
    }
  } else if (manifest.verifier_policy.require_event_root) {
    addIssue(issues, 'error', 'event_refs_missing', 'event refs were not supplied')
  }

  const withheldFieldNames = manifest.redaction.fields ?? []
  if (withheldFieldNames.length > 0) {
    const withheldFieldPaths = findWithheldFieldPaths(manifest, new Set(withheldFieldNames))
    checks.withheld_fields = withheldFieldPaths.length === 0
    if (!checks.withheld_fields) {
      addIssue(
        issues,
        'error',
        'withheld_field_present',
        `manifest embeds fields declared as withheld: ${withheldFieldPaths.join(', ')}`,
      )
    }
  }

  for (const requiredProjection of manifest.verifier_policy.require_projection_roots ?? []) {
    if (!manifest.projections?.some((projection) => projection.name === requiredProjection)) {
      addIssue(
        issues,
        'error',
        'required_projection_missing',
        `required projection is missing from manifest: ${requiredProjection}`,
      )
    }
  }

  if (evidence.projections) {
    const result = verifyProjectionBinding(manifest, evidence.projections)
    checks.projection_root = result.valid
    issues.push(...result.issues)
  }

  if (manifest.fork || manifest.verifier_policy.require_fork_parent) {
    const result = verifyForkBinding(manifest, evidence.fork_parent_manifest)
    checks.fork_parent = result.valid
    issues.push(...result.issues)
  }

  if (manifest.compaction || manifest.verifier_policy.require_compaction_source) {
    const result = verifyCompactionBinding(manifest, {
      ...(evidence.compaction_source_manifest
        ? { source_manifest: evidence.compaction_source_manifest }
        : {}),
      ...(evidence.compaction_events ? { compacted_events: evidence.compaction_events } : {}),
    })
    if (result.checks.compaction_source !== undefined) {
      checks.compaction_source = result.checks.compaction_source
    }
    if (result.checks.compaction_event_root !== undefined) {
      checks.compaction_event_root = result.checks.compaction_event_root
    }
    issues.push(...result.issues)
  }

  for (const requiredProtocol of manifest.verifier_policy.require_receipt_protocols ?? []) {
    if (!manifest.side_effect_receipts?.some((receipt) => receipt.protocol === requiredProtocol)) {
      addIssue(
        issues,
        'error',
        'required_receipt_missing',
        `required side-effect receipt protocol is missing from manifest: ${requiredProtocol}`,
      )
    }
  }

  if (evidence.side_effect_receipts) {
    const result = verifySideEffectReceiptBinding(manifest, evidence.side_effect_receipts)
    checks.side_effect_receipts_root = result.valid
    issues.push(...result.issues)
  }
  const errors = issues.filter((issue) => issue.severity === 'error').map((issue) => issue.message)
  const warnings = issues
    .filter((issue) => issue.severity === 'warning')
    .map((issue) => issue.message)

  return {
    valid: errors.length === 0,
    manifest_hash: hashLogWindowManifest(manifest),
    checks,
    issues,
    errors,
    warnings,
  }
}

export function verifyProjectionBinding(
  manifest: LogWindowManifest,
  projections: readonly RuntimeLogProjectionRef[],
): BindingVerificationResult {
  const actual = hashProjectionBundle(projections)
  const expected = manifest.projection_root
  if (!expected) {
    return {
      valid: false,
      actual,
      issues: [
        issue(
          'error',
          'projection_root_missing',
          'manifest does not declare projection_root for supplied projections',
        ),
      ],
    }
  }
  if (actual !== expected) {
    return {
      valid: false,
      expected,
      actual,
      issues: [
        issue(
          'error',
          'projection_root_mismatch',
          `projection_root mismatch: expected ${expected}, got ${actual}`,
        ),
      ],
    }
  }
  return { valid: true, expected, actual, issues: [] }
}

export function verifyForkBinding(
  manifest: LogWindowManifest,
  parentManifest?: LogWindowManifest,
): BindingVerificationResult {
  if (!manifest.fork) {
    return {
      valid: false,
      issues: [issue('error', 'fork_parent_missing', 'manifest does not declare a fork binding')],
    }
  }
  if (!parentManifest) {
    return {
      valid: false,
      expected: manifest.fork.parent_window_manifest_hash,
      issues: [
        issue('error', 'fork_parent_missing', 'fork parent manifest evidence was not supplied'),
      ],
    }
  }
  const actual = hashLogWindowManifest(parentManifest)
  const expected = manifest.fork.parent_window_manifest_hash
  if (actual !== expected) {
    return {
      valid: false,
      expected,
      actual,
      issues: [
        issue(
          'error',
          'fork_parent_mismatch',
          `fork parent mismatch: expected ${expected}, got ${actual}`,
        ),
      ],
    }
  }
  return { valid: true, expected, actual, issues: [] }
}

export function verifyCompactionBinding(
  manifest: LogWindowManifest,
  evidence: {
    readonly source_manifest?: LogWindowManifest
    readonly compacted_events?: readonly RuntimeLogEventRef[]
  } = {},
): CompactionBindingVerificationResult {
  const issues: ManifestVerificationIssue[] = []
  const checks: CompactionBindingCheckAccumulator = {}

  if (!manifest.compaction) {
    addIssue(
      issues,
      'error',
      'compaction_source_missing',
      'manifest does not declare a compaction binding',
    )
    return { valid: false, checks, issues }
  }

  if (!evidence.source_manifest) {
    addIssue(
      issues,
      'error',
      'compaction_source_missing',
      'compaction source manifest evidence was not supplied',
    )
  } else {
    const actual = hashLogWindowManifest(evidence.source_manifest)
    const expected = manifest.compaction.source_window_manifest_hash
    checks.compaction_source = actual === expected
    if (!checks.compaction_source) {
      addIssue(
        issues,
        'error',
        'compaction_source_mismatch',
        `compaction source mismatch: expected ${expected}, got ${actual}`,
      )
    }
  }

  if (!evidence.compacted_events) {
    addIssue(
      issues,
      'error',
      'compaction_events_missing',
      'compaction event refs were not supplied',
    )
  } else {
    const actual = hashLogWindow(evidence.compacted_events)
    const expected = manifest.compaction.compacted_event_root
    checks.compaction_event_root = actual === expected
    if (!checks.compaction_event_root) {
      addIssue(
        issues,
        'error',
        'compaction_event_root_mismatch',
        `compaction event root mismatch: expected ${expected}, got ${actual}`,
      )
    }
  }

  return { valid: issues.every((entry) => entry.severity !== 'error'), checks, issues }
}

export function verifySideEffectReceiptBinding(
  manifest: LogWindowManifest,
  receipts: readonly RuntimeLogSideEffectReceiptRef[],
): BindingVerificationResult {
  const actual = hashSideEffectReceipts(receipts)
  const expected = manifest.side_effect_receipts_root
  if (!expected) {
    return {
      valid: false,
      actual,
      issues: [
        issue(
          'error',
          'side_effect_receipts_root_missing',
          'manifest does not declare side_effect_receipts_root for supplied receipts',
        ),
      ],
    }
  }
  if (actual !== expected) {
    return {
      valid: false,
      expected,
      actual,
      issues: [
        issue(
          'error',
          'side_effect_receipts_root_mismatch',
          `side_effect_receipts_root mismatch: expected ${expected}, got ${actual}`,
        ),
      ],
    }
  }
  return { valid: true, expected, actual, issues: [] }
}

export function buildRuntimeLogInspection(
  input: BuildRuntimeLogInspectionInput,
): RuntimeLogInspection {
  const evidence = input.evidence ?? {}
  const verifierResult = verifyLogWindowManifest(input.manifest, evidence)
  const issueCodes = verifierResult.issues.map((entry) => entry.code)

  return {
    schema: 'https://atrib.dev/schemas/runtime-log/inspection/v0',
    title: input.title ?? 'Runtime-log proof packet',
    manifest_hash: verifierResult.manifest_hash,
    claim: {
      valid: verifierResult.valid,
      issue_codes: issueCodes,
      summary: verifierResult.valid
        ? 'The supplied evidence verifies against this log_window_manifest.'
        : `Verifier found ${issueCodes.length} issue code(s).`,
    },
    source_identity: {
      source: input.manifest.source,
      runtime: input.manifest.runtime,
      privacy_posture: input.manifest.privacy_posture,
    },
    window: {
      session_id: input.manifest.session.id,
      session_definition_hash: input.manifest.session.digest,
      bounds: input.manifest.window,
      event_count: input.manifest.event_count,
      event_root: input.manifest.event_root,
    },
    roots: {
      projection_root: input.manifest.projection_root ?? null,
      side_effect_receipts_root: input.manifest.side_effect_receipts_root ?? null,
    },
    bindings: {
      fork_parent_manifest_hash: input.manifest.fork?.parent_window_manifest_hash ?? null,
      fork_event_hash: input.manifest.fork?.fork_event_hash ?? null,
      compaction_source_manifest_hash:
        input.manifest.compaction?.source_window_manifest_hash ?? null,
      compaction_event_root: input.manifest.compaction?.compacted_event_root ?? null,
    },
    redaction: {
      mode: input.manifest.redaction.mode,
      fields: input.manifest.redaction.fields ?? [],
      raw_runtime_bodies_shown: false,
      posture: redactionPostureText(input.manifest),
    },
    evidence_supplied: {
      session_definition: evidence.session_definition !== undefined,
      event_refs: evidence.events?.length ?? 0,
      projections: evidence.projections?.length ?? 0,
      side_effect_receipts: evidence.side_effect_receipts?.length ?? 0,
      fork_parent_manifest: evidence.fork_parent_manifest !== undefined,
      compaction_source_manifest: evidence.compaction_source_manifest !== undefined,
      compaction_events: evidence.compaction_events?.length ?? 0,
    },
    signed_record: input.signed_record ?? null,
    verifier_result: verifierResult,
    links: inspectionLinks(input.manifest, input.signed_record),
  }
}

export function renderRuntimeLogInspectionHtml(inspection: RuntimeLogInspection): string {
  const statusClass = inspection.claim.valid ? 'ok' : 'bad'
  const issueItems =
    inspection.verifier_result.issues.length > 0
      ? inspection.verifier_result.issues
          .map(
            (issue) =>
              `<li><code>${escapeHtml(issue.code)}</code>: ${escapeHtml(issue.message)}</li>`,
          )
          .join('')
      : '<li>No verifier issues.</li>'
  const linkRows =
    inspection.links.length > 0
      ? inspection.links
          .map(
            (link) =>
              `<tr><td>${escapeHtml(link.label)}</td><td><code>${escapeHtml(
                link.kind,
              )}</code></td><td><code>${escapeHtml(
                link.privacy_posture,
              )}</code></td><td><code>${escapeHtml(link.uri)}</code></td></tr>`,
          )
          .join('')
      : '<tr><td colspan="4">No external links supplied.</td></tr>'
  const evidenceRows = Object.entries(inspection.evidence_supplied)
    .map(
      ([key, value]) =>
        `<tr><td>${escapeHtml(key)}</td><td><code>${escapeHtml(String(value))}</code></td></tr>`,
    )
    .join('')
  const bindingRows = Object.entries(inspection.bindings)
    .map(
      ([key, value]) =>
        `<tr><td>${escapeHtml(key)}</td><td><code>${escapeHtml(value ?? 'none')}</code></td></tr>`,
    )
    .join('')

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(inspection.title)}</title>
  <style>
    :root {
      color-scheme: light;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #172026;
      background: #f5f7f8;
    }
    body {
      margin: 0;
      padding: 32px;
    }
    main {
      max-width: 1120px;
      margin: 0 auto;
    }
    h1, h2 {
      margin: 0;
      letter-spacing: 0;
    }
    h1 {
      font-size: 30px;
      line-height: 1.2;
    }
    h2 {
      margin-top: 28px;
      font-size: 18px;
    }
    p {
      line-height: 1.5;
    }
    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 0.92em;
      word-break: break-word;
    }
    .status {
      display: inline-block;
      margin: 18px 0;
      padding: 8px 12px;
      border-radius: 6px;
      font-weight: 700;
    }
    .status.ok {
      background: #d8f5e4;
      color: #0d5d35;
    }
    .status.bad {
      background: #ffe2de;
      color: #8c1d18;
    }
    section {
      margin-top: 16px;
      padding: 18px;
      border: 1px solid #d8dee4;
      border-radius: 8px;
      background: #fff;
    }
    dl {
      display: grid;
      grid-template-columns: minmax(180px, 0.32fr) 1fr;
      gap: 10px 16px;
      margin: 0;
    }
    dt {
      font-weight: 700;
      color: #42515c;
    }
    dd {
      margin: 0;
      min-width: 0;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 8px;
    }
    th, td {
      padding: 8px;
      border-bottom: 1px solid #e7ebee;
      text-align: left;
      vertical-align: top;
    }
    th {
      color: #42515c;
      font-size: 13px;
      text-transform: uppercase;
    }
    ul {
      margin: 8px 0 0;
      padding-left: 20px;
    }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(inspection.title)}</h1>
    <div class="status ${statusClass}">${inspection.claim.valid ? 'Verified' : 'Rejected'}</div>
    <p>${escapeHtml(inspection.claim.summary)}</p>
    <section>
      <h2>Claim</h2>
      <dl>
        <dt>Manifest hash</dt><dd><code>${escapeHtml(inspection.manifest_hash)}</code></dd>
        <dt>Source identity</dt><dd><code>${escapeHtml(sourceIdentityText(inspection))}</code></dd>
        <dt>Runtime</dt><dd><code>${escapeHtml(
          `${inspection.source_identity.runtime.name}@${inspection.source_identity.runtime.version}`,
        )}</code></dd>
        <dt>Privacy posture</dt><dd><code>${escapeHtml(
          inspection.source_identity.privacy_posture,
        )}</code></dd>
        <dt>Signed atrib record</dt><dd><code>${escapeHtml(
          inspection.signed_record?.record_hash ?? 'not supplied',
        )}</code></dd>
      </dl>
    </section>
    <section>
      <h2>Window</h2>
      <dl>
        <dt>Session</dt><dd><code>${escapeHtml(inspection.window.session_id)}</code></dd>
        <dt>Session definition hash</dt><dd><code>${escapeHtml(
          inspection.window.session_definition_hash,
        )}</code></dd>
        <dt>Bounds</dt><dd><code>${escapeHtml(
          `${formatPosition(inspection.window.bounds.start)}..${formatPosition(
            inspection.window.bounds.end,
          )}`,
        )}</code></dd>
        <dt>Event count</dt><dd><code>${escapeHtml(String(inspection.window.event_count))}</code></dd>
        <dt>Event root</dt><dd><code>${escapeHtml(inspection.window.event_root)}</code></dd>
        <dt>Projection root</dt><dd><code>${escapeHtml(
          inspection.roots.projection_root ?? 'none',
        )}</code></dd>
        <dt>Receipt root</dt><dd><code>${escapeHtml(
          inspection.roots.side_effect_receipts_root ?? 'none',
        )}</code></dd>
      </dl>
    </section>
    <section>
      <h2>Fork And Compaction</h2>
      <table>
        <tbody>${bindingRows}</tbody>
      </table>
    </section>
    <section>
      <h2>Redaction</h2>
      <dl>
        <dt>Mode</dt><dd><code>${escapeHtml(inspection.redaction.mode)}</code></dd>
        <dt>Withheld fields</dt><dd><code>${escapeHtml(
          inspection.redaction.fields.length > 0
            ? inspection.redaction.fields.join(', ')
            : 'none declared',
        )}</code></dd>
        <dt>Raw runtime bodies</dt><dd><code>not shown</code></dd>
        <dt>Posture</dt><dd>${escapeHtml(inspection.redaction.posture)}</dd>
      </dl>
    </section>
    <section>
      <h2>Evidence Supplied</h2>
      <table>
        <tbody>${evidenceRows}</tbody>
      </table>
    </section>
    <section>
      <h2>Verifier Issues</h2>
      <ul>${issueItems}</ul>
    </section>
    <section>
      <h2>Links</h2>
      <table>
        <thead><tr><th>Label</th><th>Kind</th><th>Privacy</th><th>URI</th></tr></thead>
        <tbody>${linkRows}</tbody>
      </table>
    </section>
  </main>
</body>
</html>
`
}

export function hashRuntimeLogEvent(event: unknown): Sha256Uri {
  return hashCanonical(event, 'runtime log event')
}

export function hashSessionDefinition(sessionDefinition: unknown): Sha256Uri {
  return hashCanonical(sessionDefinition, 'runtime log session definition')
}

export function hashLogWindow(events: readonly RuntimeLogEventRef[]): Sha256Uri {
  for (const event of events) {
    assertSha256Uri(event.event_hash, `event_hash for ${event.event_id}`)
    for (const parentHash of event.parent_event_hashes ?? []) {
      assertSha256Uri(parentHash, `parent_event_hash for ${event.event_id}`)
    }
  }

  return hashCanonical(
    {
      schema: 'https://atrib.dev/schemas/runtime-log/window-root/v0',
      events: events.map((event) => ({
        event_id: event.event_id,
        position: event.position,
        event_hash: event.event_hash,
        ...(event.kind ? { kind: event.kind } : {}),
        ...(event.timestamp ? { timestamp: event.timestamp } : {}),
        ...(event.parent_event_hashes ? { parent_event_hashes: event.parent_event_hashes } : {}),
      })),
    },
    'runtime log window',
  )
}

export function hashProjectionBundle(projections: readonly RuntimeLogProjectionRef[]): Sha256Uri {
  return hashCanonical(
    {
      schema: 'https://atrib.dev/schemas/runtime-log/projection-bundle/v0',
      projections: normalizeProjectionRefs(projections),
    },
    'runtime log projections',
  )
}

export function hashSideEffectReceipts(
  receipts: readonly RuntimeLogSideEffectReceiptRef[],
): Sha256Uri {
  return hashCanonical(
    {
      schema: 'https://atrib.dev/schemas/runtime-log/side-effect-receipts/v0',
      receipts: normalizeSideEffectReceiptRefs(receipts),
    },
    'runtime log side-effect receipts',
  )
}

export function hashLogWindowManifest(manifest: LogWindowManifest): Sha256Uri {
  return hashCanonical(manifest, 'log_window_manifest')
}

export function hashCanonical(value: unknown, label = 'value'): Sha256Uri {
  const canonical = canonicalize(value)
  if (canonical === undefined) {
    throw new Error(`${label} is not JCS-encodable`)
  }
  return `sha256:${hexEncode(nobleSha256(new TextEncoder().encode(canonical)))}`
}

export function isSha256Uri(value: string): value is Sha256Uri {
  return /^sha256:[0-9a-f]{64}$/.test(value)
}

export function assertSha256Uri(value: string, field = 'hash'): asserts value is Sha256Uri {
  if (!isSha256Uri(value)) {
    throw new Error(`${field} must be sha256:<64 lowercase hex chars>`)
  }
}

function normalizeProjectionRefs(
  projections: readonly RuntimeLogProjectionRef[],
): readonly RuntimeLogProjectionRef[] {
  for (const projection of projections) {
    assertSha256Uri(projection.root_hash, `projection root_hash for ${projection.name}`)
  }
  return [...projections].sort((a, b) => compareStrings(projectionSortKey(a), projectionSortKey(b)))
}

function normalizeSideEffectReceiptRefs(
  receipts: readonly RuntimeLogSideEffectReceiptRef[],
): readonly RuntimeLogSideEffectReceiptRef[] {
  for (const receipt of receipts) {
    assertSha256Uri(receipt.receipt_hash, `receipt_hash for ${receipt.protocol}`)
    if (receipt.record_hash)
      assertSha256Uri(receipt.record_hash, `record_hash for ${receipt.protocol}`)
  }
  return [...receipts].sort((a, b) => compareStrings(receiptSortKey(a), receiptSortKey(b)))
}

function projectionSortKey(projection: RuntimeLogProjectionRef): string {
  return `${projection.name}\u0000${projection.format}\u0000${projection.root_hash}`
}

function receiptSortKey(receipt: RuntimeLogSideEffectReceiptRef): string {
  return `${receipt.protocol}\u0000${receipt.receipt_hash}\u0000${receipt.record_hash ?? ''}`
}

function compareStrings(a: string, b: string): number {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

function positionsEqual(left: RuntimeLogPosition, right: RuntimeLogPosition): boolean {
  return left === right
}

function formatPosition(position: RuntimeLogPosition): string {
  return JSON.stringify(position)
}

function inspectionLinks(
  manifest: LogWindowManifest,
  signedRecord?: RuntimeLogSignedRecordRef,
): RuntimeLogInspectionLink[] {
  const links: RuntimeLogInspectionLink[] = []
  if (manifest.source.uri) {
    links.push({
      label: 'Source runtime log',
      uri: manifest.source.uri,
      kind: 'source-runtime-log',
      privacy_posture: manifest.privacy_posture,
    })
  }
  if (manifest.session.uri) {
    links.push({
      label: 'Session definition',
      uri: manifest.session.uri,
      kind: 'session-definition',
      privacy_posture: manifest.privacy_posture,
    })
  }
  for (const projection of manifest.projections ?? []) {
    if (!projection.uri) continue
    links.push({
      label: `Projection: ${projection.name}`,
      uri: projection.uri,
      kind: 'projection',
      privacy_posture: manifest.privacy_posture,
    })
  }
  for (const receipt of manifest.side_effect_receipts ?? []) {
    if (!receipt.uri) continue
    links.push({
      label: `Receipt: ${receipt.protocol}`,
      uri: receipt.uri,
      kind: 'side-effect-receipt',
      privacy_posture: receipt.uri.startsWith('http')
        ? 'caller-supplied'
        : manifest.privacy_posture,
    })
  }
  if (signedRecord?.uri) {
    links.push({
      label: 'Signed atrib record',
      uri: signedRecord.uri,
      kind: 'signed-record',
      privacy_posture: signedRecord.privacy_posture ?? 'public-log',
    })
  }
  return links
}

function redactionPostureText(manifest: LogWindowManifest): string {
  const fields = manifest.redaction.fields ?? []
  if (manifest.redaction.mode === 'none' && fields.length === 0) {
    return 'No manifest redaction fields are declared.'
  }
  const fieldText = fields.length > 0 ? fields.join(', ') : 'no named fields'
  return `Raw runtime bodies stay outside this proof packet; declared withheld fields: ${fieldText}.`
}

export * from './coverage.js'

function sourceIdentityText(inspection: RuntimeLogInspection): string {
  const source = inspection.source_identity.source
  const parts = [source.id]
  if (source.kind) parts.push(source.kind)
  if (source.version) parts.push(source.version)
  return parts.join(' / ')
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function findWithheldFieldPaths(
  value: unknown,
  withheldFieldNames: ReadonlySet<string>,
  path: readonly string[] = [],
): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) =>
      findWithheldFieldPaths(entry, withheldFieldNames, [...path, String(index)]),
    )
  }
  if (!value || typeof value !== 'object') {
    return []
  }

  return Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) => {
    if (path[0] === 'redaction') {
      return []
    }
    const currentPath = [...path, key]
    const self = withheldFieldNames.has(key) ? [currentPath.join('.')] : []
    return [...self, ...findWithheldFieldPaths(entry, withheldFieldNames, currentPath)]
  })
}

function addIssue(
  issues: ManifestVerificationIssue[],
  severity: ManifestVerificationIssueSeverity,
  code: ManifestVerificationIssueCode,
  message: string,
): void {
  issues.push(issue(severity, code, message))
}

function issue(
  severity: ManifestVerificationIssueSeverity,
  code: ManifestVerificationIssueCode,
  message: string,
): ManifestVerificationIssue {
  return { severity, code, message }
}

function hexEncode(bytes: Uint8Array): string {
  let out = ''
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, '0')
  }
  return out
}
