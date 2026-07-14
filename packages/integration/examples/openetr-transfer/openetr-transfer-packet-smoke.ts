// SPDX-License-Identifier: Apache-2.0

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import canonicalize from 'canonicalize'
import * as ed from '@noble/ed25519'
import { sha512 } from '@noble/hashes/sha2.js'
import * as secp from '@noble/secp256k1'
import {
  hashText,
  runWrappedMcpPacket,
  type PacketActionPolicySummary,
  type PacketPolicyGateDecision,
  type PacketPolicyGateInput,
  type WrappedMcpPacketResult,
  writeJson,
} from '../wrapped-mcp-proof-runner.js'

ed.hashes.sha512 = sha512
ed.hashes.sha512Async = (message) => Promise.resolve(sha512(message))

const PRIVATE_OBJECT_DIGEST =
  'sha256:7f4b8b8e2f394fddad1ed04e94c456ff0c8fb7ee6f0c5d5017deac9a0f61d425'
const PRIVATE_DOCUMENT_TITLE = 'private warehouse receipt WR-2026-0628'
const PRIVATE_ISSUER_NPUB = 'npub1privateissueropenetr20260628'
const PRIVATE_BUYER_NPUB = 'npub1privatebuyeropenetr20260628'
const PRIVATE_RELAY = 'wss://relay.openetr.example/private-transfer'
const PRIVATE_ORIGIN_EVENT_ID = '1111111111111111111111111111111111111111111111111111111111111111'
const PRIVATE_INITIATE_EVENT_ID = '2222222222222222222222222222222222222222222222222222222222222222'
const PRIVATE_ACCEPT_EVENT_ID = '3333333333333333333333333333333333333333333333333333333333333333'
const RECOGNIZE_TOOL_NAME = 'openetr_recognize_title_transfer'
const OPENETR_POLICY_VERSION = 'openetr-transfer-policy-v1'
const TITLE_AUTHORITY_POLICY_ID = 'openetr-demo-title-authority-policy'
const OPENETR_TTA_EVENT_KIND = 31415
const TITLE_AUTHORITY_SEED = new Uint8Array(32).fill(217)
const LEGAL_ATTESTOR_SEED = new Uint8Array(32).fill(218)
const OPERATOR_DEMO_TTA_SEED = new Uint8Array(32).fill(219)
const OPERATOR_DEMO_LEGAL_ATTESTOR_SEED = new Uint8Array(32).fill(220)
const OPERATOR_DEMO_CREATED_AT = 1782604800

type PacketOptions = Parameters<typeof runWrappedMcpPacket>[0]
type OpenEtrSourceEvidence = ReturnType<typeof runOpenEtrSourceE2e>
type OpenEtrPublicRelayAvailability = Awaited<ReturnType<typeof runPublicRelayAvailability>>
type PolicyDecisionArtifact = ReturnType<typeof buildPolicyDecision>

type OpenEtrSourceEvent = {
  id?: string
  kind?: number
  created_at?: number
  pubkey?: string
  tags?: unknown[]
  content?: string
  sig?: string
}

type NostrEvent = {
  id: string
  pubkey: string
  created_at: number
  kind: number
  tags: string[][]
  content: string
  sig: string
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
  public_event_availability?: {
    schema?: string
    requested?: boolean
    publish_requested?: boolean
    status?: string
    relay_count?: number
    available_relay_count?: number
    event_roles?: string[]
    relays?: Array<{
      relay_url?: string
      relay_url_hash?: string
      exact_found_count?: number
      exact_found_all?: boolean
      events?: Array<{
        role?: string
        event_id?: string
        event_id_hash?: string
        kind?: number
        exact_found?: boolean
        returned_count?: number
        error?: string | null
      }>
    }>
  }
  checks?: Record<string, boolean>
  warnings?: unknown[]
}

type SignedExternalAttestation = {
  schema: 'atrib.openetr.signed_external_attestation.v1'
  kind: 'title_transfer_authority' | 'legal_mletr'
  key_id: string
  signer_public_key: string
  signer_public_key_hash: string
  statement_hash: string
  signature: string
  signature_valid: boolean
  statement: Record<string, unknown>
}

type MletrSourceChecklist = {
  schema: 'atrib.openetr.mletr_source_checklist.v1'
  status: 'source_backed_criteria_present' | 'missing_source_evidence'
  reviewed_at: string
  sources: Array<{
    id: string
    title: string
    url: string
    source_hash: string
    role: string
  }>
  criteria: Array<{
    id: string
    status: 'evidence_present' | 'requires_policy_or_legal_review' | 'missing_source_evidence'
    evidence: string
    source_ids: string[]
  }>
  limitation: string
}

type PublicTitleAuthorityEvidence = {
  schema: 'atrib.openetr.public_title_authority_evidence.v1'
  mode: 'external_public_tta' | 'operator_demo_tta' | 'fixture_attestation' | 'missing'
  status:
    | 'verified_recognized_tta_event'
    | 'operator_demo_tta_event'
    | 'fixture_attestation'
    | 'missing'
  title_kind: number
  event: ReturnType<typeof sanitizeTtaEvent> | null
  recognized_tta_pubkey_hashes: string[]
  event_id_valid: boolean
  signature_valid: boolean
  recognized_pubkey: boolean
  object_digest_hash_matches: boolean
  recognized_controller_pubkey_hash: string | null
  statement_hash: string | null
  limitations: string[]
}

type LegalMletrEvidence = {
  schema: 'atrib.openetr.legal_mletr_evidence.v1'
  mode:
    | 'external_signed_attestation'
    | 'operator_demo_attestation'
    | 'fixture_attestation'
    | 'missing'
  status:
    | 'external_attestation_verified'
    | 'operator_demo_attestation'
    | 'fixture_attestation'
    | 'missing'
  attestation: SignedExternalAttestation | null
  signer_recognized: boolean
  checklist_status: MletrSourceChecklist['status']
  statement_hash: string | null
  limitations: string[]
}

type ControllerSemanticsEvidence = {
  schema: 'atrib.openetr.controller_semantics_evidence.v1'
  status: 'resolved_by_authority_attestation' | 'unresolved'
  source_query_basis: string | null
  source_query_reports_buyer: boolean | null
  source_query_reports_initiator: boolean | null
  accept_p_tag_points_to_initiator: boolean | null
  authority_attests_acceptor_control: boolean
  caveat: string
}

type RecognitionEvidence = {
  schema: 'atrib.openetr.recognition_evidence.v1'
  full_fixture_requested: boolean
  operator_demo_requested: boolean
  public_relay_events_available: boolean
  title_authority: SignedExternalAttestation | null
  legal_mletr: SignedExternalAttestation | null
  title_authority_evidence: PublicTitleAuthorityEvidence
  legal_mletr_evidence: LegalMletrEvidence
  mletr_source_checklist: MletrSourceChecklist
  controller_semantics: ControllerSemanticsEvidence
  authorization_basis:
    | 'external_public_evidence'
    | 'operator_demo_evidence'
    | 'fixture_evidence'
    | 'missing_evidence'
  authorized_by_evidence: boolean
  authorized_by_fixture: boolean
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
  publicRelayAvailability: OpenEtrPublicRelayAvailability
  publicRelayEvidence: ReturnType<typeof buildPublicRelayArtifact>
  recognitionEvidence: RecognitionEvidence
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

function removeArtifactIfPresent(path: string): void {
  rmSync(path, { force: true })
}

function stableJsonHash(value: unknown): string {
  return hashText(JSON.stringify(value))
}

function sha256Hex(bytes: string | Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function hashSourceReference(input: { url: string; role: string }): string {
  return hashText(`${input.url}\n${input.role}`)
}

function truthyEnv(env: NodeJS.ProcessEnv, key: string): boolean {
  return env[key] === '1' || env[key]?.toLowerCase() === 'true'
}

function readJsonEnv(env: NodeJS.ProcessEnv, inlineKey: string, fileKey: string): unknown | null {
  const inlineValue = env[inlineKey]
  if (inlineValue && inlineValue.trim().length > 0) return JSON.parse(inlineValue)
  const filePath = env[fileKey]
  if (filePath && filePath.trim().length > 0) return JSON.parse(readFileSync(filePath, 'utf8'))
  return null
}

function parseRecognizedPubkeys(env: NodeJS.ProcessEnv, key: string): string[] {
  return (env[key] ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter((value) => /^[0-9a-f]{64}$/u.test(value))
}

function parseRecognizedKeyHashes(env: NodeJS.ProcessEnv, key: string): string[] {
  return (env[key] ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => /^sha256:[0-9a-f]{64}$/u.test(value))
}

function isNostrEvent(value: unknown): value is NostrEvent {
  if (!value || typeof value !== 'object') return false
  const event = value as Record<string, unknown>
  return (
    typeof event.id === 'string' &&
    typeof event.pubkey === 'string' &&
    typeof event.created_at === 'number' &&
    typeof event.kind === 'number' &&
    Array.isArray(event.tags) &&
    event.tags.every(
      (tag) => Array.isArray(tag) && tag.every((item) => typeof item === 'string'),
    ) &&
    typeof event.content === 'string' &&
    typeof event.sig === 'string'
  )
}

function sanitizeTtaEvent(event: NostrEvent | null) {
  if (!event) return null
  return {
    event_id_hash: hashText(event.id),
    pubkey_hash: hashText(event.pubkey),
    kind: event.kind,
    created_at: event.created_at,
    content_hash: hashText(event.content),
    tag_names: event.tags.map((tag) => tag[0]).filter((tagName) => Boolean(tagName)),
    d_tag_hash: sourceTagValue(event, 'd') ? hashText(sourceTagValue(event, 'd') ?? '') : null,
    o_tag_hash: sourceTagValue(event, 'o') ? hashText(sourceTagValue(event, 'o') ?? '') : null,
    p_tag_hash: sourceTagValue(event, 'p') ? hashText(sourceTagValue(event, 'p') ?? '') : null,
    from_tag_hash: sourceTagValue(event, 'from')
      ? hashText(sourceTagValue(event, 'from') ?? '')
      : null,
    prior_tta_event_id_hash: sourceTagValue(event, 'e')
      ? hashText(sourceTagValue(event, 'e') ?? '')
      : null,
    action: sourceTagValue(event, 'action'),
  }
}

function deriveNostrEventId(event: Omit<NostrEvent, 'id' | 'sig'>): string {
  return sha256Hex(
    new TextEncoder().encode(
      JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content]),
    ),
  )
}

async function verifyNostrEventSignature(event: NostrEvent): Promise<boolean> {
  if (!/^[0-9a-f]{64}$/u.test(event.id)) return false
  if (!/^[0-9a-f]{64}$/u.test(event.pubkey)) return false
  if (!/^[0-9a-f]{128}$/u.test(event.sig)) return false
  try {
    return await secp.schnorr.verifyAsync(
      Buffer.from(event.sig, 'hex'),
      Buffer.from(event.id, 'hex'),
      Buffer.from(event.pubkey, 'hex'),
    )
  } catch {
    return false
  }
}

async function signNostrEvent(
  unsignedEvent: Omit<NostrEvent, 'id' | 'sig'>,
  privateKey: Uint8Array,
): Promise<NostrEvent> {
  const id = deriveNostrEventId(unsignedEvent)
  const sig = await secp.schnorr.signAsync(Buffer.from(id, 'hex'), privateKey)
  return {
    ...unsignedEvent,
    id,
    sig: Buffer.from(sig).toString('hex'),
  }
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

function sanitizePublicEventAvailability(sourceRun: OpenEtrSourceRun) {
  const availability = sourceRun.public_event_availability
  if (!availability) return null
  return {
    schema: 'atrib.openetr.public_event_availability_summary.v1',
    requested: Boolean(availability.requested),
    publish_requested: Boolean(availability.publish_requested),
    status: availability.status ?? 'unknown',
    relay_count: availability.relay_count ?? 0,
    available_relay_count: availability.available_relay_count ?? 0,
    event_roles: availability.event_roles ?? [],
    relays:
      availability.relays?.map((relay) => ({
        relay_url_hash:
          relay.relay_url_hash ?? (relay.relay_url ? hashText(relay.relay_url) : null),
        exact_found_count: relay.exact_found_count ?? 0,
        exact_found_all: Boolean(relay.exact_found_all),
        events:
          relay.events?.map((event) => ({
            role: event.role ?? null,
            event_id_hash:
              event.event_id_hash ?? (event.event_id ? hashText(event.event_id) : null),
            kind: event.kind ?? null,
            exact_found: Boolean(event.exact_found),
            returned_count: event.returned_count ?? 0,
            error: event.error ?? null,
          })) ?? [],
      })) ?? [],
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
    public_event_availability: sanitizePublicEventAvailability(sourceRun),
    checks: sourceRun.checks ?? {},
    warnings: sourceRun.warnings ?? [],
  }
}

function publicControlRecord(
  actionPolicy: PacketActionPolicySummary | undefined,
  kind: 'policy_decision' | 'policy_outcome',
) {
  const record = actionPolicy?.[kind === 'policy_decision' ? 'decisions' : 'outcomes'].find(
    (entry) => entry.tool_name === RECOGNIZE_TOOL_NAME,
  )
  if (!record) return null
  return {
    kind: record.kind,
    tool_name: record.tool_name,
    event_type: record.event_type,
    record_hash: record.record_hash,
    chain_root: record.chain_root,
    informed_by: record.informed_by,
    args_hash: record.args_hash,
    record_valid: record.record_valid,
    content: record.content,
    proof: record.proof,
  }
}

function createOpenEtrTitleRecognitionPolicyGate(recognition: RecognitionEvidence) {
  return (input: PacketPolicyGateInput): PacketPolicyGateDecision | undefined => {
    if (input.call.name !== RECOGNIZE_TOOL_NAME) return undefined
    const decision = recognition.authorized_by_evidence ? 'allow' : 'escalate'
    const missingReasonCodes = [
      ...(recognition.public_relay_events_available
        ? []
        : ['public_relay_event_availability_missing']),
      ...(recognition.title_authority_evidence.status !== 'missing'
        ? []
        : ['title_transfer_authority_missing']),
      ...(recognition.legal_mletr_evidence.status !== 'missing'
        ? []
        : ['mletr_legal_conclusion_missing']),
      ...(recognition.controller_semantics.status === 'resolved_by_authority_attestation'
        ? []
        : ['controller_semantics_review_required']),
    ]
    return {
      decision,
      policy_version: OPENETR_POLICY_VERSION,
      reason_codes:
        decision === 'allow'
          ? [
              'public_relay_event_availability_present',
              'title_transfer_authority_attested',
              'legal_mletr_attested',
              'controller_semantics_resolved',
            ]
          : missingReasonCodes,
      content: {
        schema: 'atrib.openetr.title_recognition_policy_decision.v1',
        proposed_action: 'recognize_transfer',
        action_tool: RECOGNIZE_TOOL_NAME,
        packet: input.packet,
        completed_calls: input.completed_calls,
        previous_record_hashes: input.previous_records.map((entry) => entry.record_hash),
        recognition_evidence: {
          full_fixture_requested: recognition.full_fixture_requested,
          operator_demo_requested: recognition.operator_demo_requested,
          public_relay_events_available: recognition.public_relay_events_available,
          authorization_basis: recognition.authorization_basis,
          authorized_by_evidence: recognition.authorized_by_evidence,
          title_authority_statement_hash:
            recognition.title_authority_evidence.statement_hash ??
            recognition.title_authority?.statement_hash ??
            null,
          legal_mletr_statement_hash:
            recognition.legal_mletr_evidence.statement_hash ??
            recognition.legal_mletr?.statement_hash ??
            null,
          controller_semantics_status: recognition.controller_semantics.status,
        },
        evidence_requirements: {
          public_nostr_relay_availability:
            'OpenETR issue, initiate, accept, and query events must be available from selected public relays.',
          title_transfer_authority:
            'A configured title-transfer authority or recognized attestor must sign the control decision or atrib bytes.',
          legal_title_transfer:
            'A jurisdiction-specific legal reviewer or relying-party policy must attest the legal effect.',
          mletr_compliance:
            'A legal or policy attestation must map the evidence to MLETR functional-equivalence requirements.',
          controller_semantics:
            'The verifier must resolve the OpenETR p-tag controller ambiguity instead of reading latest p tag as title control.',
        },
      },
    }
  }
}

function publicRelayUrls(env: NodeJS.ProcessEnv): string[] {
  return (env.OPENETR_PUBLIC_RELAY_URLS ?? '')
    .split(',')
    .map((url) => url.trim())
    .filter((url) => url.length > 0)
}

async function probePublicRelay(url: string, timeoutMs: number) {
  const startedAt = Date.now()
  const relay = {
    url_hash: hashText(url),
    connected: false,
    nostr_response_observed: false,
    response_type: null as string | null,
    error: null as string | null,
    elapsed_ms: 0,
  }

  if (typeof WebSocket !== 'function') {
    return {
      ...relay,
      error: 'websocket_unavailable_in_node_runtime',
      elapsed_ms: Date.now() - startedAt,
    }
  }

  return await new Promise<typeof relay>((resolve) => {
    let settled = false
    let socket: WebSocket | null = null
    const finish = (patch: Partial<typeof relay>) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        socket?.close()
      } catch {
        // Ignore close races after network failures.
      }
      resolve({ ...relay, ...patch, elapsed_ms: Date.now() - startedAt })
    }
    const timer = setTimeout(() => finish({ error: 'timeout_waiting_for_relay' }), timeoutMs)
    try {
      socket = new WebSocket(url)
    } catch (err) {
      finish({ error: err instanceof Error ? err.message : 'websocket_constructor_failed' })
      return
    }
    socket.addEventListener('open', () => {
      relay.connected = true
      const subscriptionId = `atrib-openetr-availability-${Date.now()}`
      socket?.send(JSON.stringify(['REQ', subscriptionId, { kinds: [31415, 31416], limit: 1 }]))
    })
    socket.addEventListener('message', (event) => {
      const text = typeof event.data === 'string' ? event.data : ''
      try {
        const parsed = JSON.parse(text) as unknown
        const responseType =
          Array.isArray(parsed) && typeof parsed[0] === 'string' ? parsed[0] : null
        finish({
          connected: true,
          nostr_response_observed: responseType !== null,
          response_type: responseType,
        })
      } catch {
        finish({
          connected: true,
          nostr_response_observed: false,
          error: 'non_json_relay_response',
        })
      }
    })
    socket.addEventListener('error', () => {
      finish({ connected: relay.connected, error: 'websocket_error' })
    })
    socket.addEventListener('close', () => {
      finish({
        connected: relay.connected,
        error: relay.connected ? 'closed_before_nostr_response' : 'closed_before_open',
      })
    })
  })
}

async function runPublicRelayAvailability(env: NodeJS.ProcessEnv) {
  const urls = publicRelayUrls(env)
  const timeoutMs = Number(env.OPENETR_PUBLIC_RELAY_TIMEOUT_MS ?? 5000)
  if (urls.length === 0) {
    return {
      schema: 'atrib.openetr.public_relay_availability.v1',
      requested: false,
      status: 'not_requested',
      checked_at_ms: null,
      relay_count: 0,
      reachable_count: 0,
      relays: [],
      caveat:
        'Set OPENETR_PUBLIC_RELAY_URLS to probe public Nostr relay availability for OpenETR event kinds.',
    }
  }

  const relays = await Promise.all(urls.map((url) => probePublicRelay(url, timeoutMs)))
  const reachableCount = relays.filter(
    (relay) => relay.connected && relay.nostr_response_observed,
  ).length
  return {
    schema: 'atrib.openetr.public_relay_availability.v1',
    requested: true,
    status: reachableCount > 0 ? 'available' : 'unavailable',
    checked_at_ms: Date.now(),
    relay_count: relays.length,
    reachable_count: reachableCount,
    relays,
    caveat:
      'This proves relay WebSocket and Nostr REQ response availability, not that the OpenETR transfer events were published to a public relay.',
  }
}

function canonicalBytes(value: unknown): Uint8Array {
  const canonical = canonicalize(value)
  if (typeof canonical !== 'string') throw new Error('value is not JCS-canonicalizable JSON')
  return new TextEncoder().encode(canonical)
}

function recognitionFixtureRequested(env: NodeJS.ProcessEnv): boolean {
  return (
    truthyEnv(env, 'OPENETR_FULL_RECOGNITION_FIXTURE') ||
    (truthyEnv(env, 'OPENETR_TITLE_AUTHORITY_FIXTURE') &&
      truthyEnv(env, 'OPENETR_LEGAL_MLETR_FIXTURE'))
  )
}

function operatorDemoRequested(env: NodeJS.ProcessEnv): boolean {
  return (
    truthyEnv(env, 'OPENETR_OPERATOR_DEMO_TTA') &&
    truthyEnv(env, 'OPENETR_OPERATOR_DEMO_LEGAL_ATTESTOR')
  )
}

function titleAuthorityKind(env: NodeJS.ProcessEnv): number {
  return Number(env.OPENETR_TITLE_AUTHORITY_KIND ?? OPENETR_TTA_EVENT_KIND)
}

function sourcePublicEventsAvailable(sourceEvidence: OpenEtrSourceEvidence): boolean {
  return sourceEvidence?.sanitized.public_event_availability?.status === 'available'
}

async function signedExternalAttestation(input: {
  kind: SignedExternalAttestation['kind']
  keyId: string
  seed: Uint8Array
  statement: Record<string, unknown>
}): Promise<SignedExternalAttestation> {
  const bytes = canonicalBytes(input.statement)
  const signature = await ed.signAsync(bytes, input.seed)
  const publicKey = await ed.getPublicKeyAsync(input.seed)
  return {
    schema: 'atrib.openetr.signed_external_attestation.v1',
    kind: input.kind,
    key_id: input.keyId,
    signer_public_key: Buffer.from(publicKey).toString('base64url'),
    signer_public_key_hash: hashText(Buffer.from(publicKey).toString('base64url')),
    statement_hash: hashText(new TextDecoder().decode(bytes)),
    signature: Buffer.from(signature).toString('base64url'),
    signature_valid: await ed.verifyAsync(signature, bytes, publicKey),
    statement: input.statement,
  }
}

function isSignedExternalAttestation(value: unknown): value is SignedExternalAttestation {
  if (!value || typeof value !== 'object') return false
  const attestation = value as Record<string, unknown>
  return (
    attestation.schema === 'atrib.openetr.signed_external_attestation.v1' &&
    (attestation.kind === 'title_transfer_authority' || attestation.kind === 'legal_mletr') &&
    typeof attestation.key_id === 'string' &&
    typeof attestation.signer_public_key === 'string' &&
    typeof attestation.signer_public_key_hash === 'string' &&
    typeof attestation.statement_hash === 'string' &&
    typeof attestation.signature === 'string' &&
    typeof attestation.signature_valid === 'boolean' &&
    Boolean(attestation.statement) &&
    typeof attestation.statement === 'object'
  )
}

async function verifySignedExternalAttestation(
  value: unknown,
  expectedKind: SignedExternalAttestation['kind'],
): Promise<SignedExternalAttestation | null> {
  if (!isSignedExternalAttestation(value) || value.kind !== expectedKind) return null
  const statementBytes = canonicalBytes(value.statement)
  const statementHash = hashText(new TextDecoder().decode(statementBytes))
  const publicKey = Buffer.from(value.signer_public_key, 'base64url')
  const signature = Buffer.from(value.signature, 'base64url')
  const signatureValid = await ed.verifyAsync(signature, statementBytes, publicKey)
  return {
    ...value,
    signer_public_key_hash: hashText(value.signer_public_key),
    statement_hash: statementHash,
    signature_valid:
      signatureValid &&
      statementHash === value.statement_hash &&
      hashText(value.signer_public_key) === value.signer_public_key_hash,
  }
}

function buildMletrSourceChecklist(sourceEvidence: OpenEtrSourceEvidence): MletrSourceChecklist {
  const sources = [
    {
      id: 'openetr-tta-spec',
      title: 'OpenETR Title Transfer Authority Replaceable Event Specification',
      url: 'https://github.com/trbouma/openetr/blob/main/docs/specs/TITLE_TRANSFER_AUTHORITY_REPLACEABLE_EVENT_SPEC.md',
      role: 'Defines recognized TTA pubkeys, replaceable event state, title holder p tags, and validation rules.',
    },
    {
      id: 'openetr-transaction-spec',
      title: 'OpenETR Canonical ETR Transaction Specification',
      url: 'https://github.com/trbouma/openetr/blob/main/docs/specs/CANONICAL_ETR_TRANSACTION_SPEC.md',
      role: 'Defines control-relevant actions, attestation, recognition policy, and signed evidence chains.',
    },
    {
      id: 'uncitral-mletr',
      title: 'UNCITRAL Model Law on Electronic Transferable Records',
      url: 'https://uncitral.un.org/en/texts/ecommerce/modellaw/electronic_transferable_records',
      role: 'Public model-law source for electronic transferable record functional-equivalence criteria.',
    },
    {
      id: 'tradetrust-mletr-title-transfer',
      title: 'TradeTrust MLETR-compliant titles transfer white paper',
      url: 'https://www.tradetrust.io/happenings-and-resources/white-paper-transfer-of-model-law-on-electronic-transferable-records-compliant-titles/',
      role: 'Public implementation-oriented source on MLETR-compliant electronic title transfer.',
    },
  ].map((source) => ({
    ...source,
    source_hash: hashSourceReference(source),
  }))
  const hasSource = Boolean(sourceEvidence)
  return {
    schema: 'atrib.openetr.mletr_source_checklist.v1',
    status: hasSource ? 'source_backed_criteria_present' : 'missing_source_evidence',
    reviewed_at: '2026-06-28',
    sources,
    criteria: [
      {
        id: 'electronic_record_identifiable',
        status: hasSource ? 'evidence_present' : 'missing_source_evidence',
        evidence: hasSource
          ? 'The source-backed run exposes a digest-identified OpenETR object and records only a hash of that digest in public artifacts.'
          : 'No source-backed OpenETR object evidence was supplied.',
        source_ids: ['openetr-tta-spec', 'openetr-transaction-spec'],
      },
      {
        id: 'integrity_history_available',
        status: hasSource ? 'evidence_present' : 'missing_source_evidence',
        evidence: hasSource
          ? 'The source-backed run executed issue, transfer initiate, transfer accept, and query, then committed sanitized event hashes and chain checks.'
          : 'No source-backed OpenETR event chain was supplied.',
        source_ids: ['openetr-transaction-spec'],
      },
      {
        id: 'exclusive_control_evidence',
        status: hasSource ? 'requires_policy_or_legal_review' : 'missing_source_evidence',
        evidence: hasSource
          ? 'The packet can show a recognized TTA or operator-demo signer naming the controller, but final control recognition remains a policy or legal decision.'
          : 'No recognized signer evidence was supplied.',
        source_ids: ['openetr-tta-spec', 'uncitral-mletr', 'tradetrust-mletr-title-transfer'],
      },
      {
        id: 'reliable_method_boundary',
        status: hasSource ? 'requires_policy_or_legal_review' : 'missing_source_evidence',
        evidence: hasSource
          ? 'The cryptographic and relay evidence gives reviewable inputs for a reliability analysis, but this artifact does not decide jurisdictional sufficiency.'
          : 'No source-backed reliability inputs were supplied.',
        source_ids: ['uncitral-mletr', 'tradetrust-mletr-title-transfer'],
      },
      {
        id: 'legal_effect_requires_relying_party_or_law',
        status: hasSource ? 'requires_policy_or_legal_review' : 'missing_source_evidence',
        evidence: hasSource
          ? 'The checklist records criteria evidence only. A relying party, TTA, or legal reviewer must decide legal effect.'
          : 'No legal reviewer or relying-party attestation was supplied.',
        source_ids: ['uncitral-mletr', 'openetr-transaction-spec'],
      },
    ],
    limitation:
      'This checklist is source-backed criteria evidence for review. It is not legal advice, a registry act, or an MLETR compliance opinion.',
  }
}

function digestTagMatches(tagValue: string | null, sourceDigest: string | null): boolean {
  if (!tagValue || !sourceDigest) return false
  return tagValue === sourceDigest || tagValue === sourceDigest.replace(/^sha256:/u, '')
}

function sourceBuyerPubkeyHex(sourceEvidence: OpenEtrSourceEvidence): string | null {
  return sourceEvidence?.raw.parties?.buyer_pubkey_hex ?? null
}

async function operatorDemoTtaEvent(
  sourceEvidence: OpenEtrSourceEvidence,
): Promise<NostrEvent | null> {
  const objectDigest = sourceEvidence?.raw.object?.digest
  const buyerPubkey = sourceBuyerPubkeyHex(sourceEvidence)
  if (!objectDigest || !buyerPubkey) return null
  const pubkey = Buffer.from(secp.schnorr.getPublicKey(OPERATOR_DEMO_TTA_SEED)).toString('hex')
  return await signNostrEvent(
    {
      pubkey,
      created_at: OPERATOR_DEMO_CREATED_AT,
      kind: OPENETR_TTA_EVENT_KIND,
      tags: [
        ['d', objectDigest],
        ['o', objectDigest],
        ['p', buyerPubkey],
        ['from', sourceEvidence?.raw.parties?.issuer_pubkey_hex ?? 'unknown'],
        ['e', sourceEvidence?.raw.events?.accept?.id ?? 'unknown'],
        ['action', 'transfer'],
        ['version', '1'],
        ['authority_policy_id', TITLE_AUTHORITY_POLICY_ID],
        ['jurisdiction', 'operator-demo'],
      ],
      content: 'Operator demo TTA recognizes this source-backed OpenETR transfer for proof review.',
    },
    OPERATOR_DEMO_TTA_SEED,
  )
}

async function buildPublicTitleAuthorityEvidence(input: {
  env: NodeJS.ProcessEnv
  sourceEvidence: OpenEtrSourceEvidence
  fullFixtureRequested: boolean
  fixtureAttestation: SignedExternalAttestation | null
}): Promise<PublicTitleAuthorityEvidence> {
  const kind = titleAuthorityKind(input.env)
  const recognizedPubkeys = parseRecognizedPubkeys(input.env, 'OPENETR_RECOGNIZED_TTA_PUBKEYS')
  const rawExternalEvent = readJsonEnv(
    input.env,
    'OPENETR_TITLE_AUTHORITY_NOSTR_EVENT_JSON',
    'OPENETR_TITLE_AUTHORITY_NOSTR_EVENT_FILE',
  )
  const sourceDigest = input.sourceEvidence?.raw.object?.digest ?? null
  const buyerPubkey = sourceBuyerPubkeyHex(input.sourceEvidence)

  if (isNostrEvent(rawExternalEvent)) {
    const eventIdValid = rawExternalEvent.id === deriveNostrEventId(rawExternalEvent)
    const signatureValid = eventIdValid && (await verifyNostrEventSignature(rawExternalEvent))
    const recognizedPubkey = recognizedPubkeys.includes(rawExternalEvent.pubkey.toLowerCase())
    const objectDigestMatches =
      digestTagMatches(sourceTagValue(rawExternalEvent, 'd'), sourceDigest) ||
      digestTagMatches(sourceTagValue(rawExternalEvent, 'o'), sourceDigest)
    const controllerPubkey = sourceTagValue(rawExternalEvent, 'p')
    const controllerMatches = Boolean(controllerPubkey && buyerPubkey === controllerPubkey)
    const usable =
      rawExternalEvent.kind === kind &&
      eventIdValid &&
      signatureValid &&
      recognizedPubkey &&
      objectDigestMatches &&
      controllerMatches
    return {
      schema: 'atrib.openetr.public_title_authority_evidence.v1',
      mode: 'external_public_tta',
      status: usable ? 'verified_recognized_tta_event' : 'missing',
      title_kind: kind,
      event: sanitizeTtaEvent(rawExternalEvent),
      recognized_tta_pubkey_hashes: recognizedPubkeys.map((pubkey) => hashText(pubkey)),
      event_id_valid: eventIdValid,
      signature_valid: signatureValid,
      recognized_pubkey: recognizedPubkey,
      object_digest_hash_matches: objectDigestMatches,
      recognized_controller_pubkey_hash:
        controllerMatches && controllerPubkey ? hashText(controllerPubkey) : null,
      statement_hash: hashText(JSON.stringify(sanitizeTtaEvent(rawExternalEvent))),
      limitations: usable
        ? [
            'External TTA event verified under configured recognized pubkeys.',
            'This proves signer recognition under local policy, not jurisdictional legal effect.',
          ]
        : ['External TTA event was supplied but did not satisfy every recognition check.'],
    }
  }

  if (operatorDemoRequested(input.env)) {
    const event = await operatorDemoTtaEvent(input.sourceEvidence)
    if (event) {
      const eventIdValid = event.id === deriveNostrEventId(event)
      const signatureValid = eventIdValid && (await verifyNostrEventSignature(event))
      const controllerPubkey = sourceTagValue(event, 'p')
      const objectDigestMatches =
        digestTagMatches(sourceTagValue(event, 'd'), sourceDigest) ||
        digestTagMatches(sourceTagValue(event, 'o'), sourceDigest)
      return {
        schema: 'atrib.openetr.public_title_authority_evidence.v1',
        mode: 'operator_demo_tta',
        status: 'operator_demo_tta_event',
        title_kind: OPENETR_TTA_EVENT_KIND,
        event: sanitizeTtaEvent(event),
        recognized_tta_pubkey_hashes: [hashText(event.pubkey)],
        event_id_valid: eventIdValid,
        signature_valid: signatureValid,
        recognized_pubkey: true,
        object_digest_hash_matches: objectDigestMatches,
        recognized_controller_pubkey_hash: controllerPubkey ? hashText(controllerPubkey) : null,
        statement_hash: hashText(JSON.stringify(sanitizeTtaEvent(event))),
        limitations: [
          'Operator-demo TTA evidence uses a local demo signer, not an independent title registry.',
          'It exercises the same Nostr event ID, signature, digest, controller, and recognized-pubkey checks as external TTA ingestion.',
        ],
      }
    }
  }

  if (input.fixtureAttestation?.signature_valid && input.fullFixtureRequested) {
    return {
      schema: 'atrib.openetr.public_title_authority_evidence.v1',
      mode: 'fixture_attestation',
      status: 'fixture_attestation',
      title_kind: kind,
      event: null,
      recognized_tta_pubkey_hashes: [input.fixtureAttestation.signer_public_key_hash],
      event_id_valid: false,
      signature_valid: true,
      recognized_pubkey: true,
      object_digest_hash_matches: true,
      recognized_controller_pubkey_hash:
        input.sourceEvidence?.sanitized.parties.buyer_pubkey_hash ?? null,
      statement_hash: input.fixtureAttestation.statement_hash,
      limitations: [
        'Fixture title-authority evidence is deterministic local proof evidence.',
        'It is not an external public TTA event or title registry decision.',
      ],
    }
  }

  return {
    schema: 'atrib.openetr.public_title_authority_evidence.v1',
    mode: 'missing',
    status: 'missing',
    title_kind: kind,
    event: null,
    recognized_tta_pubkey_hashes: recognizedPubkeys.map((pubkey) => hashText(pubkey)),
    event_id_valid: false,
    signature_valid: false,
    recognized_pubkey: false,
    object_digest_hash_matches: false,
    recognized_controller_pubkey_hash: null,
    statement_hash: null,
    limitations: [
      'No external TTA Nostr event, operator-demo TTA event, or fixture title attestation was accepted.',
    ],
  }
}

async function buildLegalMletrEvidence(input: {
  env: NodeJS.ProcessEnv
  checklist: MletrSourceChecklist
  fixtureAttestation: SignedExternalAttestation | null
  fullFixtureRequested: boolean
}): Promise<LegalMletrEvidence> {
  const rawExternal = readJsonEnv(
    input.env,
    'OPENETR_LEGAL_MLETR_ATTESTATION_JSON',
    'OPENETR_LEGAL_MLETR_ATTESTATION_FILE',
  )
  const recognizedSignerHashes = parseRecognizedKeyHashes(
    input.env,
    'OPENETR_RECOGNIZED_LEGAL_SIGNER_KEY_HASHES',
  )
  const external = await verifySignedExternalAttestation(rawExternal, 'legal_mletr')
  if (external) {
    const signerRecognized = recognizedSignerHashes.includes(external.signer_public_key_hash)
    const usable = external.signature_valid && signerRecognized
    return {
      schema: 'atrib.openetr.legal_mletr_evidence.v1',
      mode: 'external_signed_attestation',
      status: usable ? 'external_attestation_verified' : 'missing',
      attestation: external,
      signer_recognized: signerRecognized,
      checklist_status: input.checklist.status,
      statement_hash: external.statement_hash,
      limitations: usable
        ? [
            'External legal/MLETR attestation verified under configured recognized signer hashes.',
            'The verifier records who made the claim. It does not independently give legal advice.',
          ]
        : [
            'External legal/MLETR attestation was supplied but signer recognition or signature validation failed.',
          ],
    }
  }

  if (truthyEnv(input.env, 'OPENETR_OPERATOR_DEMO_LEGAL_ATTESTOR')) {
    const statement = {
      schema: 'atrib.openetr.legal_mletr_statement.v1',
      scope: 'operator_demo_source_checklist',
      jurisdiction: input.env.OPENETR_LEGAL_JURISDICTION ?? 'operator-demo-review',
      proposed_action: 'recognize_transfer',
      checklist_status: input.checklist.status,
      checklist_hash: stableJsonHash(input.checklist),
      criteria: input.checklist.criteria.map((criterion) => ({
        id: criterion.id,
        status: criterion.status,
      })),
      limitation:
        'Operator-demo legal/MLETR attestation for protocol testing. It is not legal advice or a jurisdictional legal opinion.',
    }
    const attestation = await signedExternalAttestation({
      kind: 'legal_mletr',
      keyId: 'openetr-operator-demo-legal-mletr-attestor-ed25519',
      seed: OPERATOR_DEMO_LEGAL_ATTESTOR_SEED,
      statement,
    })
    return {
      schema: 'atrib.openetr.legal_mletr_evidence.v1',
      mode: 'operator_demo_attestation',
      status: 'operator_demo_attestation',
      attestation,
      signer_recognized: true,
      checklist_status: input.checklist.status,
      statement_hash: attestation.statement_hash,
      limitations: [
        'Operator-demo legal evidence signs the source checklist with a local demo reviewer key.',
        'It is not an independent legal opinion or MLETR compliance certification.',
      ],
    }
  }

  if (input.fixtureAttestation?.signature_valid && input.fullFixtureRequested) {
    return {
      schema: 'atrib.openetr.legal_mletr_evidence.v1',
      mode: 'fixture_attestation',
      status: 'fixture_attestation',
      attestation: input.fixtureAttestation,
      signer_recognized: true,
      checklist_status: input.checklist.status,
      statement_hash: input.fixtureAttestation.statement_hash,
      limitations: [
        'Fixture legal/MLETR evidence is deterministic local proof evidence.',
        'It is not an independent legal opinion or MLETR compliance certification.',
      ],
    }
  }

  return {
    schema: 'atrib.openetr.legal_mletr_evidence.v1',
    mode: 'missing',
    status: 'missing',
    attestation: null,
    signer_recognized: false,
    checklist_status: input.checklist.status,
    statement_hash: null,
    limitations: ['No external, operator-demo, or fixture legal/MLETR attestation was accepted.'],
  }
}

function controllerSemanticsEvidence(
  sourceEvidence: OpenEtrSourceEvidence,
  authorityAttests: boolean,
): ControllerSemanticsEvidence {
  const checks = sourceEvidence?.sanitized.checks ?? {}
  const sourceQueryReportsBuyer =
    typeof checks.query_controller_is_buyer === 'boolean' ? checks.query_controller_is_buyer : null
  const sourceQueryReportsInitiator =
    typeof checks.query_controller_is_initiator === 'boolean'
      ? checks.query_controller_is_initiator
      : null
  const acceptPTagPointsToInitiator =
    typeof checks.accept_p_tag_matches_initiator === 'boolean'
      ? checks.accept_p_tag_matches_initiator
      : null
  return {
    schema: 'atrib.openetr.controller_semantics_evidence.v1',
    status: authorityAttests ? 'resolved_by_authority_attestation' : 'unresolved',
    source_query_basis: sourceEvidence?.sanitized.query.current_controller_basis ?? null,
    source_query_reports_buyer: sourceQueryReportsBuyer,
    source_query_reports_initiator: sourceQueryReportsInitiator,
    accept_p_tag_points_to_initiator: acceptPTagPointsToInitiator,
    authority_attests_acceptor_control: authorityAttests,
    caveat: authorityAttests
      ? 'Authority attestation resolves title-recognition policy without treating the latest p tag as controller semantics.'
      : 'OpenETR query still reports initiator after accept in the reviewed source run.',
  }
}

async function buildRecognitionEvidence(
  env: NodeJS.ProcessEnv,
  sourceEvidence: OpenEtrSourceEvidence,
): Promise<RecognitionEvidence> {
  const fullFixtureRequested = recognitionFixtureRequested(env)
  const operatorRequested = operatorDemoRequested(env)
  const publicRelayEventsAvailable = sourcePublicEventsAvailable(sourceEvidence)
  const fixtureCanAttest =
    fullFixtureRequested && publicRelayEventsAvailable && Boolean(sourceEvidence)
  const acceptEvent = sourceEvidence?.sanitized.events.find(
    (event) => event.role === 'transfer_accept',
  )
  const buyerPubkeyHash = sourceEvidence?.sanitized.parties.buyer_pubkey_hash ?? null
  const titleStatement = {
    schema: 'atrib.openetr.title_authority_statement.v1',
    scope: 'fixture_attestation',
    authority_policy_id: TITLE_AUTHORITY_POLICY_ID,
    proposed_action: 'recognize_transfer',
    event_family: [31415, 31416],
    transfer_accept_event_hash: acceptEvent?.event_id_hash ?? null,
    recognized_controller_pubkey_hash: buyerPubkeyHash,
    public_relay_events_available: publicRelayEventsAvailable,
    source_commit: sourceEvidence?.raw.source?.commit ?? null,
    limitation: 'Fixture authority recognition. Not a real title registry or legal authority.',
  }
  const legalStatement = {
    schema: 'atrib.openetr.legal_mletr_statement.v1',
    scope: 'fixture_attestation',
    jurisdiction: env.OPENETR_LEGAL_JURISDICTION ?? 'MLETR-model-law-fixture',
    proposed_action: 'recognize_transfer',
    criteria: [
      {
        id: 'electronic_record_identifiable',
        status: sourceEvidence ? 'attested_by_fixture' : 'missing_source_evidence',
      },
      {
        id: 'exclusive_control_evidence',
        status: fixtureCanAttest ? 'attested_by_fixture_authority' : 'missing_authority',
      },
      {
        id: 'integrity_and_transfer_history',
        status: sourceEvidence ? 'attested_by_fixture' : 'missing_source_evidence',
      },
    ],
    public_relay_events_available: publicRelayEventsAvailable,
    limitation:
      'Fixture legal/MLETR attestation for protocol testing. It is not legal advice or a jurisdictional legal opinion.',
  }
  const titleAuthorityFixture = fixtureCanAttest
    ? await signedExternalAttestation({
        kind: 'title_transfer_authority',
        keyId: 'openetr-demo-title-authority-ed25519',
        seed: TITLE_AUTHORITY_SEED,
        statement: titleStatement,
      })
    : null
  const legalMletrFixture = fixtureCanAttest
    ? await signedExternalAttestation({
        kind: 'legal_mletr',
        keyId: 'openetr-demo-legal-mletr-attestor-ed25519',
        seed: LEGAL_ATTESTOR_SEED,
        statement: legalStatement,
      })
    : null
  const checklist = buildMletrSourceChecklist(sourceEvidence)
  const titleEvidence = await buildPublicTitleAuthorityEvidence({
    env,
    sourceEvidence,
    fullFixtureRequested,
    fixtureAttestation: titleAuthorityFixture,
  })
  const legalEvidence = await buildLegalMletrEvidence({
    env,
    checklist,
    fixtureAttestation: legalMletrFixture,
    fullFixtureRequested,
  })
  const titleAccepted =
    publicRelayEventsAvailable &&
    titleEvidence.signature_valid &&
    titleEvidence.recognized_pubkey &&
    titleEvidence.object_digest_hash_matches &&
    titleEvidence.status !== 'missing'
  const legalAccepted =
    publicRelayEventsAvailable &&
    Boolean(legalEvidence.attestation?.signature_valid) &&
    legalEvidence.signer_recognized &&
    legalEvidence.status !== 'missing'
  const externalAccepted =
    titleEvidence.mode === 'external_public_tta' &&
    legalEvidence.mode === 'external_signed_attestation' &&
    titleAccepted &&
    legalAccepted
  const operatorAccepted =
    titleEvidence.mode === 'operator_demo_tta' &&
    legalEvidence.mode === 'operator_demo_attestation' &&
    titleAccepted &&
    legalAccepted
  const fixtureAccepted =
    titleEvidence.mode === 'fixture_attestation' &&
    legalEvidence.mode === 'fixture_attestation' &&
    titleAccepted &&
    legalAccepted
  const authorizationBasis = externalAccepted
    ? 'external_public_evidence'
    : operatorAccepted
      ? 'operator_demo_evidence'
      : fixtureAccepted
        ? 'fixture_evidence'
        : 'missing_evidence'
  const authorizedByEvidence = externalAccepted || operatorAccepted || fixtureAccepted
  const controller = controllerSemanticsEvidence(sourceEvidence, titleAccepted)
  return {
    schema: 'atrib.openetr.recognition_evidence.v1',
    full_fixture_requested: fullFixtureRequested,
    operator_demo_requested: operatorRequested,
    public_relay_events_available: publicRelayEventsAvailable,
    title_authority: titleAuthorityFixture,
    legal_mletr: legalEvidence.attestation,
    title_authority_evidence: titleEvidence,
    legal_mletr_evidence: legalEvidence,
    mletr_source_checklist: checklist,
    controller_semantics: controller,
    authorization_basis: authorizationBasis,
    authorized_by_evidence: authorizedByEvidence,
    authorized_by_fixture:
      fixtureAccepted && controller.status === 'resolved_by_authority_attestation',
  }
}

function buildPublicRelayArtifact(
  connectionProbe: OpenEtrPublicRelayAvailability,
  sourceEvidence: OpenEtrSourceEvidence,
) {
  const eventAvailability = sourceEvidence?.sanitized.public_event_availability ?? null
  return {
    schema: 'atrib.openetr.public_relay_evidence.v1',
    status:
      eventAvailability?.status === 'available'
        ? 'events_available'
        : connectionProbe.status === 'available'
          ? 'relay_available_without_event_proof'
          : connectionProbe.status,
    connection_probe: connectionProbe,
    public_event_availability: eventAvailability,
    caveat:
      eventAvailability?.status === 'available'
        ? 'At least one configured public relay returned the exact OpenETR issue, initiate, and accept events.'
        : 'Relay connectivity alone is not proof that the OpenETR transfer events are publicly available.',
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

function recognitionDecisionLabel(
  recognitionExecuted: boolean,
  recognition: RecognitionEvidence,
): string {
  if (!recognitionExecuted) return 'escalate_before_title_recognition'
  if (recognition.authorization_basis === 'external_public_evidence') {
    return 'recognize_title_transfer_with_external_authority_evidence'
  }
  if (recognition.authorization_basis === 'operator_demo_evidence') {
    return 'recognize_title_transfer_with_operator_demo_evidence'
  }
  if (recognition.authorization_basis === 'fixture_evidence') {
    return 'recognize_title_transfer_with_fixture_attestations'
  }
  return 'escalate_before_title_recognition'
}

function recognitionDecisionStatus(
  recognitionExecuted: boolean,
  recognition: RecognitionEvidence,
): string {
  if (!recognitionExecuted) return 'review_required'
  if (recognition.authorization_basis === 'external_public_evidence') {
    return 'external_authority_evidence_complete'
  }
  if (recognition.authorization_basis === 'operator_demo_evidence') {
    return 'operator_demo_evidence_complete'
  }
  if (recognition.authorization_basis === 'fixture_evidence') return 'fixture_evidence_complete'
  return 'review_required'
}

function buildPolicyDecision(
  result: WrappedMcpPacketResult,
  sourceEvidence: OpenEtrSourceEvidence,
  publicRelayEvidence: ReturnType<typeof buildPublicRelayArtifact>,
  recognition: RecognitionEvidence,
) {
  const signedPolicyDecision = publicControlRecord(result.action_policy, 'policy_decision')
  const signedPolicyOutcome = publicControlRecord(result.action_policy, 'policy_outcome')
  const recognitionExecuted = result.operations.includes(RECOGNIZE_TOOL_NAME)
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
    evaluator: OPENETR_POLICY_VERSION,
    decision: recognitionDecisionLabel(recognitionExecuted, recognition),
    decision_status: recognitionDecisionStatus(recognitionExecuted, recognition),
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
      public_nostr_relay_evidence: publicRelayEvidence,
      recognition_evidence: recognition,
      title_authority_evidence: recognition.title_authority_evidence,
      legal_mletr_evidence: recognition.legal_mletr_evidence,
      mletr_source_checklist: recognition.mletr_source_checklist,
      action_policy: {
        schema: result.action_policy?.schema ?? null,
        stopped_before: result.action_policy?.stopped_before ?? null,
        blocked_tool_executed: result.action_policy?.blocked_tool_executed ?? null,
      },
    },
    signed_control_records: {
      policy_decision: signedPolicyDecision,
      policy_outcome: signedPolicyOutcome,
    },
    rule_results: [
      ...sourceRule,
      {
        id: 'signed_openetr_records_present',
        outcome: result.verifier.record_valid ? 'pass' : 'fail',
        evidence: `${result.signed_records} verified OpenETR-shaped tool-call records`,
      },
      {
        id: 'signed_atrib_control_record_policy_decision',
        outcome: signedPolicyDecision?.record_valid ? 'pass' : 'fail',
        evidence: signedPolicyDecision
          ? `policy decision signed as ${signedPolicyDecision.record_hash}`
          : 'no signed policy decision record was present',
      },
      {
        id: 'openetr_chain_observed',
        outcome:
          result.operations.slice(0, 4).join('>') ===
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
        id: 'public_openetr_event_availability',
        outcome:
          publicRelayEvidence.public_event_availability?.status === 'available'
            ? 'pass'
            : 'escalate',
        evidence:
          publicRelayEvidence.public_event_availability?.status === 'available'
            ? `${publicRelayEvidence.public_event_availability.available_relay_count} public relay returned the exact OpenETR events`
            : publicRelayEvidence.caveat,
      },
      {
        id: 'controller_semantics_resolved',
        outcome:
          recognition.controller_semantics.status === 'resolved_by_authority_attestation'
            ? 'pass'
            : 'escalate',
        evidence: recognition.controller_semantics.caveat,
      },
      {
        id: 'title_recognition_requires_attestor',
        outcome: recognition.title_authority_evidence.status !== 'missing' ? 'pass' : 'escalate',
        evidence:
          recognition.title_authority_evidence.status !== 'missing'
            ? `title authority evidence ${recognition.title_authority_evidence.statement_hash} verified under ${recognition.title_authority_evidence.mode}`
            : 'packet contains no title-transfer authority or recognized attestor evidence',
      },
      {
        id: 'public_title_transfer_authority_or_operator_demo',
        outcome:
          recognition.title_authority_evidence.status === 'verified_recognized_tta_event' ||
          recognition.title_authority_evidence.status === 'operator_demo_tta_event'
            ? 'pass'
            : recognition.title_authority_evidence.status === 'fixture_attestation'
              ? 'escalate'
              : 'escalate',
        evidence:
          recognition.title_authority_evidence.status === 'verified_recognized_tta_event'
            ? 'recognized external TTA Nostr event verified'
            : recognition.title_authority_evidence.status === 'operator_demo_tta_event'
              ? 'operator-demo TTA Nostr event verified'
              : recognition.title_authority_evidence.status === 'fixture_attestation'
                ? 'legacy fixture attestation present, but no public TTA Nostr event supplied'
                : 'no public TTA Nostr event or operator-demo TTA event supplied',
      },
      {
        id: 'legal_title_transfer_or_mletr_attestation',
        outcome: recognition.legal_mletr_evidence.status !== 'missing' ? 'pass' : 'escalate',
        evidence:
          recognition.legal_mletr_evidence.status !== 'missing'
            ? `legal/MLETR evidence ${recognition.legal_mletr_evidence.statement_hash} verified under ${recognition.legal_mletr_evidence.mode}`
            : 'packet contains no jurisdiction-specific legal-title-transfer or MLETR compliance attestation',
      },
      {
        id: 'mletr_source_checklist_present',
        outcome:
          recognition.mletr_source_checklist.status === 'source_backed_criteria_present'
            ? 'pass'
            : 'escalate',
        evidence: recognition.mletr_source_checklist.limitation,
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
      recognitionExecuted && recognition.authorization_basis === 'operator_demo_evidence'
        ? 'Operator-demo mode executed recognition under local demo TTA and reviewer signatures. It is not a real title registry or legal conclusion.'
        : recognitionExecuted && recognition.authorization_basis === 'external_public_evidence'
          ? 'External evidence mode executed recognition under configured external signer recognition. The artifact records who made the claim but does not give legal advice.'
          : recognitionExecuted
            ? 'Full fixture mode executed recognition under demo attestations. It is not a real title registry or legal conclusion.'
            : 'It does not prove live OpenETR relay behavior.',
      recognition.legal_mletr_evidence.status !== 'missing'
        ? 'Legal/MLETR evidence is signed evidence by the stated signer, not legal advice from atrib.'
        : 'It does not prove legal title transfer or MLETR compliance.',
      'The deterministic policy artifact summarizes the signed atrib control-record decision.',
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
  publicRelayEvidence: ReturnType<typeof buildPublicRelayArtifact>,
  recognition: RecognitionEvidence,
): string {
  const signedPolicyDecision = publicControlRecord(result.action_policy, 'policy_decision')
  const signedPolicyOutcome = publicControlRecord(result.action_policy, 'policy_outcome')
  const recognitionExecuted = result.operations.includes(RECOGNIZE_TOOL_NAME)
  const actionPath = result.operations.join(' -> ')
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

Those calls always ran against a local WebSocket Nostr relay. When public relay
publish is enabled, the same OpenETR calls also publish to configured public
relays and this artifact checks exact event availability. Raw OpenETR event ids,
object digest, party keys, relay URL, and event JSON stay out of the public
artifact.
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
  const weakness = recognitionExecuted
    ? recognition.authorization_basis === 'operator_demo_evidence'
      ? `This is a source-backed public-relay operator-demo recognition proof. It checks
OpenETR source entrypoints, public relay event availability, wrapper record
chain, hash-only disclosure, verifier path, signed control records, controller
semantics, a Nostr-shaped operator-demo TTA event, and signed operator-demo
legal/MLETR evidence. It does not prove a real title registry decision, legal
advice, or a jurisdictional legal conclusion.`
      : recognition.authorization_basis === 'external_public_evidence'
        ? `This is a source-backed public-relay recognition proof with configured
external signer evidence. It checks OpenETR source entrypoints, public relay
event availability, wrapper record chain, hash-only disclosure, verifier path,
signed control records, controller semantics, a recognized TTA Nostr event, and
signed legal/MLETR evidence. It records who made the claims. It does not make
atrib a title registry or legal reviewer.`
        : `This is a source-backed public-relay fixture recognition proof. It checks
OpenETR source entrypoints, public relay event availability, wrapper record
chain, hash-only disclosure, verifier path, signed control records, controller
semantics, and signed fixture attestations. It does not prove a real title
registry decision, legal advice, or a jurisdictional legal conclusion.`
    : sourceEvidence
      ? `This is a source-backed relay proof. It checks OpenETR source
entrypoints, local Nostr relay publish/query path, optional public relay event
availability, wrapper record chain, hash-only disclosure, verifier path, and
policy gate. Recognition remains gated until authority and legal attestations
are supplied.`
      : `This is a fixture proof. It checks the wrapper, record chain,
hash-only disclosure, verifier path, and policy gate for the OpenETR shape. It
does not prove hosted OpenETR relay behavior, a title-transfer authority
decision, legal recognition, or live Nostr event availability.`
  const regenerateCommand = sourceEvidence
    ? recognitionExecuted
      ? recognition.authorization_basis === 'operator_demo_evidence'
        ? `OPENETR_SOURCE_DIR=/path/to/trbouma/openetr \\
OPENETR_PUBLIC_RELAY_URLS=wss://relay.example \\
OPENETR_PUBLIC_RELAY_PUBLISH=1 \\
OPENETR_OPERATOR_DEMO_TTA=1 \\
OPENETR_OPERATOR_DEMO_LEGAL_ATTESTOR=1 \\
ATRIB_PACKET_PUBLIC_LOG=1 \\
ATRIB_PACKET_WRITE_ARTIFACTS=1 \\
pnpm --filter @atrib/integration openetr-transfer-source-packet`
        : `OPENETR_SOURCE_DIR=/path/to/trbouma/openetr \\
OPENETR_PUBLIC_RELAY_URLS=wss://relay.example \\
OPENETR_PUBLIC_RELAY_PUBLISH=1 \\
OPENETR_FULL_RECOGNITION_FIXTURE=1 \\
ATRIB_PACKET_PUBLIC_LOG=1 \\
ATRIB_PACKET_WRITE_ARTIFACTS=1 \\
pnpm --filter @atrib/integration openetr-transfer-source-packet`
      : `OPENETR_SOURCE_DIR=/path/to/trbouma/openetr ATRIB_PACKET_WRITE_ARTIFACTS=1 pnpm --filter @atrib/integration openetr-transfer-source-packet`
    : `ATRIB_PACKET_WRITE_ARTIFACTS=1 pnpm --filter @atrib/integration openetr-transfer-packet`
  const logProof = result.log.mode === 'public' ? 'public atrib log' : 'local fixture log only'
  const recognitionSummary = recognitionExecuted
    ? `Recognition tool executed under \`${recognition.authorization_basis}\`. The packet supplied
public event availability evidence, controller-semantics evidence, title
authority evidence, legal/MLETR evidence, and an MLETR source checklist.`
    : `Recognition did not execute. The policy gate recorded which evidence was
missing or unresolved before title recognition.`
  const recognitionFit = recognitionExecuted
    ? `ran only after public relay event evidence, controller evidence, title authority evidence, legal/MLETR evidence, and a matching authorization basis were present.`
    : 'still requires attestor or title-transfer authority evidence.'
  const signedPolicySection =
    signedPolicyDecision && signedPolicyOutcome
      ? `
## Signed control records

The packet signs the title-recognition policy decision as atrib control evidence
before the risky recognition action can run.

| Kind | Tool | Record hash | Log index |
| --- | --- | --- | --- |
| ${signedPolicyDecision.kind} | ${signedPolicyDecision.tool_name} | ${signedPolicyDecision.record_hash} | ${signedPolicyDecision.proof.log_index} |
| ${signedPolicyOutcome.kind} | ${signedPolicyOutcome.tool_name} | ${signedPolicyOutcome.record_hash} | ${signedPolicyOutcome.proof.log_index} |

Stopped before: \`${result.action_policy?.stopped_before ?? 'none'}\`.

Blocked tool executed: \`${String(result.action_policy?.blocked_tool_executed ?? false)}\`.
`
      : `
## Signed control records

No signed title-recognition policy control record was produced.
`

  return `# OpenETR transfer proof artifact

This proof signs an OpenETR-shaped transfer-control flow through \`@atrib/mcp-wrap\`.

## Action path

\`${actionPath}\`

## What ran

- Upstream surface: ${upstreamSurface}
- atrib path: \`@atrib/mcp-wrap\` around an MCP stdio server.
- Record policy: public records keep selected tool names plus \`args_hash\` and \`result_hash\`.
- Verification: \`@atrib/mcp\` verifies each Ed25519 record signature after the wrapper writes its mirror.
- Log proof: ${logProof}.
- Publish policy: \`${result.log.publish_policy}\`

## Record refs

| Tool | Record hash | Log index |
| --- | --- | --- |
${rows}

## Redaction line

The packet saw private OpenETR-shaped payloads: object digest, document label,
controller keys, relay URL, and event ids. The public artifact stores only
hashes for those fields. See \`redaction-manifest.json\`.

## Control-plane fit

OpenETR is the transferable-record control chain. atrib signs the agent action
chain around it. This packet sits before a system recognizes title transfer,
releases goods, updates an official register, or settles against the record.

A verifier can see which OpenETR-shaped actions ran, that the action records
verify, that raw OpenETR payloads stayed private, and that recognition
${recognitionFit}

## Policy decision artifact

\`policy-decision.json\` models the next gate after the OpenETR accept event:
\`${policyDecision.decision}\`. It binds to the signed OpenETR-shaped records,
local log indexes, verifier result, and redaction boundary.

Allowed without review: \`${policyDecision.allowed_without_review.join('`, `')}\`.

Escalated before execution: \`${policyDecision.escalated_actions.join('`, `')}\`.

Policy decision hash: \`${policyDecision.decision_hash}\`.

The policy decision file is deterministic and hash-bound to the signed records.
The stop-before-recognition decision is also signed as an atrib control record.
${signedPolicySection}

## Public relay availability

\`public-relay-availability.json\` records the relay availability check status:
\`${policyDecision.inputs.public_nostr_relay_evidence.status}\`.

Set \`OPENETR_PUBLIC_RELAY_URLS=wss://relay.example,...\` to probe public Nostr
relay availability for OpenETR event kinds. That probe checks relay connectivity
and Nostr responses. When \`OPENETR_PUBLIC_RELAY_PUBLISH=1\` is also set in
source-backed mode, the artifact also checks whether exact OpenETR events are
available from those relays.

Event availability status:
\`${publicRelayEvidence.public_event_availability?.status ?? 'not_requested'}\`.

## Recognition evidence

${recognitionSummary}

Authorization basis: \`${recognition.authorization_basis}\`.

Authorized by evidence: \`${String(recognition.authorized_by_evidence)}\`.

Legacy fixture authorization: \`${String(recognition.authorized_by_fixture)}\`.

Controller semantics: \`${recognition.controller_semantics.status}\`.

Title authority evidence: \`${recognition.title_authority_evidence.statement_hash ?? 'missing'}\` (\`${recognition.title_authority_evidence.mode}\`).

Legal/MLETR evidence: \`${recognition.legal_mletr_evidence.statement_hash ?? 'missing'}\` (\`${recognition.legal_mletr_evidence.mode}\`).

MLETR source checklist: \`${recognition.mletr_source_checklist.status}\`.
${sourceSection}

## Weakness

${weakness}

## Regenerate

\`\`\`bash
${regenerateCommand}
\`\`\`

## Live upstream path

Source-backed mode runs the pinned OpenETR implementation. Public proof mode can
publish to public relays, check exact event availability, ingest a configured
external TTA Nostr event, or generate an operator-demo TTA Nostr event. It can
also verify external legal/MLETR attestations or sign an operator-demo reviewer
attestation before executing title recognition and submitting accepted atrib
records to the public log when \`ATRIB_PACKET_PUBLIC_LOG=1\`.
`
}

export async function runOpenEtrTransferPacket(
  options: OpenEtrTransferPacketOptions = {},
): Promise<OpenEtrTransferPacketRun> {
  const env = options.env ?? process.env
  const exampleDir = dirname(fileURLToPath(import.meta.url))
  const integrationDir = dirname(dirname(exampleDir))
  const sourceEvidence = runOpenEtrSourceE2e(env, exampleDir)
  const publicRelayAvailability = await runPublicRelayAvailability(env)
  const publicRelayEvidence = buildPublicRelayArtifact(publicRelayAvailability, sourceEvidence)
  const recognitionEvidence = await buildRecognitionEvidence(env, sourceEvidence)
  const publicLog = env.ATRIB_PACKET_PUBLIC_LOG === '1'
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
    mode: sourceEvidence ? 'live' : 'fixture',
    logMode: publicLog ? 'public' : 'local',
    upstreamShape: sourceEvidence
      ? 'trbouma/openetr Python source run against local Nostr relay, surfaced through MCP-shaped tools openetr_issue, openetr_transfer_initiate, openetr_transfer_accept, openetr_query_state'
      : 'OpenETR MCP-shaped fixture tools openetr_issue, openetr_transfer_initiate, openetr_transfer_accept, openetr_query_state',
    exampleDir,
    integrationDir,
    ...(env.ATRIB_PACKET_PUBLIC_LOG_ENDPOINT
      ? { publicLogEndpoint: env.ATRIB_PACKET_PUBLIC_LOG_ENDPOINT }
      : {}),
    ...(upstream ? { upstream } : { fixtureServer }),
    expectedTools: [
      'openetr_issue',
      'openetr_transfer_initiate',
      'openetr_transfer_accept',
      'openetr_query_state',
      RECOGNIZE_TOOL_NAME,
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
      {
        name: RECOGNIZE_TOOL_NAME,
        arguments: {
          object_digest: PRIVATE_OBJECT_DIGEST,
          accept_event_id: PRIVATE_ACCEPT_EVENT_ID,
          authority_policy_id: TITLE_AUTHORITY_POLICY_ID,
        },
      },
    ],
    policyGate: createOpenEtrTitleRecognitionPolicyGate(recognitionEvidence),
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
  const policyDecision = buildPolicyDecision(
    publicResult,
    sourceEvidence,
    publicRelayEvidence,
    recognitionEvidence,
  )
  const signedPolicyDecision = publicControlRecord(publicResult.action_policy, 'policy_decision')
  const signedPolicyOutcome = publicControlRecord(publicResult.action_policy, 'policy_outcome')
  const recognitionExecuted = publicResult.operations.includes(RECOGNIZE_TOOL_NAME)
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
      recognized_title_transfer: recognitionExecuted && recognitionEvidence.authorized_by_evidence,
      attestor_evidence_supplied: recognitionEvidence.title_authority_evidence.status !== 'missing',
      controller_semantics_pinned:
        recognitionEvidence.controller_semantics.status === 'resolved_by_authority_attestation',
      source_e2e: sourceEvidence?.sanitized ?? null,
      public_relay_evidence: publicRelayEvidence,
      recognition_evidence: recognitionEvidence,
      title_authority_evidence: recognitionEvidence.title_authority_evidence,
      legal_mletr_evidence: recognitionEvidence.legal_mletr_evidence,
      mletr_source_checklist: recognitionEvidence.mletr_source_checklist,
      title_recognition_control_record_signed: Boolean(signedPolicyDecision),
      title_recognition_tool_executed:
        publicResult.action_policy?.blocked_tool_executed ??
        publicResult.operations.includes(RECOGNIZE_TOOL_NAME),
    },
    policy_decision: {
      artifact: 'policy-decision.json',
      decision: policyDecision.decision,
      decision_status: policyDecision.decision_status,
      decision_hash: policyDecision.decision_hash,
      signed_policy_record: Boolean(signedPolicyDecision),
      signed_control_record: signedPolicyDecision,
      signed_outcome_record: signedPolicyOutcome,
      caveat: 'Policy decision artifact summarizes the signed atrib control-record decision.',
    },
    caveats: [
      sourceEvidence
        ? 'Source-backed run against the pinned OpenETR implementation.'
        : 'Fixture run only. It does not prove live OpenETR relay output.',
      'Private OpenETR object, party, relay, and event-id material are represented by hashes only.',
      recognitionExecuted && recognitionEvidence.authorization_basis === 'operator_demo_evidence'
        ? 'Title recognition executed under operator-demo TTA and legal reviewer signatures. It is not a real title registry decision.'
        : recognitionExecuted
          ? 'Title recognition executed under configured evidence. It is not a real title registry decision by atrib.'
          : 'Title recognition remains a consumer policy decision until attestor evidence is supplied.',
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
      renderReadme(
        publicResult,
        policyDecision,
        sourceEvidence,
        publicRelayEvidence,
        recognitionEvidence,
      ),
    )
    writeJson(join(outDir, 'verifier-output.json'), verifierOutput)
    writeJson(join(outDir, 'redaction-manifest.json'), redactionManifest)
    writeJson(join(outDir, 'policy-decision.json'), policyDecision)
    writeJson(join(outDir, 'public-relay-availability.json'), publicRelayEvidence)
    writeJson(join(outDir, 'recognition-evidence.json'), recognitionEvidence)
    writeJson(join(outDir, 'controller-semantics.json'), recognitionEvidence.controller_semantics)
    writeJson(
      join(outDir, 'title-authority-evidence.json'),
      recognitionEvidence.title_authority_evidence,
    )
    writeJson(join(outDir, 'legal-mletr-evidence.json'), recognitionEvidence.legal_mletr_evidence)
    writeJson(
      join(outDir, 'mletr-source-checklist.json'),
      recognitionEvidence.mletr_source_checklist,
    )
    const titleAttestationPath = join(outDir, 'title-authority-attestation.json')
    const legalAttestationPath = join(outDir, 'legal-mletr-attestation.json')
    if (recognitionEvidence.title_authority) {
      writeJson(titleAttestationPath, recognitionEvidence.title_authority)
    } else {
      removeArtifactIfPresent(titleAttestationPath)
    }
    if (recognitionEvidence.legal_mletr) {
      writeJson(legalAttestationPath, recognitionEvidence.legal_mletr)
    } else {
      removeArtifactIfPresent(legalAttestationPath)
    }
    if (sourceEvidence) writeJson(join(outDir, 'source-run-output.json'), sourceEvidence.sanitized)
  }

  return {
    result,
    verifierOutput,
    redactionManifest,
    policyDecision,
    publicRelayAvailability,
    publicRelayEvidence,
    recognitionEvidence,
    artifact_dir: outDir ?? null,
  }
}

async function main(): Promise<void> {
  const packet = await runOpenEtrTransferPacket()
  const { result, policyDecision, artifact_dir } = packet
  const signedPolicyDecision = publicControlRecord(result.action_policy, 'policy_decision')
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
          signed_policy_record: Boolean(signedPolicyDecision),
          signed_control_record_hash: signedPolicyDecision?.record_hash ?? null,
        },
        recognized_title_transfer:
          result.operations.includes(RECOGNIZE_TOOL_NAME) &&
          packet.recognitionEvidence.authorized_by_evidence,
        public_relay_events_available:
          packet.publicRelayEvidence.public_event_availability?.status === 'available',
        title_authority_attested:
          packet.recognitionEvidence.title_authority_evidence.status !== 'missing',
        legal_mletr_attested: packet.recognitionEvidence.legal_mletr_evidence.status !== 'missing',
        authorization_basis: packet.recognitionEvidence.authorization_basis,
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
