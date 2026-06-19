// SPDX-License-Identifier: Apache-2.0

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { canonicalRecord, hexEncode, sha256, type AtribRecord } from '@atrib/mcp'
import {
  generateAp2LocalParticipantArtifacts,
  readJsonFile,
} from '../../src/ap2-local-participant.js'
import { runAp2LiveInterop } from '../../src/ap2-live-interop.js'
import { runA2aHandoffProof } from '../../src/a2a-handoff.js'
import { runGoogleAdkPythonPluginSmoke } from '../google-adk-python/google-adk-python-plugin-smoke.js'

const NOW_SECONDS = 1_779_840_000
const A2A_REQUEST_MESSAGE_ID = 'google-stack-a2a-request-0001'
const A2A_RESPONSE_MESSAGE_ID = 'google-stack-a2a-response-0001'
const A2A_TASK_ID = 'google-stack-a2a-task-0001'
const A2A_CONTEXT_ID = 'google-stack-a2a-context-0001'

type GoogleStackChainProof = {
  ok: true
  strategy: 'atrib-google-stack-chain-proof-v2'
  artifact_dir: string
  continuity: {
    bridge_mode: 'explicit_informed_by'
    ap2_informs_a2a_remote: true
    a2a_remote_informs_a2a_receiver: true
    a2a_receiver_informs_adk_python: true
  }
  snapshot: {
    schema: 'atrib-google-stack-chain.snapshot.v1'
    record_hashes: {
      ap2_transaction: string
      a2a_remote_evidence: string
      a2a_receiver_followup: string
      adk_python_tool_callback: string
    }
    resolved_edges: Array<{
      from: string
      to: string
      relation: 'informed_by'
      verifier: '@atrib/verify'
    }>
    stable_inputs: {
      timestamp_seconds: number
      a2a_request_message_id: string
      a2a_response_message_id: string
      a2a_task_id: string
      a2a_context_id: string
    }
  }
  analytics_fixture: {
    schema: 'atrib-google-stack-chain.bigquery-agent-analytics.fixture.v1'
    source: 'local-fixture'
    common_columns: string[]
    attribution_columns: string[]
    rows: Array<{
      timestamp: string
      event_type: string
      agent: string
      session_id: string | null
      invocation_id: string | null
      user_id: string | null
      trace_id: string | null
      span_id: string | null
      parent_span_id: string | null
      status: 'OK'
      error_message: string | null
      is_truncated: boolean
      atrib_record_hash: string
      atrib_parent_record_hashes: string[]
      protocol: 'AP2' | 'A2A' | 'ADK Python'
    }>
    caveat: string
  }
  layers: {
    ap2: {
      protocol: 'AP2'
      detected: true
      transaction_record_hash: string
      evidence_valid: true
      transaction_accepted: true
      content_id: string
    }
    a2a: {
      protocol: 'A2A'
      sdk: '@a2a-js/sdk'
      agent_card_signature_valid: true
      remote_record_hash: string
      remote_informed_by_resolved: string[]
      receiver_followup_hash: string
      informed_by_resolved: string[]
    }
    adk_python: {
      protocol: 'ADK Python'
      package: 'google-adk'
      version: string
      runtime: 'InMemoryRunner'
      plugin: 'BasePlugin'
      signed_record_hash: string
      operation: string
      parent_informed_by_resolved: string[]
      google_operational_ids: {
        trace_id: string
        span_id: string
        adk_invocation_id: string | null
        adk_session_id: string
        adk_function_call_id: string | null
        adk_agent_name: string | null
        source: 'local-adk-sidecar'
        trace_projection: 'deterministic-local'
      }
    }
  }
  value_add: {
    cross_layer_continuity: string
    verifier_use: string
    privacy_boundary: string
    support_and_dispute_use: string
  }
  next_chunks: string[]
  caveats: string[]
}

export async function runGoogleStackChainProof(): Promise<GoogleStackChainProof> {
  const exampleDir = dirname(fileURLToPath(import.meta.url))
  const packageDir = resolve(exampleDir, '../..')
  const artifactDir = await mkdtemp(join(tmpdir(), 'atrib-google-stack-chain-'))

  const ap2Artifacts = await generateAp2LocalParticipantArtifacts({
    result: await readJsonFile(
      join(packageDir, 'test/fixtures/ap2-vi-reference/ap2-vi-reference-result.json'),
    ),
    evidence: await readJsonFile(
      join(packageDir, 'test/fixtures/ap2-vi-reference/ap2-vi-reference-evidence.json'),
    ),
    outDir: artifactDir,
    nowSeconds: NOW_SECONDS,
  })
  const ap2Summary = await runAp2LiveInterop({
    result: ap2Artifacts.result,
    evidence: ap2Artifacts.evidence,
    evidenceOptions: { nowSeconds: NOW_SECONDS },
    transactionRecord: ap2Artifacts.transactionRecord,
    requireCounterpartyAttestation: true,
  })
  if (
    !ap2Summary.ok ||
    !ap2Summary.detection.detected ||
    ap2Summary.detection.protocol !== 'AP2' ||
    !ap2Summary.detection.contentId ||
    !ap2Summary.evidence?.valid ||
    !ap2Summary.evidence.transactionAccepted
  ) {
    throw new Error(`AP2 layer failed: ${ap2Summary.errors.join(', ')}`)
  }

  const ap2RecordHash = recordHash(ap2Artifacts.transactionRecord)
  const a2a = await runA2aHandoffProof({
    nowMs: NOW_SECONDS * 1000 + 1_000,
    remoteInformedBy: [ap2RecordHash],
    remoteInformedByCandidates: [ap2Artifacts.transactionRecord],
    includeSignedRecords: true,
    ids: {
      requestMessageId: A2A_REQUEST_MESSAGE_ID,
      responseMessageId: A2A_RESPONSE_MESSAGE_ID,
      taskId: A2A_TASK_ID,
      contextId: A2A_CONTEXT_ID,
    },
  })
  if (
    !a2a.agent_card.signature_valid ||
    a2a.evidence.accepted_record_hashes.length !== 1 ||
    a2a.evidence.remote_informed_by_resolved[0] !== ap2RecordHash ||
    a2a.evidence.remote_informed_by_dangling.length !== 0 ||
    a2a.evidence.rejected_count !== 0 ||
    !a2a.followup.signature_ok ||
    a2a.followup.informed_by_dangling.length !== 0 ||
    a2a.privacy.public_record_contains_private_phrase
  ) {
    throw new Error('A2A layer failed')
  }
  if (!a2a.records?.followup) {
    throw new Error('A2A layer did not expose the signed follow-up record for ADK chaining')
  }

  const adkPython = await runGoogleAdkPythonPluginSmoke({
    parentRecordHash: a2a.followup.record_hash,
    parentRecord: a2a.records.followup,
  })
  if (
    adkPython.record_hashes.length !== 1 ||
    !adkPython.chain.first_record_is_genesis ||
    adkPython.chain.parent_informed_by_resolved[0] !== a2a.followup.record_hash ||
    adkPython.chain.parent_informed_by_dangling.length !== 0 ||
    !adkPython.privacy.public_records_hash_only
  ) {
    throw new Error('ADK Python layer failed')
  }
  const adkOperationalIds = adkPython.google_operational_ids[0]!

  return {
    ok: true,
    strategy: 'atrib-google-stack-chain-proof-v2',
    artifact_dir: artifactDir,
    continuity: {
      bridge_mode: 'explicit_informed_by',
      ap2_informs_a2a_remote: true,
      a2a_remote_informs_a2a_receiver: true,
      a2a_receiver_informs_adk_python: true,
    },
    snapshot: {
      schema: 'atrib-google-stack-chain.snapshot.v1',
      record_hashes: {
        ap2_transaction: ap2RecordHash,
        a2a_remote_evidence: a2a.evidence.remote_record_hash,
        a2a_receiver_followup: a2a.followup.record_hash,
        adk_python_tool_callback: adkPython.record_hashes[0]!,
      },
      resolved_edges: [
        {
          from: ap2RecordHash,
          to: a2a.evidence.remote_record_hash,
          relation: 'informed_by',
          verifier: '@atrib/verify',
        },
        {
          from: a2a.evidence.remote_record_hash,
          to: a2a.followup.record_hash,
          relation: 'informed_by',
          verifier: '@atrib/verify',
        },
        {
          from: a2a.followup.record_hash,
          to: adkPython.record_hashes[0]!,
          relation: 'informed_by',
          verifier: '@atrib/verify',
        },
      ],
      stable_inputs: {
        timestamp_seconds: NOW_SECONDS,
        a2a_request_message_id: A2A_REQUEST_MESSAGE_ID,
        a2a_response_message_id: A2A_RESPONSE_MESSAGE_ID,
        a2a_task_id: A2A_TASK_ID,
        a2a_context_id: A2A_CONTEXT_ID,
      },
    },
    analytics_fixture: {
      schema: 'atrib-google-stack-chain.bigquery-agent-analytics.fixture.v1',
      source: 'local-fixture',
      common_columns: [
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
      ],
      attribution_columns: ['atrib_record_hash', 'atrib_parent_record_hashes', 'protocol'],
      rows: [
        {
          timestamp: new Date(NOW_SECONDS * 1000).toISOString(),
          event_type: 'atrib.ap2.transaction_verified',
          agent: 'ap2-local-participant',
          session_id: null,
          invocation_id: null,
          user_id: null,
          trace_id: null,
          span_id: null,
          parent_span_id: null,
          status: 'OK',
          error_message: null,
          is_truncated: false,
          atrib_record_hash: ap2RecordHash,
          atrib_parent_record_hashes: [],
          protocol: 'AP2',
        },
        {
          timestamp: new Date(NOW_SECONDS * 1000 + 1_000).toISOString(),
          event_type: 'atrib.a2a.remote_evidence_accepted',
          agent: 'a2a-specialist-agent',
          session_id: A2A_CONTEXT_ID,
          invocation_id: A2A_REQUEST_MESSAGE_ID,
          user_id: null,
          trace_id: adkOperationalIds.trace_id,
          span_id: digestHex(`${A2A_CONTEXT_ID}:a2a-remote`, 16),
          parent_span_id: null,
          status: 'OK',
          error_message: null,
          is_truncated: false,
          atrib_record_hash: a2a.evidence.remote_record_hash,
          atrib_parent_record_hashes: [ap2RecordHash],
          protocol: 'A2A',
        },
        {
          timestamp: new Date(NOW_SECONDS * 1000 + 1_000).toISOString(),
          event_type: 'atrib.a2a.receiver_followup_signed',
          agent: 'a2a-receiving-agent',
          session_id: A2A_CONTEXT_ID,
          invocation_id: A2A_RESPONSE_MESSAGE_ID,
          user_id: null,
          trace_id: adkOperationalIds.trace_id,
          span_id: digestHex(`${A2A_CONTEXT_ID}:a2a-receiver`, 16),
          parent_span_id: digestHex(`${A2A_CONTEXT_ID}:a2a-remote`, 16),
          status: 'OK',
          error_message: null,
          is_truncated: false,
          atrib_record_hash: a2a.followup.record_hash,
          atrib_parent_record_hashes: [a2a.evidence.remote_record_hash],
          protocol: 'A2A',
        },
        {
          timestamp: new Date(1_779_842_000_000).toISOString(),
          event_type: 'atrib.adk_python.tool_callback_signed',
          agent: adkOperationalIds.adk_agent_name ?? 'google-adk-python-agent',
          session_id: adkOperationalIds.adk_session_id,
          invocation_id: adkOperationalIds.adk_invocation_id,
          user_id: null,
          trace_id: adkOperationalIds.trace_id,
          span_id: adkOperationalIds.span_id,
          parent_span_id: digestHex(`${A2A_CONTEXT_ID}:a2a-receiver`, 16),
          status: 'OK',
          error_message: null,
          is_truncated: false,
          atrib_record_hash: adkPython.record_hashes[0]!,
          atrib_parent_record_hashes: [a2a.followup.record_hash],
          protocol: 'ADK Python',
        },
      ],
      caveat:
        'This is a local BigQuery Agent Analytics-shaped fixture, not a BigQuery Storage Write API export or a managed Google Cloud run.',
    },
    layers: {
      ap2: {
        protocol: 'AP2',
        detected: true,
        transaction_record_hash: ap2RecordHash,
        evidence_valid: true,
        transaction_accepted: true,
        content_id: ap2Summary.detection.contentId,
      },
      a2a: {
        protocol: 'A2A',
        sdk: a2a.sdk.package,
        agent_card_signature_valid: true,
        remote_record_hash: a2a.evidence.remote_record_hash,
        remote_informed_by_resolved: a2a.evidence.remote_informed_by_resolved,
        receiver_followup_hash: a2a.followup.record_hash,
        informed_by_resolved: a2a.followup.informed_by_resolved,
      },
      adk_python: {
        protocol: 'ADK Python',
        package: adkPython.google_adk_python.python_package,
        version: adkPython.google_adk_python.version,
        runtime: adkPython.google_adk_python.runner,
        plugin: adkPython.google_adk_python.plugin,
        signed_record_hash: adkPython.record_hashes[0]!,
        operation: adkPython.operations[0]!,
        parent_informed_by_resolved: adkPython.chain.parent_informed_by_resolved,
        google_operational_ids: adkOperationalIds,
      },
    },
    value_add: {
      cross_layer_continuity:
        'AP2 authorization evidence, A2A handoff evidence, and ADK runtime evidence are linked through verifier-resolved informed_by records.',
      verifier_use:
        'Each layer produces verifier-readable facts: AP2 receipt and VI checks, A2A accepted handoff records, and ADK hash-only tool callback records.',
      privacy_boundary:
        'Public records expose hashes and record metadata while local artifacts or sidecars keep payment, task, and tool payload material inspectable by the host.',
      support_and_dispute_use:
        'A support reviewer can see what was authorized, what was handed off, and what runtime action was signed before resolving a support or counterparty decision.',
    },
    next_chunks: [
      'Turn the proof chain into public proof material only after the target surface is refreshed and the evidence still matches.',
    ],
    caveats: [
      'Boundary: atrib is the trust-transfer layer here. AP2 evidence is accepted first, A2A receives that signed parent, and ADK signs from the A2A parent.',
      'AP2 source: committed AP2 / VI fixtures or merchant-supplied packet JSON. This proof does not use live payment credentials or move funds.',
      'A2A source: in-process JSON-RPC with signed receiving-agent follow-up. It proves verifier-gated handoff, not an A2A TCK result or public server deployment.',
      'ADK source: InMemoryRunner callback proof. The claim is callback-boundary signing, not managed Agent Platform Runtime, Gemini Enterprise, BigQuery Storage Write API export, or Memory Bank coverage.',
    ],
  }
}

function recordHash(record: AtribRecord): string {
  return `sha256:${hexEncode(sha256(canonicalRecord(record)))}`
}

function digestHex(value: string, length: number): string {
  return hexEncode(sha256(new TextEncoder().encode(value))).slice(0, length)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await runGoogleStackChainProof()
  console.log(JSON.stringify(result, null, 2))
}
