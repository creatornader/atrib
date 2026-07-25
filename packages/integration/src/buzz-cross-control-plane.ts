// SPDX-License-Identifier: Apache-2.0

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as secp from '@noble/secp256k1'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import {
  canonicalRecord,
  createAtribClient,
  hexEncode,
  sha256,
  type AtribClient,
  type AtribRecord,
} from '@atrib/sdk'
import { startDevLog, type DevLog } from '@atrib/log-dev'
import {
  buildCoverageAttestationContent,
  createCoverageManifest,
  hashCoverageAttestationContent,
  hashCoverageManifest,
  hashLogWindowManifest,
  hashRuntimeLogEvent,
  verifyCoverageManifest,
  verifyLogWindowManifest,
  type CoverageManifest,
  type CoverageVerificationResult,
  type ExpectedCoverageAction,
  type ManifestVerificationResult,
  type Sha256Uri,
} from '@atrib/runtime-log'
import {
  BuzzObserverRuntimeLogSource,
  type BuzzObserverTelemetry,
  type BuzzObserverWindowBundle,
} from '@atrib/runtime-log/buzz'
import {
  deriveNostrEventId,
  evaluateResultClaim,
  handoffClaimsFromEvidencePacket,
  verifyHandoffClaims,
  verifyRecord as verifyAtribRecord,
  type HandoffEvidencePacket,
  type HandoffVerificationResult,
  type NostrEvent,
  type ResultClaimEvaluation,
} from '@atrib/verify'
import {
  createProtectedMcpExecutor,
  type ActionGateRunResult,
  type ProtectedMcpActionContext,
  type ProtectedMcpToolCall,
} from '@atrib/action-gate'
import {
  OPERATING_EVENT_SCHEMA,
  parseOperatingEvent,
  projectOperatingView,
  type OperatingEntry,
  type OperatingEvent,
  type OperatingView,
} from '@atrib/operating-graph/model'

const FIXTURE_STRATEGY = 'buzz-cross-control-plane-fixture-v0' as const
const CAPTURE_ID = 'buzz-cross-control-plane-process'
const PRODUCER_CONTEXT_ID = '71'.repeat(16)
const RECEIVER_CONTEXT_ID = '72'.repeat(16)
const PRODUCER_PRIVATE_KEY = new Uint8Array(32).fill(0x31)
const RECEIVER_PRIVATE_KEY = new Uint8Array(32).fill(0x32)
const BUZZ_AGENT_SECRET = new Uint8Array(32).fill(0x33)
const BUZZ_OWNER_SECRET = new Uint8Array(32).fill(0x34)
const BUZZ_AGENT_PUBKEY = bytesToHex(secp.schnorr.getPublicKey(BUZZ_AGENT_SECRET))
const BUZZ_OWNER_PUBKEY = bytesToHex(secp.schnorr.getPublicKey(BUZZ_OWNER_SECRET))
const NOSTR_AUX_RAND = new Uint8Array(32).fill(0x35)
const WINDOW_START = 41
const WINDOW_END = 42
const FIXED_GATE_TIME_MS = Date.parse('2026-07-25T00:00:00.000Z')

const WORKSPACE = { id: 'workspace-buzz-fixture', name: 'Buzz fixture workspace' }
const TASK = { id: 'task-buzz-fixture', name: 'Cross-control-plane fixture task' }
const TEAM = { id: 'team-buzz-fixture', name: 'Fixture operators' }
const PRODUCER_AGENT = {
  id: 'agent-buzz-producer',
  name: 'Buzz-side producer',
  role: 'producer',
}
const RECEIVER_AGENT = {
  id: 'agent-non-buzz-receiver',
  name: 'Non-Buzz receiver',
  role: 'receiver',
}
const PRODUCER_ARGS = {
  task_id: TASK.id,
  operation: 'apply_fixture_update',
  revision: 'fixture-r1',
}
const PRODUCER_RESULT = {
  status: 'completed',
  revision: 'fixture-r1',
  changed: true,
}
const RECEIVER_REQUEST: ProtectedMcpToolCall = {
  name: 'receiver.persist_verified_summary',
  arguments: {
    workspace_id: WORKSPACE.id,
    task_id: TASK.id,
    accepted_revision: PRODUCER_RESULT.revision,
  },
}

const CLAIMS_NOT_MADE = [
  'live_buzz_acp_supervision',
  'relay_admission_or_persistence',
  'buzz_audit_inclusion',
  'complete_capture',
  'arbitrary_result_truth',
] as const

const HANDOFF_LIMITATION =
  'The handoff packet does not type-bind the Buzz runtime window, D168 coverage manifest, or paired action legs. The receiver verifies each leg separately and commits their hashes in its signed decision.'

export interface BuzzCrossControlPlaneFixtureOptions {
  /**
   * Replace the producer outcome body supplied to the receiver while
   * preserving the original signed record.
   */
  readonly tamper_result_evidence?: boolean
  /** Omit the result observer frame while requesting the original full window. */
  readonly omit_result_frame?: boolean
}

export interface BuzzCrossControlPlaneFixtureResult {
  readonly strategy: typeof FIXTURE_STRATEGY
  readonly fixture_level: true
  readonly local_only: true
  readonly claims_not_made: typeof CLAIMS_NOT_MADE
  readonly limitation: typeof HANDOFF_LIMITATION
  readonly producer: {
    readonly observer_event_count: number
    readonly observer_signatures_valid: boolean
    readonly sequence_complete: boolean
    readonly effect_count: number
    readonly request_record_hash: Sha256Uri
    readonly outcome_record_hash: Sha256Uri
    readonly accepted_state_record_hash: Sha256Uri
    readonly handoff_record_hash: Sha256Uri
  }
  readonly evidence: {
    readonly runtime_window_hash: Sha256Uri
    readonly coverage_manifest_hash: Sha256Uri
    readonly coverage_record_hash: Sha256Uri
    readonly observer_action_hash: Sha256Uri
    readonly observer_record_hash: Sha256Uri
    readonly runtime_window_verification: ManifestVerificationResult
    readonly coverage_verification: CoverageVerificationResult
    readonly result_claim: ResultClaimEvaluation
    readonly source_outcome_signature_valid: boolean
    readonly observer_record_signature_valid: boolean
    readonly observer_record_binding_valid: boolean
    readonly coverage_record_signature_valid: boolean
    readonly coverage_record_binding_valid: boolean
    readonly packet: HandoffVerificationResult
    readonly operating_bindings_valid: boolean
    readonly action_pair_linked: boolean
  }
  readonly operating_view: OperatingView
  readonly receiver: {
    readonly policy_outcome: 'allow' | 'block'
    readonly state: ActionGateRunResult<unknown>['state']
    readonly effect_count: number
    readonly decision_record_hash: Sha256Uri
    readonly outcome_record_hash: Sha256Uri
    readonly decision_signature_valid: boolean
    readonly outcome_signature_valid: boolean
    readonly gate_verification_valid: boolean
    readonly accepted_parent_hashes: readonly Sha256Uri[]
    readonly replay_rejection: string | null
  }
}

interface MirrorEnvelope {
  readonly record: AtribRecord
  readonly proof?: unknown
  readonly _local?: {
    readonly content?: Record<string, unknown>
    readonly producer?: string
  }
}

interface ProducerMaterial {
  readonly request: MirrorEnvelope
  readonly outcome: MirrorEnvelope
  readonly observer: MirrorEnvelope
  readonly coverage: MirrorEnvelope
  readonly acceptedState: MirrorEnvelope
  readonly handoff: MirrorEnvelope
}

interface EvidenceBindings {
  readonly runtime_window_hash: Sha256Uri
  readonly coverage_manifest_hash: Sha256Uri
  readonly coverage_record_hash: Sha256Uri
  readonly observer_action_hash: Sha256Uri
  readonly observer_record_hash: Sha256Uri
  readonly producer_request_hash: Sha256Uri
  readonly producer_outcome_hash: Sha256Uri
}

/**
 * Run a hermetic fixture across a Buzz-shaped observer source and a non-Buzz
 * receiver. Current Buzz exposes an in-process observer bus, so the input is a
 * host-supplied local capture rather than a live Buzz supervision endpoint.
 */
export async function runBuzzCrossControlPlaneFixture(
  options: BuzzCrossControlPlaneFixtureOptions = {},
): Promise<BuzzCrossControlPlaneFixtureResult> {
  const observer = await buildObserverWindow(options.omit_result_frame === true)
  const runtimeWindowHash = hashLogWindowManifest(observer.manifest)

  const tempDir = await mkdtemp(join(tmpdir(), 'atrib-buzz-cross-control-plane-'))
  const mirrorPath = join(tempDir, 'producer-mirror.jsonl')

  let devLog: DevLog | undefined
  let client: AtribClient | undefined
  try {
    devLog = await startDevLog({ port: 0 })
    client = createAtribClient({
      daemon: { mode: 'off' },
      key: { privateKey: PRODUCER_PRIVATE_KEY, source: 'env' },
      anchors: [devLog.submissionEndpoint],
      allowSingleAnchor: true,
      contextId: PRODUCER_CONTEXT_ID,
      producer: 'buzz-cross-control-plane-fixture',
      mirrorPath,
      autochainSource: mirrorPath,
    })

    let producerEffectCount = 0
    const producerAction = await client.action({
      name: 'producer.apply_fixture_update',
      args: PRODUCER_ARGS,
      execute: () => {
        producerEffectCount += 1
        return PRODUCER_RESULT
      },
    })
    if (!producerAction.ok) {
      throw producerAction.error
    }
    const requestHash = requireSha256(producerAction.request.record_hash, 'producer request')
    const outcomeHash = requireSha256(producerAction.outcome.record_hash, 'producer outcome')

    const observerActionHash = hashRuntimeLogEvent({
      request_event_hash: observer.events[0]!.event_hash,
      result_event_hash: observer.events[1]!.event_hash,
      method: 'session/prompt',
      task_id: TASK.id,
    })
    const observerRecordContent = observerCaptureEvent(runtimeWindowHash, observerActionHash)
    const observerRecordResult = await client.attest({
      event_type: 'observation',
      content: observerRecordContent,
      context_id: PRODUCER_CONTEXT_ID,
      chain_root: outcomeHash,
      informed_by: [outcomeHash],
    })
    const observerRecordHash = requireSha256(
      observerRecordResult.record_hash,
      'observer capture record',
    )
    const coverage = createFixtureCoverage(
      observer,
      observerActionHash,
      observerRecordHash,
      requestHash,
      outcomeHash,
    )
    const coverageHash = hashCoverageManifest(coverage.manifest)
    if (!coverage.verification.valid) {
      throw new Error('fixture D168 coverage manifest failed producer verification')
    }
    const coverageRecordContent = buildCoverageAttestationContent(coverage.manifest)
    const coverageRecordResult = await client.attest({
      event_type: 'observation',
      content: { ...coverageRecordContent },
      context_id: PRODUCER_CONTEXT_ID,
      chain_root: observerRecordHash,
      informed_by: [observerRecordHash],
    })
    const coverageRecordHash = requireSha256(
      coverageRecordResult.record_hash,
      'coverage attestation record',
    )

    const bindings: EvidenceBindings = {
      runtime_window_hash: runtimeWindowHash,
      coverage_manifest_hash: coverageHash,
      coverage_record_hash: coverageRecordHash,
      observer_action_hash: observerActionHash,
      observer_record_hash: observerRecordHash,
      producer_request_hash: requestHash,
      producer_outcome_hash: outcomeHash,
    }
    const acceptedStateContent = acceptedStateEvent(bindings)
    const acceptedStateResult = await client.attest({
      event_type: 'observation',
      content: acceptedStateContent,
      context_id: PRODUCER_CONTEXT_ID,
      chain_root: coverageRecordHash,
      informed_by: [coverageRecordHash],
    })
    const acceptedStateHash = requireSha256(
      acceptedStateResult.record_hash,
      'accepted-state operating event',
    )
    const handoffContent = handoffEvent(bindings, acceptedStateHash)
    const handoffResult = await client.attest({
      event_type: 'observation',
      content: handoffContent,
      context_id: PRODUCER_CONTEXT_ID,
      chain_root: acceptedStateHash,
      informed_by: [acceptedStateHash],
    })
    const handoffHash = requireSha256(handoffResult.record_hash, 'handoff operating event')

    await client.flushAnchors()
    const material = await loadProducerMaterial(mirrorPath, {
      requestHash,
      outcomeHash,
      observerRecordHash,
      coverageRecordHash,
      acceptedStateHash,
      handoffHash,
    })
    const suppliedResult = options.tamper_result_evidence
      ? { ...PRODUCER_RESULT, status: 'failed' }
      : PRODUCER_RESULT
    const packet = makeFixturePacket(material, {
      requestHash,
      outcomeHash,
      observerRecordHash,
      coverageRecordHash,
      acceptedStateHash,
      handoffHash,
      suppliedResult,
    })

    const producerCreatorKey = material.request.record.creator_key
    const packetVerification = await verifyHandoffClaims(handoffClaimsFromEvidencePacket(packet), {
      trusted_creator_keys: [producerCreatorKey],
      allowed_context_ids: [PRODUCER_CONTEXT_ID],
      require_body: true,
      require_body_commitment: true,
    })
    const sourceOutcomeVerification = await verifyAtribRecord(material.outcome.record)
    const observerRecordVerification = await verifyAtribRecord(material.observer.record)
    const coverageRecordVerification = await verifyAtribRecord(material.coverage.record)
    const coverageAttestationHash = requireSha256(
      material.coverage.record.args_hash ?? null,
      'coverage attestation args_hash',
    )
    const observerRecordBindingValid =
      hashCanonicalBody(material.observer._local?.content) === material.observer.record.args_hash &&
      material.observer._local?.content?.['runtime_window_hash'] === runtimeWindowHash &&
      material.observer._local?.content?.['observer_action_hash'] === observerActionHash
    const coverageRecordBindingValid =
      hashCanonicalBody(material.coverage._local?.content) === coverageAttestationHash &&
      coverageAttestationHash === hashCoverageAttestationContent(coverage.manifest)
    const resultClaim = evaluateResultClaim(material.outcome.record, {
      result: suppliedResult,
    })
    const runtimeWindowVerification = verifyLogWindowManifest(observer.manifest, {
      session_definition: observer.session_definition,
      events: observer.events,
      projections: observer.projections,
    })
    const coverageVerification = verifyCoverageManifest(
      coverage.manifest,
      {
        log_window_manifest: observer.manifest,
        attestation_args_hash: coverageAttestationHash,
        expected_actions: coverage.expectedActions,
        record_hashes: [observerRecordHash, requestHash, outcomeHash],
      },
      {
        require_log_window_manifest: true,
        require_attestation: true,
        require_expected_action_evidence: true,
        require_record_evidence: true,
      },
    )
    const actionPairLinked =
      material.outcome.record.chain_root === requestHash &&
      material.outcome.record.informed_by?.includes(requestHash) === true
    const operatingBindingsValid =
      bindingsMatch(material.acceptedState._local?.content, bindings) &&
      bindingsMatch(material.handoff._local?.content, bindings)
    const operatingView = recomputeOperatingView(packetVerification, material, producerCreatorKey)
    const viewAccepted =
      operatingView.cells.some(
        (cell) =>
          cell.kind === 'accepted_state' &&
          cell.status === 'accepted' &&
          cell.accepted_head === acceptedStateHash,
      ) && operatingView.handoffs.some((entry) => entry.record_hash === handoffHash)

    const receiverAllows =
      runtimeWindowVerification.valid &&
      observer.sequence_audit.sequence_complete &&
      observer.frames.every((frame) => frame.event_verification.valid) &&
      coverageVerification.valid &&
      packetVerification.all_accepted &&
      sourceOutcomeVerification.signatureOk &&
      observerRecordVerification.signatureOk &&
      observerRecordBindingValid &&
      coverageRecordVerification.signatureOk &&
      coverageRecordBindingValid &&
      resultClaim.body_consistent === true &&
      actionPairLinked &&
      operatingBindingsValid &&
      viewAccepted
    const acceptedParents = packetVerification.accepted_record_hashes
      .map((hash) => requireSha256(hash, 'accepted packet parent'))
      .sort()
    const receiverAction: ProtectedMcpActionContext = {
      run_id: 'buzz-cross-control-plane-fixture-run',
      action_id: 'receiver-persist-summary',
      agent_id: RECEIVER_AGENT.id,
      risk: ['external_write'],
      parent_record_hashes: acceptedParents,
      refs: {
        runtime_window_hash: runtimeWindowHash,
        coverage_manifest_hash: coverageHash,
        coverage_record_hash: coverageRecordHash,
        observer_action_hash: observerActionHash,
        observer_record_hash: observerRecordHash,
        producer_request_hash: requestHash,
        producer_outcome_hash: outcomeHash,
        accepted_state_hash: acceptedStateHash,
        handoff_hash: handoffHash,
      },
    }
    let receiverEffectCount = 0
    let nowTick = FIXED_GATE_TIME_MS
    const permitId = options.tamper_result_evidence
      ? 'buzz-cross-control-plane-hostile-permit'
      : 'buzz-cross-control-plane-permit'
    const executor = createProtectedMcpExecutor({
      privateKey: RECEIVER_PRIVATE_KEY,
      contextId: RECEIVER_CONTEXT_ID,
      now: () => nowTick++,
      createPermitId: () => permitId,
      evaluate: () => ({
        outcome: receiverAllows ? 'allow' : 'block',
        policy_id: 'buzz-cross-control-plane-receiver-policy',
        policy_version: '1',
        reason: receiverAllows
          ? 'all independently verified fixture legs are consistent'
          : 'one or more independently verified fixture legs are missing or inconsistent',
        evidence: {
          runtime_window_valid: String(runtimeWindowVerification.valid),
          coverage_valid: String(coverageVerification.valid),
          packet_all_accepted: String(packetVerification.all_accepted),
          result_body_consistent: String(resultClaim.body_consistent === true),
          operating_bindings_valid: String(operatingBindingsValid),
          operating_view_accepted: String(viewAccepted),
        },
      }),
      executeUpstream: () => {
        receiverEffectCount += 1
        return {
          persisted: true,
          accepted_state_hash: acceptedStateHash,
        }
      },
    })
    const receiverRun = await executor.authorizeAndExecute({
      action: receiverAction,
      request: RECEIVER_REQUEST,
    })
    if (!receiverRun.verification.valid) {
      const issueCodes = receiverRun.verification.issues.map((issue) => issue.code).join(', ')
      throw new Error(`receiver Action Gate records failed verification: ${issueCodes}`)
    }

    let replayRejection: string | null = null
    if (receiverRun.state === 'allowed') {
      const replay = await executor.dispatch({
        action: receiverAction,
        request: RECEIVER_REQUEST,
        permit_id: permitId,
      })
      if (replay.ok) throw new Error('protected receiver permit replay unexpectedly executed')
      replayRejection = replay.authorization.reason
    }
    const expectedEffects = receiverAllows ? 1 : 0
    if (receiverEffectCount !== expectedEffects) {
      throw new Error(
        `receiver effect count ${receiverEffectCount} did not match expected ${expectedEffects}`,
      )
    }
    const [receiverDecisionVerification, receiverOutcomeVerification] = await Promise.all([
      verifyAtribRecord(receiverRun.decision.record),
      verifyAtribRecord(receiverRun.outcome.record),
    ])

    return {
      strategy: FIXTURE_STRATEGY,
      fixture_level: true,
      local_only: true,
      claims_not_made: CLAIMS_NOT_MADE,
      limitation: HANDOFF_LIMITATION,
      producer: {
        observer_event_count: observer.frames.length,
        observer_signatures_valid: observer.frames.every((frame) => frame.event_verification.valid),
        sequence_complete: observer.sequence_audit.sequence_complete,
        effect_count: producerEffectCount,
        request_record_hash: requestHash,
        outcome_record_hash: outcomeHash,
        accepted_state_record_hash: acceptedStateHash,
        handoff_record_hash: handoffHash,
      },
      evidence: {
        runtime_window_hash: runtimeWindowHash,
        coverage_manifest_hash: coverageHash,
        coverage_record_hash: coverageRecordHash,
        observer_action_hash: observerActionHash,
        observer_record_hash: observerRecordHash,
        runtime_window_verification: runtimeWindowVerification,
        coverage_verification: coverageVerification,
        result_claim: resultClaim,
        source_outcome_signature_valid: sourceOutcomeVerification.signatureOk,
        observer_record_signature_valid: observerRecordVerification.signatureOk,
        observer_record_binding_valid: observerRecordBindingValid,
        coverage_record_signature_valid: coverageRecordVerification.signatureOk,
        coverage_record_binding_valid: coverageRecordBindingValid,
        packet: packetVerification,
        operating_bindings_valid: operatingBindingsValid,
        action_pair_linked: actionPairLinked,
      },
      operating_view: operatingView,
      receiver: {
        policy_outcome: receiverAllows ? 'allow' : 'block',
        state: receiverRun.state,
        effect_count: receiverEffectCount,
        decision_record_hash: receiverRun.decision.record_hash,
        outcome_record_hash: receiverRun.outcome.record_hash,
        decision_signature_valid: receiverDecisionVerification.signatureOk,
        outcome_signature_valid: receiverOutcomeVerification.signatureOk,
        gate_verification_valid: receiverRun.verification.valid,
        accepted_parent_hashes: acceptedParents,
        replay_rejection: replayRejection,
      },
    }
  } finally {
    await client?.close()
    await devLog?.close()
    await rm(tempDir, { recursive: true, force: true })
  }
}

async function buildObserverWindow(omitResultFrame: boolean): Promise<BuzzObserverWindowBundle> {
  const fixtures = await Promise.all(
    [WINDOW_START, WINDOW_END]
      .filter((seq) => !(omitResultFrame && seq === WINDOW_END))
      .map(observerFrame),
  )
  const telemetryByCiphertext = new Map(
    fixtures.map(({ event, telemetry }) => [event.content, telemetry]),
  )
  const source = new BuzzObserverRuntimeLogSource({
    load_events: () => fixtures.map(({ event }) => event),
    owner_pubkey: BUZZ_OWNER_PUBKEY,
    capture_id: CAPTURE_ID,
    capture_kind: 'live-subscription',
    sequence_policy: 'require-contiguous',
    source_version: 'fixture-v1',
    runtime: {
      name: 'Buzz fixture observer',
      version: 'source-pinned-fixture',
      environment: 'in-process observer capture supplied by the fixture host',
    },
    decrypt(event) {
      const telemetry = telemetryByCiphertext.get(event.content)
      if (!telemetry) throw new Error('fixture ciphertext has no host decrypt mapping')
      return telemetry
    },
  })
  return source.exportWindow({
    session_id: CAPTURE_ID,
    start: WINDOW_START,
    end: WINDOW_END,
  })
}

async function observerFrame(
  seq: number,
): Promise<{ readonly event: NostrEvent; readonly telemetry: BuzzObserverTelemetry }> {
  const request = seq === WINDOW_START
  const telemetry: BuzzObserverTelemetry = {
    seq,
    timestamp: request ? '2026-07-25T12:00:01.000Z' : '2026-07-25T12:00:02.000Z',
    kind: request ? 'acp_write' : 'acp_read',
    agentIndex: 0,
    channelId: 'fixture-channel',
    sessionId: 'fixture-acp-session',
    turnId: 'fixture-turn',
    startedAt: '2026-07-25T12:00:00.000Z',
    payload: request
      ? {
          direction: 'request',
          protocol: 'ACP',
          method: 'session/prompt',
          request: {
            tool: 'producer.apply_fixture_update',
            arguments: PRODUCER_ARGS,
          },
        }
      : {
          direction: 'result',
          protocol: 'ACP',
          method: 'session/update',
          result: PRODUCER_RESULT,
        },
  }
  const unsigned = {
    pubkey: BUZZ_AGENT_PUBKEY,
    created_at: 1_774_612_800 + seq,
    kind: 24_200,
    tags: [
      ['p', BUZZ_OWNER_PUBKEY],
      ['agent', BUZZ_AGENT_PUBKEY],
      ['frame', 'telemetry'],
    ],
    content: `fixture-ciphertext-${seq}`,
  }
  const id = deriveNostrEventId(unsigned)
  const sig = bytesToHex(
    await secp.schnorr.signAsync(hexToBytes(id), BUZZ_AGENT_SECRET, NOSTR_AUX_RAND),
  )
  return { event: { ...unsigned, id, sig }, telemetry }
}

function createFixtureCoverage(
  observer: BuzzObserverWindowBundle,
  observerActionHash: Sha256Uri,
  observerRecordHash: Sha256Uri,
  requestHash: Sha256Uri,
  outcomeHash: Sha256Uri,
): {
  readonly manifest: CoverageManifest
  readonly expectedActions: readonly ExpectedCoverageAction[]
  readonly verification: CoverageVerificationResult
} {
  const expectedActions: ExpectedCoverageAction[] = [
    {
      action_id: 'buzz-observer-acp-roundtrip',
      surface_id: 'buzz-observer-source',
      action_hash: observerActionHash,
    },
    {
      action_id: 'producer-sdk-action-request',
      surface_id: 'producer-effect-boundary',
      action_hash: requestHash,
    },
    {
      action_id: 'producer-sdk-action-outcome',
      surface_id: 'producer-effect-boundary',
      action_hash: outcomeHash,
    },
  ]
  const manifest = createCoverageManifest({
    log_window_manifest: observer.manifest,
    surfaces: [
      {
        id: 'buzz-observer-source',
        boundary: 'host-supplied in-process observer capture',
        owner: 'fixture host',
        required: true,
        action_kinds: ['ACP request/result telemetry'],
      },
      {
        id: 'producer-effect-boundary',
        boundary: '@atrib/sdk action() around the application-owned effect',
        owner: 'producer application',
        required: true,
        action_kinds: ['request', 'outcome'],
      },
    ],
    actions: [
      {
        ...expectedActions[0]!,
        state: 'captured',
        record_hash: observerRecordHash,
      },
      {
        ...expectedActions[1]!,
        state: 'captured',
        record_hash: requestHash,
      },
      {
        ...expectedActions[2]!,
        state: 'captured',
        record_hash: outcomeHash,
      },
    ],
    created_at: '2026-07-25T12:00:03.000Z',
  })
  const verification = verifyCoverageManifest(
    manifest,
    {
      log_window_manifest: observer.manifest,
      expected_actions: expectedActions,
      record_hashes: [observerRecordHash, requestHash, outcomeHash],
    },
    {
      require_log_window_manifest: true,
      require_expected_action_evidence: true,
      require_record_evidence: true,
    },
  )
  return { manifest, expectedActions, verification }
}

function observerCaptureEvent(
  runtimeWindowHash: Sha256Uri,
  observerActionHash: Sha256Uri,
): Record<string, unknown> {
  return {
    schema: 'atrib.buzz-observer-capture.v1',
    capture_id: CAPTURE_ID,
    runtime_window_hash: runtimeWindowHash,
    observer_action_hash: observerActionHash,
    source: 'host-supplied in-process observer capture',
    execution_evidence: false,
  }
}

function acceptedStateEvent(bindings: EvidenceBindings): Record<string, unknown> {
  return {
    schema: OPERATING_EVENT_SCHEMA,
    kind: 'accepted_state',
    workspace: WORKSPACE,
    task: TASK,
    team: TEAM,
    agent: PRODUCER_AGENT,
    subject: 'task-status',
    status: 'accepted',
    source: 'fixture-host-explicit-mapping',
    value: {
      state: 'completed',
      result: PRODUCER_RESULT,
      evidence: bindings,
      host_mapping: {
        basis: 'explicit-fixture-input',
        inferred_from_observer: false,
        fields: ['workspace', 'task', 'team', 'agent', 'accepted_state'],
      },
    },
  } satisfies OperatingEvent
}

function handoffEvent(
  bindings: EvidenceBindings,
  acceptedStateHash: Sha256Uri,
): Record<string, unknown> {
  return {
    schema: OPERATING_EVENT_SCHEMA,
    kind: 'handoff',
    workspace: WORKSPACE,
    task: TASK,
    team: TEAM,
    subject: 'verified-task-handoff',
    status: 'ready',
    source: 'fixture-host-explicit-mapping',
    from_agent: PRODUCER_AGENT,
    to_agent: RECEIVER_AGENT,
    value: {
      accepted_state_hash: acceptedStateHash,
      evidence: bindings,
      host_mapping: {
        basis: 'explicit-fixture-input',
        inferred_from_observer: false,
        fields: ['workspace', 'task', 'team', 'from_agent', 'to_agent', 'handoff'],
      },
    },
  } satisfies OperatingEvent
}

async function loadProducerMaterial(
  mirrorPath: string,
  hashes: {
    readonly requestHash: Sha256Uri
    readonly outcomeHash: Sha256Uri
    readonly observerRecordHash: Sha256Uri
    readonly coverageRecordHash: Sha256Uri
    readonly acceptedStateHash: Sha256Uri
    readonly handoffHash: Sha256Uri
  },
): Promise<ProducerMaterial> {
  const text = await readFile(mirrorPath, 'utf8')
  const byHash = new Map<Sha256Uri, MirrorEnvelope>()
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    const envelope = JSON.parse(line) as MirrorEnvelope
    byHash.set(recordHash(envelope.record), envelope)
  }
  const get = (hash: Sha256Uri, label: string): MirrorEnvelope => {
    const envelope = byHash.get(hash)
    if (!envelope) throw new Error(`${label} missing from fixture mirror`)
    return envelope
  }
  return {
    request: get(hashes.requestHash, 'producer request'),
    outcome: get(hashes.outcomeHash, 'producer outcome'),
    observer: get(hashes.observerRecordHash, 'observer capture'),
    coverage: get(hashes.coverageRecordHash, 'coverage attestation'),
    acceptedState: get(hashes.acceptedStateHash, 'accepted state'),
    handoff: get(hashes.handoffHash, 'handoff'),
  }
}

function makeFixturePacket(
  material: ProducerMaterial,
  input: {
    readonly requestHash: Sha256Uri
    readonly outcomeHash: Sha256Uri
    readonly observerRecordHash: Sha256Uri
    readonly coverageRecordHash: Sha256Uri
    readonly acceptedStateHash: Sha256Uri
    readonly handoffHash: Sha256Uri
    readonly suppliedResult: Record<string, unknown>
  },
): HandoffEvidencePacket {
  return {
    kind: 'buzz_cross_control_plane_fixture_packet',
    required_record_hashes: [
      input.requestHash,
      input.outcomeHash,
      input.observerRecordHash,
      input.coverageRecordHash,
      input.acceptedStateHash,
      input.handoffHash,
    ],
    records: [
      {
        record_hash: input.requestHash,
        record: material.request.record,
        args: PRODUCER_ARGS,
        _local: material.request._local ?? null,
      },
      {
        record_hash: input.outcomeHash,
        record: material.outcome.record,
        args: PRODUCER_ARGS,
        result: input.suppliedResult,
        _local: material.outcome._local ?? null,
      },
      {
        record_hash: input.observerRecordHash,
        record: material.observer.record,
        body: requireLocalContent(material.observer, 'observer capture'),
        _local: material.observer._local ?? null,
      },
      {
        record_hash: input.coverageRecordHash,
        record: material.coverage.record,
        body: requireLocalContent(material.coverage, 'coverage attestation'),
        _local: material.coverage._local ?? null,
      },
      {
        record_hash: input.acceptedStateHash,
        record: material.acceptedState.record,
        body: requireLocalContent(material.acceptedState, 'accepted state'),
        _local: material.acceptedState._local ?? null,
      },
      {
        record_hash: input.handoffHash,
        record: material.handoff.record,
        body: requireLocalContent(material.handoff, 'handoff'),
        _local: material.handoff._local ?? null,
      },
    ],
  }
}

function requireLocalContent(envelope: MirrorEnvelope, label: string): Record<string, unknown> {
  const content = envelope._local?.content
  if (!content) throw new Error(`${label} local content missing from fixture mirror`)
  return content
}

function recomputeOperatingView(
  packet: HandoffVerificationResult,
  material: ProducerMaterial,
  producerCreatorKey: string,
): OperatingView {
  const accepted = new Set(packet.accepted_record_hashes)
  const candidates = [material.acceptedState, material.handoff]
  const entries: OperatingEntry[] = []
  for (const candidate of candidates) {
    const hash = recordHash(candidate.record)
    if (!accepted.has(hash)) continue
    const event = parseOperatingEvent(candidate._local?.content)
    if (!event) throw new Error(`verified operating record ${hash} has invalid local content`)
    entries.push({
      record_hash: hash,
      record: candidate.record,
      event,
      signature_verified: true,
      proof_supplied: false,
      producer: candidate._local?.producer ?? null,
    })
  }
  return projectOperatingView(entries, {
    workspace_id: WORKSPACE.id,
    task_id: TASK.id,
    agent_id: RECEIVER_AGENT.id,
    trusted_creator_keys: [producerCreatorKey],
    cell_limit: 10,
    head_limit: 5,
    event_limit: 10,
  })
}

function bindingsMatch(
  content: Record<string, unknown> | undefined,
  expected: EvidenceBindings,
): boolean {
  const event = parseOperatingEvent(content)
  if (!event || !isObject(event.value)) return false
  const evidence = event.value['evidence']
  if (!isObject(evidence)) return false
  return (Object.keys(expected) as Array<keyof EvidenceBindings>).every(
    (key) => evidence[key] === expected[key],
  )
}

function recordHash(record: AtribRecord): Sha256Uri {
  return `sha256:${hexEncode(sha256(canonicalRecord(record)))}`
}

function hashCanonicalBody(content: Record<string, unknown> | undefined): Sha256Uri | null {
  if (!content) return null
  return hashRuntimeLogEvent(content)
}

function requireSha256(value: string | null, label: string): Sha256Uri {
  if (value === null || !/^sha256:[0-9a-f]{64}$/.test(value)) {
    throw new Error(`${label} did not produce a SHA-256 record hash`)
  }
  return value as Sha256Uri
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
