#!/usr/bin/env tsx
// SPDX-License-Identifier: Apache-2.0

import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildRuntimeLogInspection,
  hashCanonical,
  renderRuntimeLogInspectionHtml,
  type BuildRuntimeLogInspectionInput,
  type LogWindowManifest,
  type LogWindowManifestEvidence,
  type RuntimeLogInspection,
  type RuntimeLogSignedRecordRef,
} from '../../../runtime-log/src/index.js'
import { buildActiveGraphRuntimeLogProof } from '../../src/activegraph-runtime-log.js'
import { buildDogfoodRuntimeLogProof } from '../../src/dogfood-runtime-log.js'
import { buildReferenceRuntimeLogProof } from '../../src/reference-runtime-log.js'
import { buildSecondaryAdapterFamilyProof } from '../../src/secondary-runtime-log.js'

interface PacketInput {
  readonly id: string
  readonly title: string
  readonly manifest: LogWindowManifest
  readonly evidence: LogWindowManifestEvidence
  readonly signed_record?: RuntimeLogSignedRecordRef
}

interface PacketResult {
  readonly id: string
  readonly path: string
  readonly valid: boolean
  readonly issue_codes: readonly string[]
  readonly source_kind: string
  readonly projection_only: boolean
  readonly html_contains_required_fields: boolean
}

const EXAMPLE_ROOT = fileURLToPath(new URL('..', import.meta.url))

const outDir = process.argv[2] ?? (await mkdtemp(join(tmpdir(), 'atrib-runtime-log-verifier-ux-')))
await mkdir(outDir, { recursive: true })

const activeGraph = await buildActiveGraphRuntimeLogProof({
  tracePath: join(
    EXAMPLE_ROOT,
    'activegraph-runtime-log/fixtures/activegraph-v1.1.0-diligence-approval-window.jsonl',
  ),
})
const reference = await buildReferenceRuntimeLogProof(
  join(outDir, 'reference-runtime-log-source.jsonl'),
)
const dogfood = await buildDogfoodRuntimeLogProof(
  join(EXAMPLE_ROOT, 'dogfood-runtime-log/fixtures/rl-007-agent-bridge-window.json'),
)
const secondary = await buildSecondaryAdapterFamilyProof({
  langGraphFixturePath: join(
    EXAMPLE_ROOT,
    'secondary-runtime-log/fixtures/langgraph-checkpoints.json',
  ),
  openInferenceFixturePath: join(
    EXAMPLE_ROOT,
    'secondary-runtime-log/fixtures/openinference-trace-projection.json',
  ),
})

const packets: PacketInput[] = [
  {
    id: 'activegraph-approval-window',
    title: 'ActiveGraph Runtime-Log Proof Packet',
    manifest: activeGraph.manifest,
    evidence: {
      session_definition: activeGraph.session_definition,
      events: activeGraph.events,
      projections: activeGraph.projections,
      side_effect_receipts: activeGraph.side_effect_receipts,
    },
  },
  {
    id: 'reference-main-window',
    title: 'Reference Runtime-Log Proof Packet',
    manifest: reference.main.manifest,
    evidence: {
      session_definition: reference.main.session_definition,
      events: reference.main.events,
      projections: reference.main.projections,
      side_effect_receipts: reference.main.side_effect_receipts,
    },
  },
  {
    id: 'reference-fork-window',
    title: 'Reference Fork Proof Packet',
    manifest: reference.fork.manifest,
    evidence: {
      session_definition: reference.fork.session_definition,
      events: reference.fork.events,
      projections: reference.fork.projections,
      fork_parent_manifest: reference.main.manifest,
    },
  },
  {
    id: 'reference-compaction-window',
    title: 'Reference Compaction Proof Packet',
    manifest: reference.compaction.manifest,
    evidence: {
      session_definition: reference.compaction.session_definition,
      events: reference.compaction.events,
      projections: reference.compaction.projections,
      compaction_source_manifest: reference.main.manifest,
      compaction_events: reference.main.events,
    },
  },
  {
    id: 'dogfood-agent-bridge-window',
    title: 'Dogfood Runtime-Log Proof Packet',
    manifest: dogfood.manifest,
    evidence: {
      session_definition: dogfood.session_definition,
      events: dogfood.events,
      projections: dogfood.projections,
      side_effect_receipts: dogfood.side_effect_receipts,
    },
    signed_record: dogfood.fixture.signed_refs[0]
      ? {
          record_hash: dogfood.fixture.signed_refs[0],
        }
      : undefined,
  },
  {
    id: 'langgraph-checkpoint-main',
    title: 'LangGraph Checkpoint Runtime-Log Proof Packet',
    manifest: secondary.runtime_adapter.main.manifest,
    evidence: {
      session_definition: secondary.runtime_adapter.main.session_definition,
      events: secondary.runtime_adapter.main.events,
      projections: secondary.runtime_adapter.main.projections,
    },
  },
  {
    id: 'langgraph-checkpoint-fork',
    title: 'LangGraph Checkpoint Fork Proof Packet',
    manifest: secondary.runtime_adapter.fork.manifest,
    evidence: {
      session_definition: secondary.runtime_adapter.fork.session_definition,
      events: secondary.runtime_adapter.fork.events,
      projections: secondary.runtime_adapter.fork.projections,
      fork_parent_manifest: secondary.runtime_adapter.main.manifest,
    },
  },
  {
    id: 'openinference-trace-projection',
    title: 'OpenInference Trace Projection Proof Packet',
    manifest: secondary.trace_projection_adapter.manifest,
    evidence: {
      session_definition: secondary.trace_projection_adapter.session_definition,
      events: secondary.trace_projection_adapter.events,
      projections: secondary.trace_projection_adapter.projections,
    },
  },
]

const renderedPackets = await Promise.all(packets.map((packet) => renderPacket(outDir, packet)))
const invalidPacket = await renderInvalidPacket(outDir, {
  id: 'invalid-activegraph-event-root',
  title: 'Invalid ActiveGraph Runtime-Log Proof Packet',
  manifest: activeGraph.manifest,
  evidence: {
    session_definition: activeGraph.session_definition,
    events: [
      {
        ...activeGraph.events[0]!,
        event_hash: hashCanonical({ tampered: true, source: 'runtime-log-verifier-ux' }),
      },
      ...activeGraph.events.slice(1),
    ],
    projections: activeGraph.projections,
    side_effect_receipts: activeGraph.side_effect_receipts,
  },
})

console.log(
  JSON.stringify(
    {
      ok:
        renderedPackets.every((packet) => packet.valid && packet.html_contains_required_fields) &&
        !invalidPacket.valid &&
        invalidPacket.issue_codes.includes('event_root_mismatch'),
      strategy: 'runtime-log-verifier-ux-v0',
      out_dir: outDir,
      packet_count: renderedPackets.length,
      runtime_source_packets: renderedPackets.filter((packet) => !packet.projection_only).length,
      projection_source_packets: renderedPackets.filter((packet) => packet.projection_only).length,
      packets: renderedPackets,
      invalid_packet: invalidPacket,
    },
    null,
    2,
  ),
)

async function renderPacket(outDirPath: string, packet: PacketInput): Promise<PacketResult> {
  const inspection = buildInspection(packet)
  const html = renderRuntimeLogInspectionHtml(inspection)
  const path = join(outDirPath, `${packet.id}.html`)
  await writeFile(path, html)

  return {
    id: packet.id,
    path,
    valid: inspection.claim.valid,
    issue_codes: inspection.claim.issue_codes,
    source_kind: inspection.source_identity.source.kind ?? 'unknown',
    projection_only: inspection.source_identity.source.kind?.includes('projection') ?? false,
    html_contains_required_fields: requiredFieldsPresent(html),
  }
}

async function renderInvalidPacket(outDirPath: string, packet: PacketInput): Promise<PacketResult> {
  return renderPacket(outDirPath, packet)
}

function buildInspection(packet: PacketInput): RuntimeLogInspection {
  const input: BuildRuntimeLogInspectionInput = {
    manifest: packet.manifest,
    evidence: packet.evidence,
    title: packet.title,
    ...(packet.signed_record ? { signed_record: packet.signed_record } : {}),
  }
  return buildRuntimeLogInspection(input)
}

function requiredFieldsPresent(html: string): boolean {
  return [
    'Manifest hash',
    'Source identity',
    'Session definition hash',
    'Event root',
    'Projection root',
    'Receipt root',
    'Fork And Compaction',
    'Raw runtime bodies',
    'Verifier Issues',
  ].every((field) => html.includes(field))
}
