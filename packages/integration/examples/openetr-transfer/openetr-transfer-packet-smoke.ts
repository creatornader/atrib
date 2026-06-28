// SPDX-License-Identifier: Apache-2.0

import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  hashText,
  runWrappedMcpPacket,
  type WrappedMcpPacketResult,
  writeJson,
} from '../wrapped-mcp-proof-runner.js'

const PRIVATE_OBJECT_DIGEST =
  'sha256:7f4b8b8e2f394fddad1ed04e94c456ff0c8fb7ee6f0c5d5017deac9a0f61d425'
const PRIVATE_DOCUMENT_TITLE = 'private warehouse receipt WR-2026-0628'
const PRIVATE_ISSUER_NPUB = 'npub1privateissueropenetr20260628'
const PRIVATE_BUYER_NPUB = 'npub1privatebuyeropenetr20260628'
const PRIVATE_RELAY = 'wss://relay.openetr.example/private-transfer'
const PRIVATE_ORIGIN_EVENT_ID = '1111111111111111111111111111111111111111111111111111111111111111'
const PRIVATE_INITIATE_EVENT_ID = '2222222222222222222222222222222222222222222222222222222222222222'
const PRIVATE_ACCEPT_EVENT_ID = '3333333333333333333333333333333333333333333333333333333333333333'

type PacketOptions = Parameters<typeof runWrappedMcpPacket>[0]
type OpenEtrSourceEvidence = ReturnType<typeof runOpenEtrSourceE2e>
type PolicyDecisionArtifact = ReturnType<typeof buildPolicyDecision>

type OpenEtrSourceEvent = {
  id?: string
  kind?: number
  pubkey?: string
  tags?: unknown[]
  content?: string
}

type OpenEtrSourceRun = {
  schema?: string
  source?: { repo?: string; commit?: string; entrypoints?: string[] }
  runtime?: Record<string, unknown>
  object?: { digest?: string; document_hash?: string }
  parties?: Record<string, string>
  commands?: Record<string, unknown>
  events?: {
    origin?: OpenEtrSourceEvent
    initiate?: OpenEtrSourceEvent
    accept?: OpenEtrSourceEvent
  }
  query?: {
    current_controller?: { npub?: string; basis?: string; profile?: unknown[] }
    summary_control_chains?: unknown[]
  }
  checks?: Record<string, boolean>
  warnings?: unknown[]
}

export type OpenEtrTransferPacketOptions = {
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
  outDir?: string
  writeArtifacts?: boolean
}

export type OpenEtrTransferPacketRun = {
  result: WrappedMcpPacketResult
  verifierOutput: unknown
  redactionManifest: unknown
  policyDecision: PolicyDecisionArtifact
  artifact_dir: string | null
}

function artifactResult(result: WrappedMcpPacketResult): WrappedMcpPacketResult {
  if (result.log.mode !== 'local') return result
  return {
    ...result,
    log: {
      ...result.log,
      endpoint: 'local-fixture-log',
    },
  }
}

function artifactDir(
  integrationDir: string,
  env: NodeJS.ProcessEnv,
  options: OpenEtrTransferPacketOptions,
): string | undefined {
  if (options.outDir) return options.outDir
  if (env.ATRIB_PACKET_OUT_DIR) return env.ATRIB_PACKET_OUT_DIR
  if (options.writeArtifacts || env.ATRIB_PACKET_WRITE_ARTIFACTS === '1') {
    return join(integrationDir, '..', '..', 'proof-packets', 'openetr-transfer')
  }
  return undefined
}

function stableJsonHash(value: unknown): string {
  return hashText(JSON.stringify(value))
}

function sourceTagValue(event: OpenEtrSourceEvent | undefined, tagName: string): string | null {
  const tags = event?.tags
  if (!Array.isArray(tags)) return null
  for (const tag of tags) {
    if (Array.isArray(tag) && tag.length > 1 && tag[0] === tagName && typeof tag[1] === 'string') {
      return tag[1]
    }
  }
  return null
}

function sourceTagNames(event: OpenEtrSourceEvent | undefined): string[] {
  const tags = event?.tags
  if (!Array.isArray(tags)) return []
  return tags
    .map((tag) => (Array.isArray(tag) && typeof tag[0] === 'string' ? tag[0] : null))
    .filter((tagName): tagName is string => typeof tagName === 'string')
}

function collectSourcePrivateNeedles(sourceRun: OpenEtrSourceRun): string[] {
  const needles = new Set<string>()
  const add = (value: unknown) => {
    if (typeof value === 'string' && value.length > 0) needles.add(value)
  }
  const addIdentifier = (value: unknown) => {
    if (typeof value === 'string' && value.length >= 16) needles.add(value)
  }
  add(sourceRun.object?.digest)
  for (const value of Object.values(sourceRun.parties ?? {})) add(value)
  for (const event of Object.values(sourceRun.events ?? {})) {
    add(event?.id)
    add(event?.pubkey)
    add(event?.content)
    for (const tag of event?.tags ?? []) {
      if (!Array.isArray(tag)) continue
      for (const value of tag) addIdentifier(value)
    }
  }
  return [...needles]
}

function sanitizeSourceEvent(role: string, event: OpenEtrSourceEvent | undefined) {
  return {
    role,
    kind: event?.kind ?? null,
    event_id_hash: event?.id ? hashText(event.id) : null,
    signer_pubkey_hash: event?.pubkey ? hashText(event.pubkey) : null,
    content_hash: event?.content ? hashText(event.content) : null,
    tag_names: sourceTagNames(event),
    action: sourceTagValue(event, 'action'),
    object_digest_hash: sourceTagValue(event, 'o')
      ? hashText(sourceTagValue(event, 'o') ?? '')
      : null,
    prior_event_id_hash: sourceTagValue(event, 'e')
      ? hashText(sourceTagValue(event, 'e') ?? '')
      : null,
    party_pubkey_hash: sourceTagValue(event, 'p')
      ? hashText(sourceTagValue(event, 'p') ?? '')
      : null,
  }
}

function sanitizeSourceRun(sourceRun: OpenEtrSourceRun) {
  return {
    schema: 'atrib.openetr.source_local_relay_summary.v1',
    source: {
      repo: sourceRun.source?.repo ?? 'https://github.com/trbouma/openetr',
      commit: sourceRun.source?.commit ?? null,
      entrypoints: sourceRun.source?.entrypoints ?? [],
    },
    runtime: {
      relay: sourceRun.runtime?.relay ?? 'local-websocket-nostr-relay',
      live_public_relay: sourceRun.runtime?.live_public_relay ?? false,
      openetr_user_config_written: sourceRun.runtime?.openetr_user_config_written ?? false,
    },
    object: {
      digest_hash: sourceRun.object?.digest ? hashText(sourceRun.object.digest) : null,
      document_hash: sourceRun.object?.document_hash ?? null,
    },
    parties: {
      issuer_npub_hash: sourceRun.parties?.issuer_npub
        ? hashText(sourceRun.parties.issuer_npub)
        : null,
      buyer_npub_hash: sourceRun.parties?.buyer_npub
        ? hashText(sourceRun.parties.buyer_npub)
        : null,
      issuer_pubkey_hash: sourceRun.parties?.issuer_pubkey_hex
        ? hashText(sourceRun.parties.issuer_pubkey_hex)
        : null,
      buyer_pubkey_hash: sourceRun.parties?.buyer_pubkey_hex
        ? hashText(sourceRun.parties.buyer_pubkey_hex)
        : null,
    },
    events: [
      sanitizeSourceEvent('origin', sourceRun.events?.origin),
      sanitizeSourceEvent('transfer_initiate', sourceRun.events?.initiate),
      sanitizeSourceEvent('transfer_accept', sourceRun.events?.accept),
    ],
    query: {
      current_controller_npub_hash: sourceRun.query?.current_controller?.npub
        ? hashText(sourceRun.query.current_controller.npub)
        : null,
      current_controller_basis: sourceRun.query?.current_controller?.basis ?? null,
      summary_control_chain_count: sourceRun.query?.summary_control_chains?.length ?? 0,
    },
    checks: sourceRun.checks ?? {},
    warnings: sourceRun.warnings ?? [],
  }
}

function runOpenEtrSourceE2e(
  env: NodeJS.ProcessEnv,
  exampleDir: string,
): {
  raw: OpenEtrSourceRun
  rawPath: string
  sanitized: ReturnType<typeof sanitizeSourceRun>
  privateNeedles: string[]
} | null {
  const sourceDir = env.OPENETR_SOURCE_DIR
  const requested = env.ATRIB_OPENETR_SOURCE_E2E === '1'
  if (!sourceDir) {
    if (requested) throw new Error('ATRIB_OPENETR_SOURCE_E2E=1 requires OPENETR_SOURCE_DIR')
    return null
  }
  const runner = join(exampleDir, 'openetr-source-local-relay.py')
  const child = spawnSync(
    'uv',
    ['run', '--with', sourceDir, '--with', 'websockets', 'python', runner],
    {
      cwd: exampleDir,
      env: { ...process.env, ...env, OPENETR_SOURCE_DIR: sourceDir },
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    },
  )
  if (child.status !== 0) {
    throw new Error(
      `OpenETR source e2e failed: ${child.stderr.slice(0, 4000)} ${child.stdout.slice(0, 4000)}`,
    )
  }
  const raw = JSON.parse(child.stdout.trim()) as OpenEtrSourceRun
  const tempDir = mkdtempSync(join(tmpdir(), 'atrib-openetr-source-'))
  const rawPath = join(tempDir, 'source-run.json')
  writeJson(rawPath, raw)
  return {
    raw,
    rawPath,
    sanitized: sanitizeSourceRun(raw),
    privateNeedles: collectSourcePrivateNeedles(raw),
  }
}

function buildPolicyDecision(
  result: WrappedMcpPacketResult,
  sourceEvidence: OpenEtrSourceEvidence,
) {
  const sourceRule = sourceEvidence
    ? [
        {
          id: 'actual_openetr_source_run_present',
          outcome: 'pass',
          evidence:
            'trbouma/openetr Python implementation ran issue, transfer initiate, transfer accept, and query against a local Nostr relay',
        },
      ]
    : []
  const base = {
    schema: 'atrib.proof_packet.policy_decision.v1',
    packet: result.packet,
    mode: result.mode,
    evaluator: 'openetr-transfer-policy-v0',
    decision: 'escalate_before_title_recognition',
    decision_status: 'review_required',
    proposed_next_action: {
      action_type: 'recognize_transfer',
      description: 'Treat the OpenETR accept event as recognized control transfer.',
      risk_class: 'transferable_record_control',
    },
    inputs: {
      operation_order: result.operations,
      record_hashes: result.record_hashes,
      log_indexes: result.log_indexes,
      log_mode: result.log.mode,
      log_endpoint: result.log.endpoint,
      verifier: result.verifier,
      privacy: result.privacy,
      openetr_event_kinds: [31415, 31416],
      openetr_source_e2e: sourceEvidence?.sanitized ?? null,
    },
    rule_results: [
      ...sourceRule,
      {
        id: 'signed_openetr_records_present',
        outcome: result.verifier.record_valid ? 'pass' : 'fail',
        evidence: `${result.signed_records} verified OpenETR-shaped tool-call records`,
      },
      {
        id: 'openetr_chain_observed',
        outcome:
          result.operations.join('>') ===
          'openetr_issue>openetr_transfer_initiate>openetr_transfer_accept>openetr_query_state'
            ? 'pass'
            : 'fail',
        evidence: 'issue, initiate, accept, and query actions are present in order',
      },
      {
        id: 'acceptance_observed',
        outcome: result.operations.includes('openetr_transfer_accept') ? 'pass' : 'fail',
        evidence: 'transfer accept action was signed before state query',
      },
      {
        id: 'p_tag_semantics_review_required',
        outcome: 'escalate',
        evidence:
          'fixture models the reviewed OpenETR p-tag ambiguity after accept; controller recognition must not infer control from latest p tag alone',
      },
      {
        id: 'title_recognition_requires_attestor',
        outcome: 'escalate',
        evidence:
          'fixture contains no title-transfer authority or recognized attestor signature over atrib bytes',
      },
      {
        id: 'raw_openetr_payload_private',
        outcome: result.privacy.public_records_hash_only ? 'pass' : 'fail',
        evidence:
          'object digest, parties, relay, event ids, and document label stay private in public records',
      },
    ],
    allowed_without_review: ['internal_state_query', 'proof_packet_review'],
    escalated_actions: [
      'recognize_transfer',
      'release_goods',
      'settle_against_warehouse_receipt',
      'update_official_title_register',
    ],
    public_fields: [
      'tool_names',
      'args_hash',
      'result_hash',
      'record_hashes',
      'log_indexes',
      'verifier_result',
      'policy_decision_hash',
    ],
    private_fields: [
      'object_digest',
      'document_title',
      'issuer_npub',
      'buyer_npub',
      'relay_url',
      'openetr_event_ids',
    ],
    caveats: [
      'This packet proves the atrib wrapper and policy boundary for an OpenETR-shaped flow.',
      'It does not prove live OpenETR relay behavior.',
      'It does not prove legal title transfer or MLETR compliance.',
      'The policy decision artifact is not a signed atrib record yet.',
    ],
  }
  return {
    decision_hash: stableJsonHash(base),
    ...base,
  }
}

function renderReadme(
  result: WrappedMcpPacketResult,
  policyDecision: PolicyDecisionArtifact,
  sourceEvidence: OpenEtrSourceEvidence,
): string {
  const rows = result.operations
    .map(
      (operation, index) =>
        `| ${operation} | ${result.record_hashes[index] ?? 'missing'} | ${result.log_indexes[index] ?? 'missing'} |`,
    )
    .join('\n')
  const sourceSection = sourceEvidence
    ? `
## Source-backed OpenETR run

This artifact includes \`source-run-output.json\`, a sanitized summary of a real
OpenETR run from \`trbouma/openetr\` commit
\`${sourceEvidence.raw.source?.commit ?? 'unknown'}\`.

The source-backed run executed:

- \`openetr.services.issue_etr.publish_issue_etr\`
- \`openetr commands publish transfer initiate\`
- \`openetr commands publish transfer accept\`
- \`openetr.services.query_etr.build_query_etr_result\`

Those calls ran against a local WebSocket Nostr relay. The proof still does not
use a public relay or a title-transfer authority. Raw OpenETR event ids, object
digest, party keys, relay URL, and event JSON stay out of the public artifact.
`
    : `
## Source-backed OpenETR run

No OpenETR source checkout was supplied for this artifact. Regenerate with
\`OPENETR_SOURCE_DIR=/path/to/trbouma/openetr ATRIB_OPENETR_SOURCE_E2E=1\` to run
the source-backed local-relay proof and write \`source-run-output.json\`.
`
  const upstreamSurface = sourceEvidence
    ? 'OpenETR Python source at the pinned commit, executed against a local WebSocket Nostr relay and surfaced through MCP-shaped tools.'
    : 'OpenETR-shaped deterministic MCP fixture.'
  const weakness = sourceEvidence
    ? `This is a source-backed local-relay proof. It checks the OpenETR implementation
entrypoints, local Nostr relay publish/query path, wrapper record chain,
hash-only disclosure, verifier path, and policy gate. It does not prove hosted
OpenETR relay behavior, a title-transfer authority decision, legal recognition,
or public Nostr event availability.`
    : `This is a fixture proof. It checks the wrapper, record chain, hash-only
disclosure, verifier path, and policy gate for the OpenETR shape. It does not
prove hosted OpenETR relay behavior, a title-transfer authority decision, legal
recognition, or live Nostr event availability.`
  const regenerateCommand = sourceEvidence
    ? `OPENETR_SOURCE_DIR=/path/to/trbouma/openetr ATRIB_PACKET_WRITE_ARTIFACTS=1 pnpm --filter @atrib/integration openetr-transfer-source-packet`
    : `ATRIB_PACKET_WRITE_ARTIFACTS=1 pnpm --filter @atrib/integration openetr-transfer-packet`

  return `# OpenETR transfer proof artifact

This proof signs an OpenETR-shaped transfer-control flow through \`@atrib/mcp-wrap\`.

## Action path

\`openetr_issue -> openetr_transfer_initiate -> openetr_transfer_accept -> openetr_query_state\`

## What ran

- Upstream surface: ${upstreamSurface}
- Atrib path: \`@atrib/mcp-wrap\` around an MCP stdio server.
- Record policy: public records keep selected tool names plus \`args_hash\` and \`result_hash\`.
- Verification: \`@atrib/mcp\` verifies each Ed25519 record signature after the wrapper writes its mirror.
- Log proof: local fixture log only.
- Publish policy: \`${result.log.publish_policy}\`

## Record refs

| Tool | Record hash | Local log index |
| --- | --- | --- |
${rows}

## Redaction line

The fixture saw private OpenETR-shaped payloads: object digest, document label,
controller keys, relay URL, and event ids. The public artifact stores only
hashes for those fields. See \`redaction-manifest.json\`.

## Control-plane fit

OpenETR is the transferable-record control chain. atrib signs the agent action
chain around it. This packet sits before a system recognizes title transfer,
releases goods, updates an official register, or settles against the record.

A verifier can see which OpenETR-shaped actions ran, that the action records
verify, that raw OpenETR payloads stayed private, and that recognition still
requires attestor or title-transfer authority evidence.

## Policy decision artifact

\`policy-decision.json\` models the next gate after the OpenETR accept event:
\`${policyDecision.decision}\`. It binds to the signed OpenETR-shaped records,
local log indexes, verifier result, and redaction boundary.

Allowed without review: \`${policyDecision.allowed_without_review.join('`, `')}\`.

Escalated before execution: \`${policyDecision.escalated_actions.join('`, `')}\`.

Policy decision hash: \`${policyDecision.decision_hash}\`.

The policy decision file is deterministic and hash-bound to the signed records.
It is not a signed atrib record yet. The signed evidence in this packet is the
wrapped OpenETR-shaped tool-call chain.
${sourceSection}

## Weakness

${weakness}

## Regenerate

\`\`\`bash
${regenerateCommand}
\`\`\`

## Live upstream path

A live proof should wait until OpenETR has a pinned transfer-state fixture or a
stable adapter command. The live version should capture the OpenETR event ids
and relay query output as archive evidence, then submit only the verified atrib
records to the public log after the full flow passes.
`
}

export async function runOpenEtrTransferPacket(
  options: OpenEtrTransferPacketOptions = {},
): Promise<OpenEtrTransferPacketRun> {
  const env = options.env ?? process.env
  const exampleDir = dirname(fileURLToPath(import.meta.url))
  const integrationDir = dirname(dirname(exampleDir))
  const sourceEvidence = runOpenEtrSourceE2e(env, exampleDir)
  const fixtureServer = join(exampleDir, 'openetr-fixture-mcp.ts')
  const upstream = sourceEvidence
    ? {
        command: 'pnpm',
        args: ['exec', 'tsx', fixtureServer],
        env: { OPENETR_SOURCE_RUN_JSON: sourceEvidence.rawPath },
      }
    : undefined
  const packetOptions: PacketOptions = {
    packet: 'openetr-transfer',
    mode: 'fixture',
    logMode: 'local',
    upstreamShape: sourceEvidence
      ? 'trbouma/openetr Python source run against local Nostr relay, surfaced through MCP-shaped tools openetr_issue, openetr_transfer_initiate, openetr_transfer_accept, openetr_query_state'
      : 'OpenETR MCP-shaped fixture tools openetr_issue, openetr_transfer_initiate, openetr_transfer_accept, openetr_query_state',
    exampleDir,
    integrationDir,
    ...(upstream ? { upstream } : { fixtureServer }),
    expectedTools: [
      'openetr_issue',
      'openetr_transfer_initiate',
      'openetr_transfer_accept',
      'openetr_query_state',
    ],
    calls: [
      {
        name: 'openetr_issue',
        arguments: {
          object_digest: PRIVATE_OBJECT_DIGEST,
          document_title: PRIVATE_DOCUMENT_TITLE,
          issuer_npub: PRIVATE_ISSUER_NPUB,
          relays: [PRIVATE_RELAY],
        },
        expectText: 'origin_event_id',
      },
      {
        name: 'openetr_transfer_initiate',
        arguments: {
          object_digest: PRIVATE_OBJECT_DIGEST,
          prior_event_id: PRIVATE_ORIGIN_EVENT_ID,
          transferee_npub: PRIVATE_BUYER_NPUB,
        },
        expectText: 'transfer_event_id',
      },
      {
        name: 'openetr_transfer_accept',
        arguments: {
          object_digest: PRIVATE_OBJECT_DIGEST,
          initiate_event_id: PRIVATE_INITIATE_EVENT_ID,
          acceptor_npub: PRIVATE_BUYER_NPUB,
        },
        expectText: 'accept_event_id',
      },
      {
        name: 'openetr_query_state',
        arguments: { object_digest: PRIVATE_OBJECT_DIGEST, relays: [PRIVATE_RELAY] },
        expectText: 'ambiguous_controller_warning',
      },
    ],
    privateNeedles: [
      PRIVATE_OBJECT_DIGEST,
      PRIVATE_DOCUMENT_TITLE,
      PRIVATE_ISSUER_NPUB,
      PRIVATE_BUYER_NPUB,
      PRIVATE_RELAY,
      PRIVATE_ORIGIN_EVENT_ID,
      PRIVATE_INITIATE_EVENT_ID,
      PRIVATE_ACCEPT_EVENT_ID,
      ...(sourceEvidence?.privateNeedles ?? []),
    ],
    ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
  }
  const result = await runWrappedMcpPacket(packetOptions)
  const publicResult = artifactResult(result)
  const policyDecision = buildPolicyDecision(publicResult, sourceEvidence)
  const verifierOutput = {
    schema: 'atrib.proof_packet.verifier_output.v1',
    packet: publicResult.packet,
    mode: publicResult.mode,
    live_upstream: false,
    upstream_shape: publicResult.upstream_shape,
    operations: publicResult.operations,
    records: publicResult.operations.map((tool_name, index) => ({
      tool_name,
      record_hash: publicResult.record_hashes[index],
      log_index: publicResult.log_indexes[index],
      proof: publicResult.log.proofs[index],
    })),
    log: publicResult.log,
    verifier: publicResult.verifier,
    privacy: publicResult.privacy,
    openetr: {
      event_kinds: [31415, 31416],
      recognized_title_transfer: false,
      attestor_evidence_supplied: false,
      controller_semantics_pinned: false,
      source_e2e: sourceEvidence?.sanitized ?? null,
    },
    policy_decision: {
      artifact: 'policy-decision.json',
      decision: policyDecision.decision,
      decision_status: policyDecision.decision_status,
      decision_hash: policyDecision.decision_hash,
      signed_policy_record: false,
      caveat:
        'Policy decision is a deterministic artifact bound to signed records, not a signed atrib record.',
    },
    caveats: [
      'Fixture run only. It does not prove live OpenETR relay output.',
      'Private OpenETR object, party, relay, and event-id material are represented by hashes only.',
      'Title recognition remains a consumer policy decision until attestor evidence is supplied.',
    ],
  }
  const redactionManifest = {
    schema: 'atrib.proof_packet.redaction_manifest.v1',
    packet: result.packet,
    private_fields: [
      { field: 'object_digest', disclosure: 'hash-only', hash: hashText(PRIVATE_OBJECT_DIGEST) },
      { field: 'document_title', disclosure: 'hash-only', hash: hashText(PRIVATE_DOCUMENT_TITLE) },
      { field: 'issuer_npub', disclosure: 'hash-only', hash: hashText(PRIVATE_ISSUER_NPUB) },
      { field: 'buyer_npub', disclosure: 'hash-only', hash: hashText(PRIVATE_BUYER_NPUB) },
      { field: 'relay_url', disclosure: 'hash-only', hash: hashText(PRIVATE_RELAY) },
      {
        field: 'origin_event_id',
        disclosure: 'hash-only',
        hash: hashText(PRIVATE_ORIGIN_EVENT_ID),
      },
      {
        field: 'initiate_event_id',
        disclosure: 'hash-only',
        hash: hashText(PRIVATE_INITIATE_EVENT_ID),
      },
      {
        field: 'accept_event_id',
        disclosure: 'hash-only',
        hash: hashText(PRIVATE_ACCEPT_EVENT_ID),
      },
      ...(sourceEvidence?.privateNeedles.map((needle, index) => ({
        field: `source_e2e_private_${index + 1}`,
        disclosure: 'hash-only',
        hash: hashText(needle),
      })) ?? []),
    ],
  }
  const outDir = artifactDir(integrationDir, env, options)
  if (outDir) {
    mkdirSync(outDir, { recursive: true })
    writeFileSync(
      join(outDir, 'README.md'),
      renderReadme(publicResult, policyDecision, sourceEvidence),
    )
    writeJson(join(outDir, 'verifier-output.json'), verifierOutput)
    writeJson(join(outDir, 'redaction-manifest.json'), redactionManifest)
    writeJson(join(outDir, 'policy-decision.json'), policyDecision)
    if (sourceEvidence) writeJson(join(outDir, 'source-run-output.json'), sourceEvidence.sanitized)
  }

  return {
    result,
    verifierOutput,
    redactionManifest,
    policyDecision,
    artifact_dir: outDir ?? null,
  }
}

async function main(): Promise<void> {
  const packet = await runOpenEtrTransferPacket()
  const { result, policyDecision, artifact_dir } = packet
  console.log(
    JSON.stringify(
      {
        ...result,
        source_e2e: Boolean(
          (packet.verifierOutput as { openetr?: { source_e2e?: unknown } }).openetr?.source_e2e,
        ),
        policy_decision: {
          artifact: 'policy-decision.json',
          decision: policyDecision.decision,
          decision_hash: policyDecision.decision_hash,
        },
        artifact_dir,
      },
      null,
      2,
    ),
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
