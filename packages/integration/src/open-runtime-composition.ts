// SPDX-License-Identifier: Apache-2.0

import { appendFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  base64urlEncode,
  canonicalRecord,
  computeContentId,
  createAtribClient,
  createJsonCommitment,
  createToolNameCommitment,
  genesisChainRoot,
  getPublicKey,
  hexEncode,
  sha256,
  signRecord,
  verifyJsonCommitment,
  type AtribRecord,
  type AttestResult,
} from '@atrib/sdk'
import { startDevLog, type DevLog } from '@atrib/log-dev'
import {
  buildCoverageAttestationContent,
  createCoverageManifest,
  hashCanonical,
  hashCoverageAttestationContent,
  hashCoverageManifest,
  verifyCoverageManifest,
  verifyLogWindowManifest,
  type CoverageManifest,
  type ExpectedCoverageAction,
  type Sha256Uri,
} from '@atrib/runtime-log'
import { bindCodexRolloutObservationSource } from '@atrib/runtime-log/codex-rollout'
import {
  createProtectedMcpExecutor,
  type ProtectedMcpActionContext,
  type ProtectedMcpToolCall,
} from '@atrib/action-gate'
import { verifyRecord as verifyAtribRecord } from '@atrib/verify'
import {
  OPERATING_EVENT_SCHEMA,
  projectOperatingView,
  type OperatingEnvelope,
  type OperatingEvent,
} from '@atrib/operating-graph/model'
import { commitObservationBatch } from '@atrib/operating-graph/observation-journal'
import {
  buildRuntimeObservation,
  buildRuntimeSemanticPromotion,
} from '@atrib/operating-graph/observations'
import { loadOperatingMirror } from '@atrib/operating-graph/store'
import { SessionTranscriptRuntimeLogJsonlSource } from './session-transcript-runtime-log.js'

const STRATEGY = 'open-runtime-composition-v0' as const
const SESSION_ID = '019f9b4b-1234-7123-8123-123456789abc'
const PRODUCER_CONTEXT = '81'.repeat(16)
const RECEIVER_CONTEXT = '82'.repeat(16)
const PRODUCER_KEY = new Uint8Array(32).fill(0x41)
const OBSERVER_KEY = new Uint8Array(32).fill(0x42)
const RECEIVER_KEY = new Uint8Array(32).fill(0x43)
const WORKSPACE = { id: 'workspace-open-runtime', name: 'Open runtime composition' }
const TASK = { id: 'task-open-runtime', name: 'Review attached runtime work' }
const PRODUCER = { id: 'runtime-codex', name: 'Codex', role: 'builder' }
const RECEIVER = { id: 'runtime-receiver', name: 'Independent receiver', role: 'receiver' }
const ACTION_ARGS = { task_id: TASK.id, revision: 'r1', operation: 'prepare_change' }
const ACTION_RESULT = { status: 'prepared', revision: 'r1' }

export interface OpenRuntimeCompositionOptions {
  readonly tamper_coverage_membership?: boolean
  readonly tamper_semantic_mapping?: boolean
}

export interface OpenRuntimeCompositionResult {
  readonly strategy: typeof STRATEGY
  readonly fixture_level: true
  readonly local_only: true
  readonly observation: {
    readonly batch_id: string
    readonly record_hash: Sha256Uri
    readonly authoritative_cursor_advanced: true
    readonly execution_evidence: false
  }
  readonly semantic: {
    readonly mapping_record_hash: Sha256Uri
    readonly view_receipt_hash: Sha256Uri
    readonly accepted_head: Sha256Uri | null
    readonly source_observation_bound: boolean
  }
  readonly action: {
    readonly request_record_hash: Sha256Uri
    readonly outcome_record_hash: Sha256Uri
    readonly signatures_valid: boolean
    readonly bodies_valid: boolean
    readonly pair_linked: boolean
  }
  readonly coverage: {
    readonly manifest_hash: Sha256Uri
    readonly attestation_record_hash: Sha256Uri
    readonly valid: boolean
  }
  readonly receiver: {
    readonly verdict: 'allow' | 'block'
    readonly state: 'allowed' | 'blocked' | 'escalated'
    readonly effect_count: number
    readonly decision_record_hash: Sha256Uri
    readonly outcome_record_hash: Sha256Uri
    readonly verification_valid: boolean
  }
  readonly claims_not_made: readonly [
    'live_external_session',
    'complete_capture',
    'runtime_vendor_provenance',
    'telemetry_as_execution',
    'arbitrary_result_truth',
    'deployed_saas',
  ]
}

interface MirrorEnvelope {
  readonly record: AtribRecord
  readonly _local?: {
    readonly content?: Record<string, unknown>
    readonly producer?: string
  }
}

export async function runOpenRuntimeComposition(
  options: OpenRuntimeCompositionOptions = {},
): Promise<OpenRuntimeCompositionResult> {
  const directory = await mkdtemp(join(tmpdir(), 'atrib-open-runtime-composition-'))
  const rolloutPath = join(directory, `rollout-proof-${SESSION_ID}.jsonl`)
  const journalPath = join(directory, 'codex.observation-journal.json')
  const mirrorPath = join(directory, 'semantic.jsonl')
  let devLog: DevLog | undefined
  let producerClient: ReturnType<typeof createAtribClient> | undefined
  try {
    await writeRolloutHeader(rolloutPath)
    const bound = await bindCodexRolloutObservationSource({
      path: rolloutPath,
      source_handle: 'open-runtime-composition-fixture',
      session_id: SESSION_ID,
      runtime_id: 'runtime:codex',
      runtime_version: 'fixture',
      observer_ref: 'host:runtime-observer',
      subject_ref: 'runtime:codex',
      now: () => '2026-07-25T12:00:02.000Z',
    })
    await appendRolloutEvent(rolloutPath)
    const batch = await bound.adapter.readBatch(bound.cursor)
    const observationBody = buildRuntimeObservation(batch, bound.cursor, {
      workspace: WORKSPACE,
      task: TASK,
      mapped_agent: PRODUCER,
    })
    if (JSON.stringify(observationBody).includes('private transcript body')) {
      throw new Error('portable observation body leaked transcript content')
    }
    const observationEnvelope = await signBodyEnvelope(
      { ...observationBody },
      OBSERVER_KEY,
      PRODUCER_CONTEXT,
      'runtime-observation',
    )
    const observationHash = recordHash(observationEnvelope.record)
    const journal = await commitObservationBatch({
      path: journalPath,
      operation_id: 'codex-poll-1',
      initial_cursor: bound.cursor,
      batch,
      envelope: observationEnvelope,
    })

    devLog = await startDevLog({ port: 0 })
    producerClient = createAtribClient({
      daemon: { mode: 'off' },
      key: { privateKey: PRODUCER_KEY, source: 'env' },
      anchors: [devLog.submissionEndpoint],
      allowSingleAnchor: true,
      contextId: PRODUCER_CONTEXT,
      producer: 'open-runtime-composition',
      mirrorPath,
      autochainSource: mirrorPath,
    })
    const semanticEvent: OperatingEvent = {
      schema: OPERATING_EVENT_SCHEMA,
      kind: 'accepted_state',
      workspace: WORKSPACE,
      task: TASK,
      agent: PRODUCER,
      subject: 'task-revision',
      status: 'accepted',
      source: 'explicit-host-mapping',
      value: {
        revision: 'r1',
        observation_batch_id: batch.batch_id,
        observation_journal_head: observationHash,
        observer_authorship_is_mapped_agent: false,
      },
    }
    const promotion = buildRuntimeSemanticPromotion(
      observationHash,
      options.tamper_semantic_mapping
        ? { ...semanticEvent, task: { id: 'wrong-task', name: 'Wrong task' } }
        : semanticEvent,
    )
    const mapping = await producerClient.attest({
      event_type: 'observation',
      content: { ...promotion.event },
      context_id: PRODUCER_CONTEXT,
      chain_root: observationHash,
      informed_by: [...promotion.informed_by],
      allow_unresolved_informed_by: true,
    })
    assertSigned(mapping, 'semantic mapping')
    const mappingHash = requireSha256(mapping.record_hash, 'semantic mapping')

    const operating = await loadOperatingMirror(directory)
    const producerCreatorKey = base64urlEncode(await getPublicKey(PRODUCER_KEY))
    const view = projectOperatingView(operating.operating_entries, {
      workspace_id: WORKSPACE.id,
      task_id: TASK.id,
      trusted_creator_keys: [producerCreatorKey],
      cell_limit: 10,
      head_limit: 5,
      event_limit: 10,
    })
    const acceptedHead = view.cells.find(
      (cell) => cell.kind === 'accepted_state' && cell.subject === 'task-revision',
    )?.accepted_head
    const viewReceipt = await producerClient.attest({
      event_type: 'observation',
      content: {
        schema: 'atrib.operating-view-receipt.v1',
        workspace: WORKSPACE,
        task: TASK,
        recipient: RECEIVER,
        runtime: 'independent-receiver',
        run_id: 'receiver-run-1',
        accepted_state_decision_hash: mappingHash,
        accepted_context_hash: hashCanonical(view, 'bounded operating view'),
        observation_journal_head: observationHash,
        observation_batch_id: batch.batch_id,
      },
      context_id: PRODUCER_CONTEXT,
      informed_by: [mappingHash],
    })
    assertSigned(viewReceipt, 'view receipt')
    const viewReceiptHash = requireSha256(viewReceipt.record_hash, 'view receipt')

    const action = await producerClient.action({
      name: 'producer.prepare_change',
      args: ACTION_ARGS,
      context_id: PRODUCER_CONTEXT,
      informed_by: [viewReceiptHash],
      execute: () => ACTION_RESULT,
    })
    if (!action.ok) throw action.error
    assertSigned(action.request, 'action request')
    assertSigned(action.outcome, 'action outcome')
    const requestHash = requireSha256(action.request.record_hash, 'action request')
    const outcomeHash = requireSha256(action.outcome.record_hash, 'action outcome')

    const windowSource = new SessionTranscriptRuntimeLogJsonlSource({
      path: rolloutPath,
      session_id: SESSION_ID,
      format: 'codex-rollout-jsonl/v1',
      source_version: 'fixture-v1',
    })
    const window = await windowSource.exportWindow({
      session_id: SESSION_ID,
      start: 1,
      end: 2,
    })
    const coverage = createActionCoverage(
      window.manifest,
      observationHash,
      requestHash,
      outcomeHash,
    )
    const coverageBody = buildCoverageAttestationContent(coverage.manifest)
    const coverageAttestation = await producerClient.attest({
      event_type: 'observation',
      content: { ...coverageBody },
      context_id: PRODUCER_CONTEXT,
      informed_by: [requestHash, outcomeHash],
    })
    assertSigned(coverageAttestation, 'coverage attestation')
    const coverageRecordHash = requireSha256(
      coverageAttestation.record_hash,
      'coverage attestation',
    )

    await producerClient.flushAnchors()
    const material = await loadMirror(mirrorPath)
    const verification = await verifyComposition({
      material,
      observationEnvelope,
      mappingHash,
      viewReceiptHash,
      requestHash,
      outcomeHash,
      coverageRecordHash,
      coverage,
      window,
      tamperCoverageMembership: options.tamper_coverage_membership === true,
    })
    const cursorAdvanced =
      hashCanonical(journal.authoritative_cursor) === hashCanonical(batch.proposed_cursor)
    if (!cursorAdvanced) throw new Error('authoritative observation cursor did not advance')

    const actionBinding = hashCanonical(
      {
        request_record_hash: requestHash,
        outcome_record_hash: outcomeHash,
        mapping_record_hash: mappingHash,
        view_receipt_hash: viewReceiptHash,
        observation_record_hash: observationHash,
        coverage_record_hash: coverageRecordHash,
      },
      'selected action binding',
    )
    const receiver = await runReceiverVerdict(verification.valid, actionBinding, {
      observationHash,
      mappingHash,
      viewReceiptHash,
      requestHash,
      outcomeHash,
      coverageRecordHash,
    })

    return {
      strategy: STRATEGY,
      fixture_level: true,
      local_only: true,
      observation: {
        batch_id: batch.batch_id,
        record_hash: observationHash,
        authoritative_cursor_advanced: true,
        execution_evidence: false,
      },
      semantic: {
        mapping_record_hash: mappingHash,
        view_receipt_hash: viewReceiptHash,
        accepted_head: acceptedHead ? requireSha256(acceptedHead, 'accepted state head') : null,
        source_observation_bound: verification.semanticMappingValid,
      },
      action: {
        request_record_hash: requestHash,
        outcome_record_hash: outcomeHash,
        signatures_valid: verification.actionSignaturesValid,
        bodies_valid: verification.actionBodiesValid,
        pair_linked: verification.actionPairLinked,
      },
      coverage: {
        manifest_hash: hashCoverageManifest(coverage.manifest),
        attestation_record_hash: coverageRecordHash,
        valid: verification.coverageValid,
      },
      receiver,
      claims_not_made: [
        'live_external_session',
        'complete_capture',
        'runtime_vendor_provenance',
        'telemetry_as_execution',
        'arbitrary_result_truth',
        'deployed_saas',
      ],
    }
  } finally {
    await producerClient?.close()
    await devLog?.close()
    await rm(directory, { recursive: true, force: true })
  }
}

async function writeRolloutHeader(path: string): Promise<void> {
  await writeFile(
    path,
    `${JSON.stringify({
      timestamp: '2026-07-25T12:00:00.000Z',
      type: 'session_meta',
      payload: {
        id: SESSION_ID,
        session_id: 'root-lineage-not-task-identity',
        cli_version: 'fixture',
      },
    })}\n`,
    'utf8',
  )
}

async function appendRolloutEvent(path: string): Promise<void> {
  await appendFile(
    path,
    `${JSON.stringify({
      timestamp: '2026-07-25T12:00:01.000Z',
      type: 'response_item',
      payload: {
        id: 'private-item-id',
        type: 'agent_message',
        role: 'assistant',
        content: 'private transcript body',
      },
    })}\n`,
    'utf8',
  )
}

async function signBodyEnvelope(
  content: Record<string, unknown>,
  key: Uint8Array,
  contextId: string,
  label: string,
): Promise<OperatingEnvelope> {
  const commitment = createJsonCommitment(content, 'plain-sha256')
  const record = await signRecord(
    {
      spec_version: 'atrib/1.0',
      content_id: computeContentId('mcp://open-runtime-composition', label),
      creator_key: base64urlEncode(await getPublicKey(key)),
      chain_root: genesisChainRoot(contextId),
      event_type: 'https://atrib.dev/v1/types/observation',
      context_id: contextId,
      timestamp: 1_753_444_002,
      args_hash: commitment.hash,
      signature: '',
    } as AtribRecord,
    key,
  )
  return {
    record,
    proof: null,
    _local: { content, producer: 'open-runtime-observer' },
  }
}

function createActionCoverage(
  logWindowManifest: Parameters<typeof createCoverageManifest>[0]['log_window_manifest'],
  observationHash: Sha256Uri,
  requestHash: Sha256Uri,
  outcomeHash: Sha256Uri,
): {
  readonly manifest: CoverageManifest
  readonly expectedActions: readonly ExpectedCoverageAction[]
} {
  const expectedActions: ExpectedCoverageAction[] = [
    {
      action_id: 'runtime-observation',
      surface_id: 'codex-rollout-observation',
      action_hash: observationHash,
    },
    {
      action_id: 'sdk-action-request',
      surface_id: 'sdk-action-boundary',
      action_hash: requestHash,
    },
    {
      action_id: 'sdk-action-outcome',
      surface_id: 'sdk-action-boundary',
      action_hash: outcomeHash,
    },
  ]
  return {
    manifest: createCoverageManifest({
      log_window_manifest: logWindowManifest,
      surfaces: [
        {
          id: 'codex-rollout-observation',
          boundary: 'host-selected Codex rollout JSONL observation adapter',
          owner: 'fixture host',
          required: true,
          action_kinds: ['runtime observation'],
        },
        {
          id: 'sdk-action-boundary',
          boundary: '@atrib/sdk action() around an application-owned operation',
          owner: 'producer application',
          required: true,
          action_kinds: ['request', 'outcome'],
        },
      ],
      actions: expectedActions.map((action) => ({
        ...action,
        state: 'captured' as const,
        record_hash:
          action.action_id === 'runtime-observation'
            ? observationHash
            : action.action_id === 'sdk-action-request'
              ? requestHash
              : outcomeHash,
      })),
      created_at: '2026-07-25T12:00:03.000Z',
    }),
    expectedActions,
  }
}

async function loadMirror(path: string): Promise<Map<Sha256Uri, MirrorEnvelope>> {
  const result = new Map<Sha256Uri, MirrorEnvelope>()
  for (const line of (await readFile(path, 'utf8')).split('\n')) {
    if (line.trim() === '') continue
    const envelope = JSON.parse(line) as MirrorEnvelope
    result.set(recordHash(envelope.record), envelope)
  }
  return result
}

interface CompositionVerification {
  readonly valid: boolean
  readonly semanticMappingValid: boolean
  readonly actionSignaturesValid: boolean
  readonly actionBodiesValid: boolean
  readonly actionPairLinked: boolean
  readonly coverageValid: boolean
}

async function verifyComposition(input: {
  readonly material: Map<Sha256Uri, MirrorEnvelope>
  readonly observationEnvelope: OperatingEnvelope
  readonly mappingHash: Sha256Uri
  readonly viewReceiptHash: Sha256Uri
  readonly requestHash: Sha256Uri
  readonly outcomeHash: Sha256Uri
  readonly coverageRecordHash: Sha256Uri
  readonly coverage: {
    readonly manifest: CoverageManifest
    readonly expectedActions: readonly ExpectedCoverageAction[]
  }
  readonly window: Awaited<ReturnType<SessionTranscriptRuntimeLogJsonlSource['exportWindow']>>
  readonly tamperCoverageMembership: boolean
}): Promise<CompositionVerification> {
  const mapping = requireEnvelope(input.material, input.mappingHash)
  const viewReceipt = requireEnvelope(input.material, input.viewReceiptHash)
  const request = requireEnvelope(input.material, input.requestHash)
  const outcome = requireEnvelope(input.material, input.outcomeHash)
  const coverage = requireEnvelope(input.material, input.coverageRecordHash)
  const signatures = await Promise.all(
    [input.observationEnvelope, mapping, viewReceipt, request, outcome, coverage].map((envelope) =>
      verifyAtribRecord(envelope.record),
    ),
  )
  const bodiesValid =
    [mapping, viewReceipt, coverage].every(bodyMatches) &&
    actionRequestBodyMatches(request) &&
    actionOutcomeBodyMatches(outcome)
  const actionSignaturesValid = signatures[3]!.signatureOk && signatures[4]!.signatureOk
  const actionBodiesValid = actionRequestBodyMatches(request) && actionOutcomeBodyMatches(outcome)
  const actionPairLinked =
    request.record.args_hash !== undefined &&
    request.record.args_hash === outcome.record.args_hash &&
    request.record.informed_by?.includes(input.viewReceiptHash) === true &&
    outcome.record.chain_root === input.requestHash &&
    outcome.record.informed_by?.includes(input.requestHash) === true
  const semantic = mapping._local?.content
  const semanticMappingValid =
    semantic?.['source_observation'] === recordHash(input.observationEnvelope.record) &&
    mapping.record.informed_by?.includes(recordHash(input.observationEnvelope.record)) === true &&
    isObject(semantic?.['task']) &&
    semantic.task['id'] === TASK.id
  const view = viewReceipt._local?.content
  const viewReceiptValid =
    view?.['accepted_state_decision_hash'] === input.mappingHash &&
    view?.['observation_journal_head'] === recordHash(input.observationEnvelope.record) &&
    isObject(view?.['task']) &&
    view.task['id'] === TASK.id
  const coverageArgsHash = coverage.record.args_hash
    ? requireSha256(coverage.record.args_hash, 'coverage args hash')
    : undefined
  const suppliedRecordHashes = input.tamperCoverageMembership
    ? [recordHash(input.observationEnvelope.record), input.requestHash]
    : [recordHash(input.observationEnvelope.record), input.requestHash, input.outcomeHash]
  const coverageVerification = verifyCoverageManifest(
    input.coverage.manifest,
    {
      log_window_manifest: input.window.manifest,
      expected_actions: input.coverage.expectedActions,
      record_hashes: suppliedRecordHashes,
      ...(coverageArgsHash ? { attestation_args_hash: coverageArgsHash } : {}),
    },
    {
      require_log_window_manifest: true,
      require_attestation: true,
      require_expected_action_evidence: true,
      require_record_evidence: true,
    },
  )
  const windowVerification = verifyLogWindowManifest(input.window.manifest, {
    session_definition: input.window.session_definition,
    events: input.window.events,
    projections: input.window.projections,
  })
  const coverageBodyValid =
    coverageArgsHash === hashCoverageAttestationContent(input.coverage.manifest) &&
    coverage._local?.content?.['coverage_manifest_hash'] ===
      hashCoverageManifest(input.coverage.manifest)
  const coverageValid =
    signatures[5]!.signatureOk &&
    bodyMatches(coverage) &&
    coverageBodyValid &&
    coverageVerification.valid &&
    windowVerification.valid
  return {
    valid:
      signatures.every((verification) => verification.signatureOk) &&
      bodiesValid &&
      semanticMappingValid &&
      viewReceiptValid &&
      actionSignaturesValid &&
      actionBodiesValid &&
      actionPairLinked &&
      coverageValid,
    semanticMappingValid,
    actionSignaturesValid,
    actionBodiesValid,
    actionPairLinked,
    coverageValid,
  }
}

async function runReceiverVerdict(
  allow: boolean,
  actionBinding: Sha256Uri,
  refs: {
    readonly observationHash: Sha256Uri
    readonly mappingHash: Sha256Uri
    readonly viewReceiptHash: Sha256Uri
    readonly requestHash: Sha256Uri
    readonly outcomeHash: Sha256Uri
    readonly coverageRecordHash: Sha256Uri
  },
): Promise<OpenRuntimeCompositionResult['receiver']> {
  const action: ProtectedMcpActionContext = {
    run_id: 'independent-receiver-run-1',
    action_id: 'receiver-selected-effect',
    agent_id: RECEIVER.id,
    risk: ['external_write'],
    parent_record_hashes: Object.values(refs),
    refs: {
      selected_action_binding: actionBinding,
      observation_record_hash: refs.observationHash,
      semantic_mapping_hash: refs.mappingHash,
      view_receipt_hash: refs.viewReceiptHash,
      request_record_hash: refs.requestHash,
      outcome_record_hash: refs.outcomeHash,
      coverage_record_hash: refs.coverageRecordHash,
    },
  }
  const request: ProtectedMcpToolCall = {
    name: 'receiver.apply_selected_effect',
    arguments: { task_id: TASK.id, action_binding: actionBinding },
  }
  let effectCount = 0
  let now = Date.parse('2026-07-25T12:00:04.000Z')
  const executor = createProtectedMcpExecutor({
    privateKey: RECEIVER_KEY,
    contextId: RECEIVER_CONTEXT,
    now: () => now++,
    evaluate: () => ({
      outcome: allow ? 'allow' : 'block',
      policy_id: 'open-runtime-independent-receiver',
      policy_version: '1',
      reason: allow
        ? 'the independently verified composition is internally consistent'
        : 'the supplied composition is incomplete or inconsistent',
      evidence: {
        composed_verification_valid: String(allow),
        selected_action_binding: actionBinding,
      },
    }),
    executeUpstream: () => {
      effectCount += 1
      return { applied: true }
    },
  })
  const result = await executor.authorizeAndExecute({ action, request })
  const [decision, outcome] = await Promise.all([
    verifyAtribRecord(result.decision.record),
    verifyAtribRecord(result.outcome.record),
  ])
  if (result.state === 'policy_error') {
    throw new Error('independent receiver policy evaluation failed')
  }
  return {
    verdict: allow ? 'allow' : 'block',
    state: result.state,
    effect_count: effectCount,
    decision_record_hash: result.decision.record_hash,
    outcome_record_hash: result.outcome.record_hash,
    verification_valid: result.verification.valid && decision.signatureOk && outcome.signatureOk,
  }
}

function requireEnvelope(
  material: Map<Sha256Uri, MirrorEnvelope>,
  hash: Sha256Uri,
): MirrorEnvelope {
  const envelope = material.get(hash)
  if (!envelope) throw new Error(`record ${hash} is missing from the producer mirror`)
  return envelope
}

function bodyMatches(envelope: MirrorEnvelope): boolean {
  const content = envelope._local?.content
  if (!content || !envelope.record.args_hash) return false
  return verifyJsonCommitment(content, {
    hash: envelope.record.args_hash,
    ...(envelope.record.args_salt ? { salt: envelope.record.args_salt } : {}),
  })
}

function actionRequestBodyMatches(envelope: MirrorEnvelope): boolean {
  const content = envelope._local?.content
  return (
    content?.['action_phase'] === 'request' &&
    typeof content['tool_name'] === 'string' &&
    envelope.record.tool_name === createToolNameCommitment(content['tool_name']) &&
    isObject(content['args']) &&
    commitmentMatches(content['args'], envelope.record.args_hash, envelope.record.args_salt)
  )
}

function actionOutcomeBodyMatches(envelope: MirrorEnvelope): boolean {
  const content = envelope._local?.content
  return (
    content?.['action_phase'] === 'outcome' &&
    typeof content['tool_name'] === 'string' &&
    envelope.record.tool_name === createToolNameCommitment(content['tool_name']) &&
    isObject(content['args']) &&
    commitmentMatches(content['args'], envelope.record.args_hash, envelope.record.args_salt) &&
    commitmentMatches(content['result'], envelope.record.result_hash, envelope.record.result_salt)
  )
}

function commitmentMatches(
  value: unknown,
  hash: string | undefined,
  salt: string | undefined,
): boolean {
  if (!hash) return false
  return verifyJsonCommitment(value, {
    hash,
    ...(salt ? { salt } : {}),
  })
}

function assertSigned(result: AttestResult, label: string): void {
  if (result.record_hash === null || result.via === 'none' || result.warnings.length > 0) {
    throw new Error(`${label} did not produce an undegraded signed record`)
  }
}

function recordHash(record: AtribRecord): Sha256Uri {
  return `sha256:${hexEncode(sha256(canonicalRecord(record)))}`
}

function requireSha256(value: string | null, label: string): Sha256Uri {
  if (!value || !/^sha256:[0-9a-f]{64}$/.test(value)) {
    throw new Error(`${label} is not a SHA-256 record reference`)
  }
  return value as Sha256Uri
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
