// SPDX-License-Identifier: Apache-2.0

import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import canonicalize from 'canonicalize'
import * as ed from '@noble/ed25519'
import { sha512 } from '@noble/hashes/sha2.js'
import {
  A2A_PROTOCOL_VERSION,
  type AgentCard,
  type Message,
  type Part,
  Role,
  type SendMessageRequest,
  canonicalizeAgentCard,
  generateAgentCardSignature,
  verifyAgentCardSignature as verifySdkAgentCardSignature,
} from '@a2a-js/sdk'
import { ClientFactory, JsonRpcTransportFactory } from '@a2a-js/sdk/client'
import {
  AgentEvent,
  DefaultRequestHandler,
  InMemoryTaskStore,
  JsonRpcTransportHandler,
  type AgentExecutor,
  type ExecutionEventBus,
  type RequestContext,
  ServerCallContext,
} from '@a2a-js/sdk/server'
import {
  base64urlEncode,
  canonicalRecord,
  hexEncode,
  sha256,
  signRecord,
  type AtribRecord,
  type ProofBundle,
} from '@atrib/mcp'
import { startLogServer, type LogServer } from '@atrib/log-node'
import {
  handoffClaimsFromEvidencePacket,
  verifyHandoffClaims,
  verifyRecord as verifyAtribRecord,
  type HandoffEvidencePacket,
} from '@atrib/verify'

ed.hashes.sha512 = sha512
ed.hashes.sha512Async = (message) => Promise.resolve(sha512(message))

const A2A_CONTEXT_ID = 'a2a-attrib-handoff-context'
const A2A_AGENT_URL = 'https://a2a.example.test/atrib-handoff/jsonrpc'
const A2A_AGENT_CARD_URL = 'https://a2a.example.test/.well-known/agent-card.json'
const A2A_REMOTE_AGENT_SEED = new Uint8Array(32).fill(181)
const RECEIVING_AGENT_SEED = new Uint8Array(32).fill(182)
const A2A_AGENT_CARD_KEY_ID = 'atrib-a2a-evidence-agent-ed25519'
const REMOTE_ATRIB_CONTEXT_ID = '12'.repeat(16)
const RECEIVER_ATRIB_CONTEXT_ID = '34'.repeat(16)
const MAX_AGE_MS = 60_000
const PRIVATE_TASK_PHRASE = 'quiet signed atlas'

export interface A2aHandoffProofResult {
  strategy: 'atrib-a2a-handoff-proof-v1'
  sdk: {
    package: '@a2a-js/sdk'
    protocol_version: string
    transport: 'JSONRPC'
  }
  agent_card: {
    name: string
    url: string
    protocol_binding: string
    signatures_count: number
    signature_alg: 'EdDSA'
    signature_kid: string
    signature_valid: boolean
    signed_payload_hash: string
  }
  a2a: {
    request_context_id: string
    return_immediately: false
    response_kind: 'message'
    response_part_content_cases: string[]
    packet_part_content_case: 'data'
  }
  evidence: {
    remote_record_hash: string
    remote_informed_by_resolved: string[]
    remote_informed_by_dangling: string[]
    accepted_record_hashes: string[]
    rejected_count: number
    proof_log_index: number
  }
  followup: {
    record_hash: string
    signature_ok: boolean
    informed_by_resolved: string[]
    informed_by_dangling: string[]
  }
  privacy: {
    private_task_phrase: string
    public_record_contains_private_phrase: boolean
  }
  log_url: string
  timings?: A2aHandoffTiming[]
  records?: {
    remote: AtribRecord
    followup: AtribRecord
  }
}

export interface A2aHandoffTiming {
  key: string
  label: string
  started_offset_ms: number
  duration_ms: number
  parent_key?: string
}

export interface A2aHandoffProofOptions {
  nowMs?: number
  remoteInformedBy?: string[]
  remoteInformedByCandidates?: AtribRecord[]
  includeSignedRecords?: boolean
  captureTimings?: boolean
  onTiming?: (timing: A2aHandoffTiming) => void | Promise<void>
  ids?: {
    requestMessageId?: string
    responseMessageId?: string
    taskId?: string
    contextId?: string
  }
}

interface TimingRecorder {
  span<T>(
    key: string,
    label: string,
    operation: () => T | Promise<T>,
    parentKey?: string,
  ): Promise<T>
  markTotal(key: string, label: string): Promise<void>
  entries(): A2aHandoffTiming[] | undefined
}

interface RemoteA2aEvidenceBody {
  protocol: 'A2A'
  protocol_version: string
  transport: 'JSONRPC'
  agent_card_url: string
  task_id: string
  context_id: string
  request_message_id: string
  delegated_request: {
    summary: string
    private_phrase: string
  }
  result: {
    status: 'completed'
    summary: string
  }
}

interface RemoteEvidence {
  packet: HandoffEvidencePacket
  record: AtribRecord
  recordHash: string
  proof: ProofBundle
  body: RemoteA2aEvidenceBody
}

interface A2aHandoffPacketPartData {
  kind: 'atrib_handoff_packet'
  packet: HandoffEvidencePacket
  record_hash: string
  a2a_context_id: string
  a2a_task_id: string
}

class EvidencePacketAgent implements AgentExecutor {
  constructor(
    private readonly logUrl: string,
    private readonly nowMs: number,
    private readonly options: A2aHandoffProofOptions,
    private readonly timings: TimingRecorder,
  ) {}

  async execute(requestContext: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
    const evidence = await this.timings.span(
      'a2a_remote_evidence_build',
      'Build remote A2A evidence packet',
      () =>
        makeRemoteEvidence(
          this.logUrl,
          requestContext,
          this.nowMs,
          this.options.remoteInformedBy ?? [],
          this.timings,
          this.options.ids,
        ),
      'a2a_send_message',
    )
    const packetPart = makeDataPart({
      kind: 'atrib_handoff_packet',
      packet: evidence.packet,
      record_hash: evidence.recordHash,
      a2a_context_id: requestContext.contextId,
      a2a_task_id: requestContext.taskId,
    })
    const response: Message = {
      messageId: this.options.ids?.responseMessageId ?? randomUUID(),
      role: Role.ROLE_AGENT,
      taskId: requestContext.taskId,
      contextId: requestContext.contextId,
      parts: [
        makeTextPart(
          'A2A specialist completed the delegated check and returned an atrib evidence packet.',
        ),
        packetPart,
      ],
      metadata: undefined,
      extensions: [],
      referenceTaskIds: [],
    }
    eventBus.publish(AgentEvent.message(response))
    eventBus.finished()
  }

  cancelTask = async (_taskId: string, _eventBus: ExecutionEventBus): Promise<void> => {}
}

export async function runA2aHandoffProof(
  input: number | A2aHandoffProofOptions = Date.now(),
): Promise<A2aHandoffProofResult> {
  const options = typeof input === 'number' ? { nowMs: input } : input
  const nowMs = options.nowMs ?? Date.now()
  const timings = createTimingRecorder(options)
  let logServer: LogServer | undefined
  let result: A2aHandoffProofResult | undefined
  try {
    logServer = await timings.span('log_server_start', 'Start ephemeral log server', () =>
      startLogServer({
        port: 0,
        logPrivateKey: ed.utils.randomSecretKey(),
      }),
    )
    const agentCard = await timings.span('agent_card_sign', 'Sign A2A Agent Card', () =>
      makeSignedAgentCard(),
    )
    const agentCardSignature = await timings.span(
      'agent_card_verify',
      'Verify A2A Agent Card signature',
      () => verifySignedAgentCard(agentCard),
    )
    const clientFactory = await timings.span(
      'a2a_stack_setup',
      'Build in-process A2A JSON-RPC stack',
      () => {
        const requestHandler = new DefaultRequestHandler(
          agentCard,
          new InMemoryTaskStore(),
          new EvidencePacketAgent(logServer!.url, nowMs, options, timings),
        )
        const transportHandler = new JsonRpcTransportHandler(requestHandler)
        const clientFactory = new ClientFactory({
          transports: [
            new JsonRpcTransportFactory({
              fetchImpl: makeInProcessA2aFetch(transportHandler),
            }),
          ],
          preferredTransports: ['JSONRPC'],
        })
        return clientFactory
      },
    )
    const client = await timings.span(
      'a2a_client_create',
      'Create A2A client from Agent Card',
      () => clientFactory.createFromAgentCard(agentCard),
    )
    const response = await timings.span(
      'a2a_send_message',
      'Send blocking A2A JSON-RPC message',
      () => client.sendMessage(makeSendParams(options.ids)),
    )
    if (!isMessage(response)) throw new Error('expected A2A message response')
    const packetData = await timings.span(
      'handoff_packet_extract',
      'Extract atrib handoff packet',
      () => extractPacketData(response),
    )
    const packet = packetData.packet
    const trustedCreatorKeys = [await publicKey(A2A_REMOTE_AGENT_SEED)]
    const handoff = await timings.span(
      'handoff_claims_verify',
      'Verify handoff claims and log inclusion',
      () =>
        verifyHandoffClaims(handoffClaimsFromEvidencePacket(packet), {
          trusted_creator_keys: trustedCreatorKeys,
          allowed_context_ids: [REMOTE_ATRIB_CONTEXT_ID],
          require_body: true,
          require_body_commitment: true,
          require_log_inclusion: true,
          log_public_key: logServer!.logPublicKey,
          now_ms: nowMs,
          max_age_ms: MAX_AGE_MS,
        }),
    )
    if (handoff.accepted_record_hashes.length !== 1) {
      throw new Error(`expected one accepted record, got ${handoff.accepted_record_hashes.length}`)
    }
    const remoteEntry = (packet.records ?? []).find(
      (entry) => entry.record_hash === handoff.accepted_record_hashes[0],
    )
    if (!remoteEntry?.record) throw new Error('accepted A2A record missing from packet')
    const remoteRecord = remoteEntry.record
    const remoteVerification = await timings.span(
      'remote_record_verify',
      'Verify remote record informed_by resolution',
      () =>
        verifyAtribRecord(remoteRecord, {
          informedByCandidates: options.remoteInformedByCandidates ?? [],
        }),
    )
    const followupRecord = await timings.span(
      'receiver_followup_sign',
      'Sign receiving-agent follow-up',
      () =>
        makeReceivingAgentFollowup(
          handoff.accepted_record_hashes,
          response.contextId ?? A2A_CONTEXT_ID,
          nowMs,
        ),
    )
    const followupVerification = await timings.span(
      'receiver_followup_verify',
      'Verify receiving-agent follow-up',
      () =>
        verifyAtribRecord(followupRecord, {
          informedByCandidates: [remoteRecord],
        }),
    )
    result = {
      strategy: 'atrib-a2a-handoff-proof-v1',
      sdk: {
        package: '@a2a-js/sdk',
        protocol_version: A2A_PROTOCOL_VERSION,
        transport: 'JSONRPC',
      },
      agent_card: {
        name: agentCard.name,
        url: primaryAgentInterface(agentCard).url,
        protocol_binding: primaryAgentInterface(agentCard).protocolBinding,
        signatures_count: agentCard.signatures.length,
        signature_alg: agentCardSignature.alg,
        signature_kid: agentCardSignature.kid,
        signature_valid: agentCardSignature.valid,
        signed_payload_hash: agentCardSignature.payloadHash,
      },
      a2a: {
        request_context_id: response.contextId ?? A2A_CONTEXT_ID,
        return_immediately: false,
        response_kind: 'message',
        response_part_content_cases: response.parts.map(partContentCase),
        packet_part_content_case: 'data',
      },
      evidence: {
        remote_record_hash: handoff.accepted_record_hashes[0]!,
        remote_informed_by_resolved: remoteVerification.informed_by_resolution?.resolved ?? [],
        remote_informed_by_dangling: remoteVerification.informed_by_resolution?.dangling ?? [],
        accepted_record_hashes: handoff.accepted_record_hashes,
        rejected_count: handoff.rejected.length,
        proof_log_index: remoteEntry.proof?.log_index ?? -1,
      },
      followup: {
        record_hash: recordHash(followupRecord),
        signature_ok: followupVerification.signatureOk,
        informed_by_resolved: followupVerification.informed_by_resolution?.resolved ?? [],
        informed_by_dangling: followupVerification.informed_by_resolution?.dangling ?? [],
      },
      privacy: {
        private_task_phrase: PRIVATE_TASK_PHRASE,
        public_record_contains_private_phrase: JSON.stringify(remoteEntry.record).includes(
          PRIVATE_TASK_PHRASE,
        ),
      },
      log_url: logServer.url,
    }
    if (options.includeSignedRecords) {
      result.records = {
        remote: remoteRecord,
        followup: followupRecord,
      }
    }
  } finally {
    if (logServer !== undefined) {
      await timings.span('log_server_close', 'Close ephemeral log server', () => logServer!.close())
    }
  }
  await timings.markTotal('a2a_handoff_total', 'A2A handoff proof total')
  const entries = timings.entries()
  if (entries !== undefined && result !== undefined) result.timings = entries
  return result
}

function createTimingRecorder(options: A2aHandoffProofOptions): TimingRecorder {
  const baseMs = performance.now()
  const entries: A2aHandoffTiming[] = []
  const shouldTime = options.captureTimings === true || options.onTiming !== undefined

  const record = async (
    key: string,
    label: string,
    startedAtMs: number,
    endedAtMs: number,
    parentKey?: string,
  ): Promise<void> => {
    if (!shouldTime) return
    const timing: A2aHandoffTiming = {
      key,
      label,
      started_offset_ms: roundMs(startedAtMs - baseMs),
      duration_ms: roundMs(endedAtMs - startedAtMs),
      ...(parentKey !== undefined ? { parent_key: parentKey } : {}),
    }
    if (options.captureTimings === true) entries.push(timing)
    await options.onTiming?.(timing)
  }

  return {
    async span<T>(
      key: string,
      label: string,
      operation: () => T | Promise<T>,
      parentKey?: string,
    ): Promise<T> {
      if (!shouldTime) return operation()
      const startedAtMs = performance.now()
      try {
        return await operation()
      } finally {
        await record(key, label, startedAtMs, performance.now(), parentKey)
      }
    },
    async markTotal(key: string, label: string): Promise<void> {
      await record(key, label, baseMs, performance.now())
    },
    entries(): A2aHandoffTiming[] | undefined {
      if (options.captureTimings !== true) return undefined
      return [...entries]
    },
  }
}

function roundMs(value: number): number {
  return Math.round(value * 1000) / 1000
}

function makeUnsignedAgentCard(): AgentCard {
  return {
    name: 'atrib A2A Evidence Agent',
    description: 'Returns a signed atrib evidence packet for a delegated A2A task.',
    supportedInterfaces: [
      {
        url: A2A_AGENT_URL,
        protocolBinding: 'JSONRPC',
        protocolVersion: A2A_PROTOCOL_VERSION,
        tenant: '',
      },
    ],
    provider: undefined,
    version: '0.1.0',
    documentationUrl: undefined,
    skills: [
      {
        id: 'delegated-evidence',
        name: 'Delegated evidence',
        description: 'Complete a delegated task and return atrib handoff evidence.',
        tags: ['handoff', 'evidence', 'atrib'],
        examples: [],
        inputModes: ['text/plain'],
        outputModes: ['text/plain', 'application/json'],
        securityRequirements: [],
      },
    ],
    capabilities: {
      pushNotifications: false,
      streaming: false,
      extensions: [],
      extendedAgentCard: false,
    },
    securitySchemes: {},
    securityRequirements: [],
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain', 'application/json'],
    signatures: [],
    iconUrl: undefined,
  }
}

async function makeSignedAgentCard(): Promise<AgentCard> {
  const unsignedCard = makeUnsignedAgentCard()
  const signer = generateAgentCardSignature(await agentCardSigningJwk(), {
    alg: 'EdDSA',
    typ: 'JOSE',
    kid: A2A_AGENT_CARD_KEY_ID,
  })
  return signer(unsignedCard)
}

async function agentCardSigningJwk(): Promise<Parameters<typeof generateAgentCardSignature>[0]> {
  return {
    kty: 'OKP',
    crv: 'Ed25519',
    d: base64urlEncode(A2A_REMOTE_AGENT_SEED),
    x: base64urlEncode(await ed.getPublicKeyAsync(A2A_REMOTE_AGENT_SEED)),
  }
}

async function agentCardVerificationJwk(): Promise<
  Awaited<ReturnType<Parameters<typeof verifySdkAgentCardSignature>[0]>>
> {
  return {
    kty: 'OKP',
    crv: 'Ed25519',
    x: base64urlEncode(await ed.getPublicKeyAsync(A2A_REMOTE_AGENT_SEED)),
  }
}

async function verifySignedAgentCard(card: AgentCard): Promise<{
  alg: 'EdDSA'
  kid: string
  valid: boolean
  payloadHash: string
}> {
  const signature = card.signatures[0]
  const { signatures: _signatures, ...unsignedCard } = card
  const payload = canonicalizeAgentCard(unsignedCard)
  if (!signature) {
    return {
      alg: 'EdDSA',
      kid: '',
      valid: false,
      payloadHash: hashText(payload),
    }
  }
  const protectedHeader = JSON.parse(text(base64urlDecode(signature.protected))) as {
    alg?: unknown
    kid?: unknown
  }
  let valid = false
  if (protectedHeader.alg === 'EdDSA' && typeof protectedHeader.kid === 'string') {
    try {
      const verifier = verifySdkAgentCardSignature(async (kid) => {
        if (kid !== A2A_AGENT_CARD_KEY_ID) throw new Error(`unknown Agent Card key ${kid}`)
        return agentCardVerificationJwk()
      })
      await verifier(card)
      valid = true
    } catch {
      valid = false
    }
  }

  return {
    alg: 'EdDSA',
    kid: typeof protectedHeader.kid === 'string' ? protectedHeader.kid : '',
    valid,
    payloadHash: hashText(payload),
  }
}

function makeSendParams(ids: A2aHandoffProofOptions['ids'] = {}): SendMessageRequest {
  const message: Message = {
    messageId: ids.requestMessageId ?? randomUUID(),
    role: Role.ROLE_USER,
    contextId: ids.contextId ?? A2A_CONTEXT_ID,
    taskId: '',
    parts: [
      makeTextPart(`Investigate support handoff ${PRIVATE_TASK_PHRASE} and return evidence.`),
    ],
    metadata: undefined,
    extensions: [],
    referenceTaskIds: [],
  }
  return {
    configuration: {
      acceptedOutputModes: ['text/plain', 'application/json'],
      taskPushNotificationConfig: undefined,
      returnImmediately: false,
    },
    message,
    tenant: '',
    metadata: {
      'atrib.dev/requested-evidence': 'handoff_packet',
    },
  }
}

function makeInProcessA2aFetch(handler: JsonRpcTransportHandler): typeof fetch {
  return (async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const bodyText = await requestBodyText(init?.body)
    const requestBody = JSON.parse(bodyText) as unknown
    const responseBody = await handler.handle(
      requestBody as Record<string, unknown>,
      new ServerCallContext({ requestedVersion: A2A_PROTOCOL_VERSION }),
    )
    if (isAsyncIterable(responseBody)) {
      throw new Error('streaming A2A responses are not used in this proof')
    }
    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch
}

async function requestBodyText(body: BodyInit | null | undefined): Promise<string> {
  if (typeof body === 'string') return body
  if (body instanceof URLSearchParams) return body.toString()
  if (body instanceof Blob) return body.text()
  if (body instanceof ArrayBuffer) return new TextDecoder().decode(body)
  if (ArrayBuffer.isView(body)) {
    return new TextDecoder().decode(
      body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
    )
  }
  throw new Error('unsupported A2A request body in proof fetch')
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    typeof (value as { [Symbol.asyncIterator]?: unknown })?.[Symbol.asyncIterator] === 'function'
  )
}

async function makeRemoteEvidence(
  logUrl: string,
  requestContext: RequestContext,
  nowMs: number,
  informedBy: string[],
  timings: TimingRecorder,
  ids: A2aHandoffProofOptions['ids'] = {},
): Promise<RemoteEvidence> {
  const requestText = requestTextFromMessage(requestContext.userMessage)
  const body: RemoteA2aEvidenceBody = {
    protocol: 'A2A',
    protocol_version: A2A_PROTOCOL_VERSION,
    transport: 'JSONRPC',
    agent_card_url: A2A_AGENT_CARD_URL,
    task_id: ids.taskId ?? requestContext.taskId,
    context_id: requestContext.contextId,
    request_message_id: requestContext.userMessage.messageId,
    delegated_request: {
      summary: 'support handoff investigation',
      private_phrase: requestText.includes(PRIVATE_TASK_PHRASE) ? PRIVATE_TASK_PHRASE : 'absent',
    },
    result: {
      status: 'completed',
      summary: 'delegated A2A agent completed evidence capture',
    },
  }
  const record = await timings.span(
    'remote_record_sign',
    'Sign remote A2A evidence record',
    () => makeRemoteClaimRecord(body, nowMs, informedBy),
    'a2a_remote_evidence_build',
  )
  const recordHashValue = recordHash(record)
  const proof = await timings.span(
    'remote_log_submit',
    'Submit remote A2A record to local log',
    () => submitRecord(logUrl, record),
    'a2a_remote_evidence_build',
  )
  const packet = await timings.span(
    'handoff_packet_build',
    'Build handoff packet from signed remote evidence',
    () =>
      ({
        kind: 'a2a_handoff_packet',
        required_record_hashes: [recordHashValue],
        records: [
          {
            record_hash: recordHashValue,
            record,
            proof,
            _local: {
              producer: 'a2a-specialist-agent',
              content: body,
            },
          },
        ],
      }) satisfies HandoffEvidencePacket,
    'a2a_remote_evidence_build',
  )
  return { packet, record, recordHash: recordHashValue, proof, body }
}

async function makeRemoteClaimRecord(
  body: RemoteA2aEvidenceBody,
  timestamp: number,
  informedBy: string[],
): Promise<AtribRecord> {
  const creatorKey = await publicKey(A2A_REMOTE_AGENT_SEED)
  return signRecord(
    {
      spec_version: 'atrib/1.0',
      content_id: hashText(`a2a-handoff:${hashMaterial(body)}`),
      creator_key: creatorKey,
      chain_root: 'sha256:' + 'a'.repeat(64),
      event_type: 'https://atrib.dev/v1/types/observation',
      context_id: REMOTE_ATRIB_CONTEXT_ID,
      timestamp,
      ...(informedBy.length > 0 ? { informed_by: [...informedBy].sort() } : {}),
      args_hash: hashMaterial(body),
      signature: '',
    } as AtribRecord,
    A2A_REMOTE_AGENT_SEED,
  )
}

async function makeReceivingAgentFollowup(
  informedBy: string[],
  a2aContextId: string,
  timestamp: number,
): Promise<AtribRecord> {
  const creatorKey = await publicKey(RECEIVING_AGENT_SEED)
  const body = {
    protocol: 'A2A',
    context_id: a2aContextId,
    action: 'receiver accepted verified A2A evidence before continuing',
    accepted_record_hashes: informedBy,
  }
  return signRecord(
    {
      spec_version: 'atrib/1.0',
      content_id: hashText(`a2a-handoff-followup:${hashMaterial(body)}`),
      creator_key: creatorKey,
      chain_root: 'sha256:' + 'b'.repeat(64),
      event_type: 'https://atrib.dev/v1/types/observation',
      context_id: RECEIVER_ATRIB_CONTEXT_ID,
      timestamp,
      informed_by: [...informedBy].sort(),
      args_hash: hashMaterial(body),
      signature: '',
    } as AtribRecord,
    RECEIVING_AGENT_SEED,
  )
}

async function submitRecord(url: string, record: AtribRecord): Promise<ProofBundle> {
  const res = await fetch(`${url}/v1/entries`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(record),
  })
  if (!res.ok) {
    throw new Error(`log submission failed with HTTP ${res.status}: ${await res.text()}`)
  }
  return (await res.json()) as ProofBundle
}

function extractPacketData(message: Message): A2aHandoffPacketPartData {
  const packetPart = message.parts.find(isA2aHandoffPacketPart)
  if (!packetPart) throw new Error('A2A response did not include an atrib packet data part')
  return packetPart.content.value
}

function requestTextFromMessage(message: Message): string {
  return message.parts
    .map((part) => (part.content?.$case === 'text' ? part.content.value : ''))
    .filter(Boolean)
    .join('\n')
}

function isMessage(value: unknown): value is Message {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { messageId?: unknown }).messageId === 'string' &&
    Array.isArray((value as { parts?: unknown }).parts)
  )
}

function makeTextPart(text: string): Part {
  return {
    content: { $case: 'text', value: text },
    metadata: undefined,
    filename: '',
    mediaType: 'text/plain',
  }
}

function makeDataPart(data: Record<string, unknown>): Part {
  return {
    content: { $case: 'data', value: data },
    metadata: undefined,
    filename: '',
    mediaType: 'application/json',
  }
}

function isA2aHandoffPacketPart(
  part: Part,
): part is Part & { content: { $case: 'data'; value: A2aHandoffPacketPartData } } {
  const data = part.content?.$case === 'data' ? part.content.value : undefined
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { kind?: unknown }).kind === 'atrib_handoff_packet'
  )
}

function partContentCase(part: Part): string {
  return part.content?.$case ?? 'unset'
}

function primaryAgentInterface(card: AgentCard): AgentCard['supportedInterfaces'][number] {
  const agentInterface = card.supportedInterfaces[0]
  if (!agentInterface) throw new Error('Agent Card does not declare a supported interface')
  return agentInterface
}

async function publicKey(seed: Uint8Array): Promise<string> {
  return base64urlEncode(await ed.getPublicKeyAsync(seed))
}

function hashMaterial(value: unknown): string {
  const encoded = canonicalize(value)
  if (encoded === undefined) throw new Error('body is not JSON-canonicalizable')
  return hashText(encoded)
}

function hashText(value: string): string {
  return `sha256:${hexEncode(sha256(new TextEncoder().encode(value)))}`
}

function recordHash(record: AtribRecord): string {
  return `sha256:${hexEncode(sha256(canonicalRecord(record)))}`
}

function text(value: Uint8Array): string {
  return new TextDecoder().decode(value)
}

function base64urlDecode(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'base64url'))
}
