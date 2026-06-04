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

type GoogleStackChainProof = {
  ok: true
  strategy: 'atrib-google-stack-chain-proof-v1'
  artifact_dir: string
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

  const a2a = await runA2aHandoffProof(NOW_SECONDS * 1000 + 1_000)
  if (
    !a2a.agent_card.signature_valid ||
    a2a.evidence.accepted_record_hashes.length !== 1 ||
    a2a.evidence.rejected_count !== 0 ||
    !a2a.followup.signature_ok ||
    a2a.followup.informed_by_dangling.length !== 0 ||
    a2a.privacy.public_record_contains_private_phrase
  ) {
    throw new Error('A2A layer failed')
  }

  const adkPython = await runGoogleAdkPythonPluginSmoke()
  if (
    adkPython.record_hashes.length !== 1 ||
    !adkPython.chain.first_record_is_genesis ||
    !adkPython.privacy.public_records_hash_only
  ) {
    throw new Error('ADK Python layer failed')
  }

  return {
    ok: true,
    strategy: 'atrib-google-stack-chain-proof-v1',
    artifact_dir: artifactDir,
    layers: {
      ap2: {
        protocol: 'AP2',
        detected: true,
        transaction_record_hash: recordHash(ap2Artifacts.transactionRecord),
        evidence_valid: true,
        transaction_accepted: true,
        content_id: ap2Summary.detection.contentId,
      },
      a2a: {
        protocol: 'A2A',
        sdk: a2a.sdk.package,
        agent_card_signature_valid: true,
        remote_record_hash: a2a.evidence.remote_record_hash,
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
      },
    },
    value_add: {
      cross_layer_continuity:
        'AP2 authorization evidence, A2A handoff evidence, and ADK runtime evidence can be inspected as one proof ladder instead of three unrelated demos.',
      verifier_use:
        'Each layer produces verifier-readable facts: AP2 receipt and VI checks, A2A accepted handoff records, and ADK hash-only tool callback records.',
      privacy_boundary:
        'Public records expose hashes and record metadata while local artifacts or sidecars keep payment, task, and tool payload material inspectable by the host.',
      support_and_dispute_use:
        'A support reviewer can see what was authorized, what was handed off, and what runtime action was signed before asking for a maintainer or counterparty decision.',
    },
    next_chunks: [
      'Thread one shared context_id or explicit informed_by bridge across AP2, A2A, and ADK instead of composing separate proof summaries.',
      'Attach Google operational IDs such as trace_id, span_id, or BigQuery Agent Analytics event IDs to the ADK proof as local sidecar facts.',
      'Turn the proof ladder into a public packet body only after the operator approves one route: AP2, A2A #1902, or ADK #5090.',
    ],
    caveats: [
      'This is a local composed proof ladder, not a deployed Google managed runtime run.',
      'The AP2 artifacts come from committed AP2 / VI reference fixtures, not live payment credentials.',
      'The A2A proof is in-process JSON-RPC, not a public A2A server, TCK result, or upstream sample.',
      'The ADK Python proof uses a local InMemoryRunner and transient google-adk==2.1.0 install, not Agent Platform Runtime, Gemini Enterprise, BigQuery Agent Analytics, or Memory Bank.',
    ],
  }
}

function recordHash(record: AtribRecord): string {
  return `sha256:${hexEncode(sha256(canonicalRecord(record)))}`
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await runGoogleStackChainProof()
  console.log(JSON.stringify(result, null, 2))
}
