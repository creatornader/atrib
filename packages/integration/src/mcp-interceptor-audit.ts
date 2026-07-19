// SPDX-License-Identifier: Apache-2.0

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { ErrorCode, McpError, type Notification } from '@modelcontextprotocol/sdk/types.js'
import {
  ATTRIBUTION_EXTENSION_ID,
  EVENT_TYPE_TOOL_CALL_URI,
  base64urlEncode,
  buildAttributionReceipt,
  canonicalRecord,
  computeContentId,
  genesisChainRoot,
  getPublicKey,
  hexEncode,
  sha256,
  signRecord,
  verifyAttributionReceipt,
  type AtribRecord,
  type AttributionResultBlock,
} from '@atrib/mcp'
import { verifyRecord } from '@atrib/verify'
import canonicalize from 'canonicalize'
import { z } from 'zod'

export { ATTRIBUTION_EXTENSION_ID }
export const INTERCEPTORS_EXTENSION_ID = 'io.modelcontextprotocol/interceptors'
export const INTERCEPTOR_NAME = 'atrib-verifiable-audit'

const DEFAULT_PRIVATE_KEY = Uint8Array.from([
  31, 48, 65, 82, 99, 116, 133, 150, 167, 184, 201, 218, 235, 252, 13, 30, 47, 64, 81, 98, 115, 132,
  149, 166, 183, 200, 217, 234, 251, 12, 29, 46,
])

const PrincipalSchema = z
  .object({
    type: z.enum(['user', 'service', 'anonymous']),
    id: z.string().optional(),
    claims: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough()

const InvocationContextSchema = z
  .object({
    principal: PrincipalSchema.optional(),
    traceId: z.string().optional(),
    spanId: z.string().optional(),
    timestamp: z.string().optional(),
    sessionId: z.string().optional(),
  })
  .passthrough()

export const InterceptorsListRequestSchema = z.object({
  method: z.literal('interceptors/list'),
  params: z
    .object({
      event: z.string().optional(),
    })
    .passthrough()
    .optional(),
})

export const InterceptorInvokeRequestSchema = z.object({
  method: z.literal('interceptor/invoke'),
  params: z
    .object({
      name: z.string(),
      event: z.string(),
      phase: z.enum(['request', 'response']),
      payload: z.unknown(),
      config: z.record(z.string(), z.unknown()).optional(),
      timeoutMs: z.number().int().positive().optional(),
      context: InvocationContextSchema.optional(),
    })
    .passthrough(),
})

const InterceptorDescriptorSchema = z.object({
  name: z.string(),
  version: z.string(),
  description: z.string(),
  type: z.literal('validation'),
  hooks: z.array(
    z.object({
      events: z.array(z.string()),
      phase: z.enum(['request', 'response']),
    }),
  ),
  mode: z.literal('audit'),
  failOpen: z.literal(true),
  compat: z.object({ minProtocol: z.string() }),
})

export const InterceptorsListResultSchema = z.object({
  interceptors: z.array(InterceptorDescriptorSchema),
})

const PairingInfoSchema = z.object({
  status: z.enum(['pending_response', 'paired', 'unpaired', 'conflict']),
  operation_key: z.string().optional(),
  reason: z.string().optional(),
})

export const InterceptorValidationResultSchema = z.object({
  interceptor: z.literal(INTERCEPTOR_NAME),
  type: z.literal('validation'),
  phase: z.enum(['request', 'response']),
  durationMs: z.number().nonnegative(),
  valid: z.literal(true),
  severity: z.literal('info'),
  info: z
    .object({
      pairing: PairingInfoSchema,
      [ATTRIBUTION_EXTENSION_ID]: z.unknown().optional(),
    })
    .passthrough(),
})

type InterceptorsListRequest = z.infer<typeof InterceptorsListRequestSchema>
type InterceptorInvokeRequest = z.infer<typeof InterceptorInvokeRequestSchema>
type InterceptorsListResult = z.infer<typeof InterceptorsListResultSchema>
type InterceptorValidationResult = z.infer<typeof InterceptorValidationResultSchema>
type AuditRequest = InterceptorsListRequest | InterceptorInvokeRequest
type AuditResult = InterceptorsListResult | InterceptorValidationResult

export type InterceptorInvocationParams = InterceptorInvokeRequest['params']

interface OperationIdentity {
  event: string
  trace_id: string
  span_id: string
  session_id?: string
}

interface PendingRequest {
  identity: OperationIdentity
  payload: unknown
  requestHash: string
}

export interface AuditSidecar {
  operation_key: string
  request: {
    identity: OperationIdentity
    payload: unknown
  }
  response: {
    payload: unknown
  }
  record_hash: string
}

export interface VerifiableAuditInterceptorOptions {
  privateKey?: Uint8Array
  now?: () => number
}

export class VerifiableAuditInterceptor {
  readonly records: AtribRecord[] = []
  readonly sidecars: AuditSidecar[] = []

  private readonly pending = new Map<string, PendingRequest>()
  private readonly privateKey: Uint8Array
  private readonly now: () => number
  private creatorKey?: string

  constructor(options: VerifiableAuditInterceptorOptions = {}) {
    this.privateKey = options.privateKey ?? DEFAULT_PRIVATE_KEY
    this.now = options.now ?? Date.now
  }

  list(event?: string): InterceptorsListResult {
    const hooks = [
      { events: ['tools/call'], phase: 'request' as const },
      { events: ['tools/call'], phase: 'response' as const },
    ]
    const supportsEvent = event === undefined || hooks.some((hook) => hook.events.includes(event))

    return {
      interceptors: supportsEvent
        ? [
            {
              name: INTERCEPTOR_NAME,
              version: '0.1.0',
              description:
                'Commits paired MCP tool requests and outcomes to signed atrib receipts.',
              type: 'validation',
              hooks,
              mode: 'audit',
              failOpen: true,
              compat: { minProtocol: '2025-06-18' },
            },
          ]
        : [],
    }
  }

  async invoke(params: InterceptorInvocationParams): Promise<InterceptorValidationResult> {
    const startedAt = performance.now()
    if (params.name !== INTERCEPTOR_NAME) {
      throw new McpError(ErrorCode.InvalidParams, `unknown interceptor: ${params.name}`)
    }
    if (params.event !== 'tools/call') {
      throw new McpError(ErrorCode.InvalidParams, `unsupported lifecycle event: ${params.event}`)
    }
    const identity = operationIdentity(params)

    if (!identity) {
      return validationResult(params.phase, startedAt, {
        status: 'unpaired',
        reason: 'traceId and spanId are required to pair request and response phases',
      })
    }

    const operationKey = hashCanonical(identity)

    if (params.phase === 'request') {
      const requestHash = hashCanonical({ identity, payload: params.payload })
      const existing = this.pending.get(operationKey)
      if (existing && existing.requestHash !== requestHash) {
        return validationResult(params.phase, startedAt, {
          status: 'conflict',
          operation_key: operationKey,
          reason: 'the operation identity was reused for a different request payload',
        })
      }

      this.pending.set(operationKey, { identity, payload: params.payload, requestHash })
      return validationResult(params.phase, startedAt, {
        status: 'pending_response',
        operation_key: operationKey,
      })
    }

    const request = this.pending.get(operationKey)
    if (!request) {
      return validationResult(params.phase, startedAt, {
        status: 'unpaired',
        operation_key: operationKey,
        reason: 'no request phase was recorded under this operation identity',
      })
    }

    this.pending.delete(operationKey)
    const record = await this.signCompletedCall(request, params.payload, operationKey)
    const block = buildAttributionReceipt(record, {
      includeRecord: true,
      logSubmission: 'disabled',
    })

    return validationResult(
      params.phase,
      startedAt,
      { status: 'paired', operation_key: operationKey },
      block,
    )
  }

  private async signCompletedCall(
    request: PendingRequest,
    responsePayload: unknown,
    operationKey: string,
  ): Promise<AtribRecord> {
    this.creatorKey ??= base64urlEncode(await getPublicKey(this.privateKey))
    const contextId = hexEncode(sha256(new TextEncoder().encode(operationKey))).slice(0, 32)
    const toolName = readToolName(request.payload) ?? 'tools/call'
    const record = await signRecord(
      {
        spec_version: 'atrib/1.0',
        content_id: computeContentId('mcp+interceptor://atrib-verifiable-audit', toolName),
        creator_key: this.creatorKey,
        chain_root: genesisChainRoot(contextId),
        event_type: EVENT_TYPE_TOOL_CALL_URI,
        context_id: contextId,
        timestamp: this.now(),
        signature: '',
        args_hash: hashCanonical({ identity: request.identity, payload: request.payload }),
        result_hash: hashCanonical({ identity: request.identity, payload: responsePayload }),
        tool_name: toolName,
      },
      this.privateKey,
    )
    const recordHash = `sha256:${hexEncode(sha256(canonicalRecord(record)))}`

    this.records.push(record)
    this.sidecars.push({
      operation_key: operationKey,
      request: { identity: request.identity, payload: request.payload },
      response: { payload: responsePayload },
      record_hash: recordHash,
    })
    return record
  }
}

export interface McpInterceptorAuditProof {
  sdk: {
    package: '@modelcontextprotocol/sdk'
    transport: 'InMemoryTransport'
    methods: ['interceptors/list', 'interceptor/invoke']
    capability_declared: boolean
  }
  discovery: InterceptorsListResult
  paired: {
    request: InterceptorValidationResult
    response: InterceptorValidationResult
    receipt_valid: boolean
    record_valid: boolean
    record_hash: string
    args_hash: string
    result_hash: string
  }
  missing_identity: {
    response: InterceptorValidationResult
    receipt_emitted: boolean
  }
  privacy: {
    private_phrase: string
    private_sidecar_contains_phrase: boolean
    public_record_contains_phrase: boolean
  }
}

export async function runMcpInterceptorAuditProof(): Promise<McpInterceptorAuditProof> {
  const privatePhrase = 'private customer refund reason'
  const interceptor = new VerifiableAuditInterceptor({ now: () => 1_784_380_800_000 })
  const server = createAuditServer(interceptor)
  const client = new Client<AuditRequest, Notification, AuditResult>(
    { name: 'atrib-interceptor-proof-client', version: '0.1.0' },
    { capabilities: {} },
  )
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()

  try {
    await server.connect(serverTransport)
    await client.connect(clientTransport)

    const discovery = await client.request(
      { method: 'interceptors/list', params: { event: 'tools/call' } },
      InterceptorsListResultSchema,
    )
    const context = {
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      spanId: '00f067aa0ba902b7',
      sessionId: 'refund-review-17',
      timestamp: '2026-07-19T12:00:00.000Z',
    }
    const request = await client.request(
      {
        method: 'interceptor/invoke',
        params: {
          name: INTERCEPTOR_NAME,
          event: 'tools/call',
          phase: 'request',
          payload: {
            method: 'tools/call',
            params: {
              name: 'issue_refund',
              arguments: { order_id: 'ord-17', reason: privatePhrase },
            },
          },
          context,
        },
      },
      InterceptorValidationResultSchema,
    )
    const response = await client.request(
      {
        method: 'interceptor/invoke',
        params: {
          name: INTERCEPTOR_NAME,
          event: 'tools/call',
          phase: 'response',
          payload: { content: [{ type: 'text', text: 'refund accepted' }] },
          context,
        },
      },
      InterceptorValidationResultSchema,
    )
    const unpairedResponse = await client.request(
      {
        method: 'interceptor/invoke',
        params: {
          name: INTERCEPTOR_NAME,
          event: 'tools/call',
          phase: 'response',
          payload: { content: [{ type: 'text', text: 'orphan response' }] },
          context: { traceId: context.traceId },
        },
      },
      InterceptorValidationResultSchema,
    )

    const block = response.info[ATTRIBUTION_EXTENSION_ID] as AttributionResultBlock
    const record = block.record
    if (!record) throw new Error('paired response did not include the signed record')
    const verification = await verifyRecord(record)

    return {
      sdk: {
        package: '@modelcontextprotocol/sdk',
        transport: 'InMemoryTransport',
        methods: ['interceptors/list', 'interceptor/invoke'],
        capability_declared: Boolean(
          client.getServerCapabilities()?.extensions?.[INTERCEPTORS_EXTENSION_ID],
        ),
      },
      discovery,
      paired: {
        request,
        response,
        receipt_valid: verifyAttributionReceipt(block).valid,
        record_valid: verification.valid,
        record_hash: block.receipt.record_hash,
        args_hash: record.args_hash ?? '',
        result_hash: record.result_hash ?? '',
      },
      missing_identity: {
        response: unpairedResponse,
        receipt_emitted: ATTRIBUTION_EXTENSION_ID in unpairedResponse.info,
      },
      privacy: {
        private_phrase: privatePhrase,
        private_sidecar_contains_phrase: JSON.stringify(interceptor.sidecars).includes(
          privatePhrase,
        ),
        public_record_contains_phrase: JSON.stringify(interceptor.records).includes(privatePhrase),
      },
    }
  } finally {
    await clientTransport.close()
    await serverTransport.close()
  }
}

export function createAuditServer(
  interceptor: VerifiableAuditInterceptor,
): Server<AuditRequest, Notification, AuditResult> {
  const server = new Server<AuditRequest, Notification, AuditResult>(
    { name: 'atrib-verifiable-audit-interceptor', version: '0.1.0' },
    {
      capabilities: {
        extensions: {
          [INTERCEPTORS_EXTENSION_ID]: { supportedEvents: ['tools/call'] },
        },
      },
    },
  )

  server.setRequestHandler(InterceptorsListRequestSchema, ({ params }) =>
    interceptor.list(params?.event),
  )
  server.setRequestHandler(InterceptorInvokeRequestSchema, ({ params }) =>
    interceptor.invoke(params),
  )
  return server
}

function operationIdentity(params: InterceptorInvocationParams): OperationIdentity | undefined {
  const traceId = params.context?.traceId
  const spanId = params.context?.spanId
  if (!traceId || !spanId) return undefined
  return {
    event: params.event,
    trace_id: traceId,
    span_id: spanId,
    ...(params.context?.sessionId ? { session_id: params.context.sessionId } : {}),
  }
}

function validationResult(
  phase: 'request' | 'response',
  startedAt: number,
  pairing: z.infer<typeof PairingInfoSchema>,
  receipt?: AttributionResultBlock,
): InterceptorValidationResult {
  return {
    interceptor: INTERCEPTOR_NAME,
    type: 'validation',
    phase,
    durationMs: Math.max(0, performance.now() - startedAt),
    valid: true,
    severity: 'info',
    info: {
      pairing,
      ...(receipt ? { [ATTRIBUTION_EXTENSION_ID]: receipt } : {}),
    },
  }
}

function readToolName(payload: unknown): string | undefined {
  if (!isRecord(payload) || !isRecord(payload.params)) return undefined
  return typeof payload.params.name === 'string' ? payload.params.name : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hashCanonical(value: unknown): string {
  const encoded = canonicalize(value)
  if (!encoded) throw new Error('failed to canonicalize MCP interceptor audit material')
  return `sha256:${hexEncode(sha256(new TextEncoder().encode(encoded)))}`
}
