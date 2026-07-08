// SPDX-License-Identifier: Apache-2.0

import { createHash } from 'node:crypto'
import * as ed from '@noble/ed25519'
import {
  ACTION_GATE_DECISION_EVENT_TYPE_URI,
  ACTION_GATE_OUTCOME_EVENT_TYPE_URI,
  runGatedAction,
  type ActionGateActionEnvelope,
  type ActionGatePolicyDecision,
  type Sha256Uri,
} from '@atrib/action-gate'
import { atrib, detectTransaction } from '@atrib/agent'
import {
  base64urlDecode,
  base64urlEncode,
  canonicalCrossAttestationInput,
  canonicalRecord,
  computeContentId,
  signTransactionAttestation,
  type AtribRecord,
} from '@atrib/mcp'

const AGENT_PRIVATE_KEY = new Uint8Array(32).fill(42)
const MERCHANT_PRIVATE_KEY = new Uint8Array(32).fill(7)
const SESSION_TOKEN = 'cloudflare-x402-path-b-reference'
const TOOL_NAME = 'mcp.paid-dataset.lookup'
const PAID_ENDPOINT = 'https://worker.example/mcp/paid-dataset'
const TRACEPARENT_FALLBACK = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'
const PRICE = '0.01'
const ASSET = 'USDC'
const CLOUDFLARE_NETWORK = 'base-sepolia'
const CAIP2_NETWORK = 'eip155:84532'
const ROUTE_ID = 'route-paid-mcp-dataset'
const RULE_ID = 'rule-price-cap-usdc-cent'
const TRANSACTION_EVENT_TYPE = 'https://atrib.dev/v1/types/transaction'

interface RuntimeFakes {
  submissions: AtribRecord[]
  restore(): void
}

export interface CloudflareX402PathBReferenceResult {
  ok: true
  strategy: 'cloudflare-x402-path-b-reference-v1'
  scope: {
    cloudflare_runtime: 'workers-agents'
    x402_mode: 'local-v2-protocol-flow'
    gateway_beta_access: false
    real_funds_moved: false
    gateway_ingest_slot: 'future-lifecycle-export'
  }
  open_protocol_surface: {
    headers: {
      challenge_status: 402
      paid_retry_header: 'PAYMENT-SIGNATURE'
      settlement_header: 'PAYMENT-RESPONSE'
      legacy_settlement_header: 'X-PAYMENT-RESPONSE'
    }
    cloudflare_agents_sdk: {
      server: readonly ['paidTool', 'withX402']
      client: readonly ['withX402Client']
      test_network: typeof CLOUDFLARE_NETWORK
    }
    x402_open_source: {
      http_client: '@x402/fetch wrapFetchWithPayment'
      hono_server: '@x402/hono paymentMiddleware'
      mcp_server: '@x402/mcp createPaymentWrapper'
      mcp_client: '@x402/mcp createx402MCPClient'
      protocol_version: 2
    }
  }
  atrib_product_surface: {
    action_gate_package: '@atrib/action-gate'
    agent_package: '@atrib/agent'
    detector: 'PAYMENT-RESPONSE'
    event_types: {
      decision: typeof ACTION_GATE_DECISION_EVENT_TYPE_URI
      outcome: typeof ACTION_GATE_OUTCOME_EVENT_TYPE_URI
      transaction: typeof TRANSACTION_EVENT_TYPE
    }
  }
  paid_action: {
    run_id: string
    action_id: string
    agent_id: string
    surface: string
    tool_name: string
    risk: readonly string[]
    price: typeof PRICE
    asset: typeof ASSET
    cloudflare_network: typeof CLOUDFLARE_NETWORK
    caip2_network: typeof CAIP2_NETWORK
    route_id: typeof ROUTE_ID
    rule_id: typeof RULE_ID
  }
  x402_flow: {
    first_response_status: 402
    paid_retry_sent: true
    origin_response_status: 200
    traceparent_preserved_across_retry: boolean
    atrib_context_preserved_across_retry: boolean
    challenge_hash: Sha256Uri
    payment_signature_hash: Sha256Uri
    payment_response_hash: Sha256Uri
    settlement_reference_hash: Sha256Uri
    origin_response_hash: Sha256Uri
  }
  signed_records: {
    decision_record_hash: Sha256Uri
    outcome_record_hash: Sha256Uri
    agent_transaction_record_hash: Sha256Uri
    counterparty_attested_transaction_hash: Sha256Uri
    decision_state: 'allowed'
    outcome_status: 'executed'
    transaction_protocol: 'x402'
    transaction_content_id: Sha256Uri
    transaction_content_id_matches_x402_endpoint: boolean
    transaction_context_matches_gate: boolean
    transaction_warning_recorded: boolean
    agent_transaction_signer_count: 1
    counterparty_attested_signer_count: 2
    counterparty_signers_valid: boolean
  }
  payment_lifecycle: {
    schema: 'atrib.cloudflare-x402-paid-request-lifecycle.v1'
    source: 'cloudflare_x402_v2_local_flow'
    stage: 'origin_response'
    request_id: string
    payment_attempt_id: string
    route_id: typeof ROUTE_ID
    rule_id: typeof RULE_ID
    method: 'POST'
    url_hash: Sha256Uri
    price: typeof PRICE
    asset: typeof ASSET
    cloudflare_network: typeof CLOUDFLARE_NETWORK
    caip2_network: typeof CAIP2_NETWORK
    payer_hash: Sha256Uri
    payee_hash: Sha256Uri
    challenge_hash: Sha256Uri
    payment_signature_hash: Sha256Uri
    payment_response_hash: Sha256Uri
    settlement_reference_hash: Sha256Uri
    origin_response_hash: Sha256Uri
    traceparent: string
    atrib_context_id: string
    agent_session_id: typeof SESSION_TOKEN
    decision_record_hash: Sha256Uri
    outcome_record_hash: Sha256Uri
    transaction_record_hash: Sha256Uri
    verify_status: 'verified'
    settle_status: 'settled'
  }
  proof: {
    action_allowed_before_paid_retry: boolean
    x402_detector_fired: boolean
    path_b_transaction_emitted_by_agent: boolean
    retry_kept_trace_context: boolean
    lifecycle_bound_to_decision: boolean
    lifecycle_bound_to_outcome: boolean
    lifecycle_bound_to_transaction: boolean
    lifecycle_uses_hash_only_payment_artifacts: boolean
    counterparty_attested_same_transaction_bytes: boolean
  }
  privacy: {
    raw_payment_challenge_omitted: true
    raw_payment_signature_omitted: true
    raw_payment_response_omitted: true
    raw_wallet_material_omitted: true
    raw_origin_payload_omitted: true
  }
  caveats: string[]
}

export async function runCloudflareX402PathBReference(): Promise<CloudflareX402PathBReferenceResult> {
  const fakes = installRuntimeFakes()
  try {
    const interceptor = atrib({
      creatorKey: base64urlEncode(AGENT_PRIVATE_KEY),
      sessionToken: SESSION_TOKEN,
      merchantDomain: 'https://merchant.example',
      serverUrls: [PAID_ENDPOINT],
      logEndpoint: 'https://log.local.test/v1/records',
    })

    const outboundMeta = await interceptor.onBeforeToolCall(TOOL_NAME, {})
    const sessionPolicy = interceptor.getSessionPolicyRecord()
    if (!sessionPolicy) {
      throw new Error('expected atrib session policy after first tool call')
    }

    const traceparent =
      typeof outboundMeta.traceparent === 'string' ? outboundMeta.traceparent : TRACEPARENT_FALLBACK
    const atribContextId = sessionPolicy.context_id
    const challenge = paymentChallengeFor(atribContextId)
    const paymentSignature = paymentSignatureFor(challenge)
    const paymentResponse = paymentResponseFor(challenge)
    const challengeHeader = encodeHeaderJson(challenge)
    const paymentSignatureHeader = encodeHeaderJson(paymentSignature)
    const paymentResponseHeader = encodeHeaderJson(paymentResponse)
    const originResponse = {
      content: [
        {
          type: 'text',
          text: 'paid dataset response is local test content',
        },
      ],
    }
    const settlementReferenceHash = hashJson({
      facilitator: 'local-x402-reference',
      transaction: paymentResponse.transaction,
      network: paymentResponse.network,
    })
    const action = paidActionFor({
      traceparent,
      atribContextId,
      challengeHash: hashString(challengeHeader),
      paymentResponseHash: hashString(paymentResponseHeader),
      settlementReferenceHash,
    })

    let gateTick = 1_780_500_000_000
    const gate = await runGatedAction({
      privateKey: AGENT_PRIVATE_KEY,
      contextId: atribContextId,
      action,
      evaluate: ({ action }) =>
        policyFor(action, hashString(challengeHeader), hashString(paymentResponseHeader)),
      execute: () => ({
        status: 'ok',
        request_id: 'cf-x402-path-b-req-001',
        payment_attempt_id: 'cf-x402-path-b-pay-001',
      }),
      now: () => gateTick++,
    })

    const retryHeaders = {
      'PAYMENT-SIGNATURE': paymentSignatureHeader,
      traceparent,
      'X-atrib-Context': atribContextId,
    }
    const responseHeaders = {
      'PAYMENT-RESPONSE': paymentResponseHeader,
    }
    const detection = detectTransaction(TOOL_NAME, originResponse, responseHeaders)

    interceptor.onAfterToolResponse(TOOL_NAME, originResponse, undefined, {
      headers: responseHeaders,
      serverUrl: PAID_ENDPOINT,
    })
    await interceptor.flush()

    const agentTransactionRecord = fakes.submissions.find(
      (record) => record.event_type === TRANSACTION_EVENT_TYPE,
    )
    if (!agentTransactionRecord) {
      throw new Error('expected agent-side x402 transaction record')
    }

    const counterpartySigner = await signTransactionAttestation(
      agentTransactionRecord,
      MERCHANT_PRIVATE_KEY,
    )
    const counterpartyAttestedTransaction = {
      ...agentTransactionRecord,
      signers: [...(agentTransactionRecord.signers ?? []), counterpartySigner],
    } as AtribRecord
    const counterpartySignersValid = await verifyAllTransactionSigners(
      counterpartyAttestedTransaction,
    )
    const expectedContentId = computeContentId(PAID_ENDPOINT, 'checkout') as Sha256Uri
    const agentTransactionRecordHash = recordHash(agentTransactionRecord)
    const counterpartyAttestedTransactionHash = recordHash(counterpartyAttestedTransaction)
    const lifecycle = {
      schema: 'atrib.cloudflare-x402-paid-request-lifecycle.v1' as const,
      source: 'cloudflare_x402_v2_local_flow' as const,
      stage: 'origin_response' as const,
      request_id: 'cf-x402-path-b-req-001',
      payment_attempt_id: 'cf-x402-path-b-pay-001',
      route_id: ROUTE_ID,
      rule_id: RULE_ID,
      method: 'POST' as const,
      url_hash: hashJson({ url: PAID_ENDPOINT }),
      price: PRICE,
      asset: ASSET,
      cloudflare_network: CLOUDFLARE_NETWORK,
      caip2_network: CAIP2_NETWORK,
      payer_hash: hashJson({ payer: paymentSignature.payload.from }),
      payee_hash: hashJson({ payee: challenge.accepts[0]!.payTo }),
      challenge_hash: hashString(challengeHeader),
      payment_signature_hash: hashString(paymentSignatureHeader),
      payment_response_hash: hashString(paymentResponseHeader),
      settlement_reference_hash: settlementReferenceHash,
      origin_response_hash: hashJson(originResponse),
      traceparent,
      atrib_context_id: atribContextId,
      agent_session_id: SESSION_TOKEN,
      decision_record_hash: gate.decision.record_hash,
      outcome_record_hash: gate.outcome.record_hash,
      transaction_record_hash: agentTransactionRecordHash,
      verify_status: 'verified' as const,
      settle_status: 'settled' as const,
    }

    const lifecycleHashes = [
      lifecycle.url_hash,
      lifecycle.payer_hash,
      lifecycle.payee_hash,
      lifecycle.challenge_hash,
      lifecycle.payment_signature_hash,
      lifecycle.payment_response_hash,
      lifecycle.settlement_reference_hash,
      lifecycle.origin_response_hash,
    ]
    const traceparentPreserved = retryHeaders.traceparent === traceparent
    const atribContextPreserved = retryHeaders['X-atrib-Context'] === atribContextId

    return {
      ok: true,
      strategy: 'cloudflare-x402-path-b-reference-v1',
      scope: {
        cloudflare_runtime: 'workers-agents',
        x402_mode: 'local-v2-protocol-flow',
        gateway_beta_access: false,
        real_funds_moved: false,
        gateway_ingest_slot: 'future-lifecycle-export',
      },
      open_protocol_surface: {
        headers: {
          challenge_status: 402,
          paid_retry_header: 'PAYMENT-SIGNATURE',
          settlement_header: 'PAYMENT-RESPONSE',
          legacy_settlement_header: 'X-PAYMENT-RESPONSE',
        },
        cloudflare_agents_sdk: {
          server: ['paidTool', 'withX402'],
          client: ['withX402Client'],
          test_network: CLOUDFLARE_NETWORK,
        },
        x402_open_source: {
          http_client: '@x402/fetch wrapFetchWithPayment',
          hono_server: '@x402/hono paymentMiddleware',
          mcp_server: '@x402/mcp createPaymentWrapper',
          mcp_client: '@x402/mcp createx402MCPClient',
          protocol_version: 2,
        },
      },
      atrib_product_surface: {
        action_gate_package: '@atrib/action-gate',
        agent_package: '@atrib/agent',
        detector: 'PAYMENT-RESPONSE',
        event_types: {
          decision: ACTION_GATE_DECISION_EVENT_TYPE_URI,
          outcome: ACTION_GATE_OUTCOME_EVENT_TYPE_URI,
          transaction: TRANSACTION_EVENT_TYPE,
        },
      },
      paid_action: {
        run_id: action.run_id,
        action_id: action.action_id,
        agent_id: action.agent_id,
        surface: action.surface,
        tool_name: action.tool_name,
        risk: action.risk ?? [],
        price: PRICE,
        asset: ASSET,
        cloudflare_network: CLOUDFLARE_NETWORK,
        caip2_network: CAIP2_NETWORK,
        route_id: ROUTE_ID,
        rule_id: RULE_ID,
      },
      x402_flow: {
        first_response_status: 402,
        paid_retry_sent: true,
        origin_response_status: 200,
        traceparent_preserved_across_retry: traceparentPreserved,
        atrib_context_preserved_across_retry: atribContextPreserved,
        challenge_hash: lifecycle.challenge_hash,
        payment_signature_hash: lifecycle.payment_signature_hash,
        payment_response_hash: lifecycle.payment_response_hash,
        settlement_reference_hash: lifecycle.settlement_reference_hash,
        origin_response_hash: lifecycle.origin_response_hash,
      },
      signed_records: {
        decision_record_hash: gate.decision.record_hash,
        outcome_record_hash: gate.outcome.record_hash,
        agent_transaction_record_hash: agentTransactionRecordHash,
        counterparty_attested_transaction_hash: counterpartyAttestedTransactionHash,
        decision_state: 'allowed',
        outcome_status: 'executed',
        transaction_protocol: 'x402',
        transaction_content_id: agentTransactionRecord.content_id as Sha256Uri,
        transaction_content_id_matches_x402_endpoint:
          agentTransactionRecord.content_id === expectedContentId,
        transaction_context_matches_gate: agentTransactionRecord.context_id === atribContextId,
        transaction_warning_recorded:
          interceptor
            .getSessionPolicyRecord()
            ?.warnings.includes('transaction_emitted_by_agent') ?? false,
        agent_transaction_signer_count: 1,
        counterparty_attested_signer_count: counterpartyAttestedTransaction.signers?.length ?? 0,
        counterparty_signers_valid: counterpartySignersValid,
      },
      payment_lifecycle: lifecycle,
      proof: {
        action_allowed_before_paid_retry: gate.state === 'allowed',
        x402_detector_fired: detection.detected && detection.protocol === 'x402',
        path_b_transaction_emitted_by_agent: Boolean(agentTransactionRecord),
        retry_kept_trace_context: traceparentPreserved && atribContextPreserved,
        lifecycle_bound_to_decision: lifecycle.decision_record_hash === gate.decision.record_hash,
        lifecycle_bound_to_outcome: lifecycle.outcome_record_hash === gate.outcome.record_hash,
        lifecycle_bound_to_transaction: lifecycle.transaction_record_hash === agentTransactionRecordHash,
        lifecycle_uses_hash_only_payment_artifacts: lifecycleHashes.every(isSha256Uri),
        counterparty_attested_same_transaction_bytes: counterpartySignersValid,
      },
      privacy: {
        raw_payment_challenge_omitted: true,
        raw_payment_signature_omitted: true,
        raw_payment_response_omitted: true,
        raw_wallet_material_omitted: true,
        raw_origin_payload_omitted: true,
      },
      caveats: [
        'This proof uses local x402 v2 headers and no live funds.',
        'It does not call Cloudflare Monetization Gateway beta APIs.',
        'A Gateway beta adapter should replace the local lifecycle source when Cloudflare exposes route, rule, payment attempt, settlement, and export fields.',
      ],
    }
  } finally {
    fakes.restore()
  }
}

function installRuntimeFakes(): RuntimeFakes {
  const submissions: AtribRecord[] = []
  const originalFetch = globalThis.fetch
  const originalNow = Date.now
  const originalGetRandomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto)
  let now = 1_780_500_100_000
  let randomByte = 0x10
  Date.now = () => now++
  Object.defineProperty(globalThis.crypto, 'getRandomValues', {
    configurable: true,
    value: <T extends ArrayBufferView>(array: T): T => {
      const view = new Uint8Array(array.buffer, array.byteOffset, array.byteLength)
      for (let index = 0; index < view.length; index++) {
        view[index] = (randomByte + index) & 0xff
      }
      randomByte = (randomByte + view.length) & 0xff
      return array
    },
  })
  globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
    const bodyText = typeof init?.body === 'string' ? init.body : undefined
    if (bodyText) {
      submissions.push(JSON.parse(bodyText) as AtribRecord)
    }
    return new Response(
      JSON.stringify({
        log_index: submissions.length,
        checkpoint: 'log.local.test/v1\n2\nrootHashBase64\n',
        inclusion_proof: [],
        leaf_hash: 'leafHashBase64',
      }),
      { status: 200 },
    )
  }
  return {
    submissions,
    restore() {
      globalThis.fetch = originalFetch
      Date.now = originalNow
      Object.defineProperty(globalThis.crypto, 'getRandomValues', {
        configurable: true,
        value: originalGetRandomValues,
      })
    },
  }
}

function paidActionFor(input: {
  traceparent: string
  atribContextId: string
  challengeHash: Sha256Uri
  paymentResponseHash: Sha256Uri
  settlementReferenceHash: Sha256Uri
}): ActionGateActionEnvelope {
  return {
    run_id: 'cloudflare-x402-path-b-reference',
    action_id: 'paid-dataset-retry-after-402',
    agent_id: 'cloudflare-agent-reference',
    surface: 'cloudflare-agents',
    tool_name: TOOL_NAME,
    args: {
      method: 'POST',
      url_hash: hashJson({ url: PAID_ENDPOINT }),
      request_body_hash: hashJson({ query: 'revenue benchmark by segment' }),
    },
    risk: ['payment', 'paid_mcp_tool', 'external_read'],
    refs: {
      traceparent: input.traceparent,
      atrib_context_id: input.atribContextId,
      challenge_hash: input.challengeHash,
      payment_response_hash: input.paymentResponseHash,
      settlement_reference_hash: input.settlementReferenceHash,
    },
  }
}

function policyFor(
  action: ActionGateActionEnvelope,
  challengeHash: Sha256Uri,
  paymentResponseHash: Sha256Uri,
): ActionGatePolicyDecision {
  const risk = new Set(action.risk ?? [])
  if (!risk.has('payment') || action.tool_name !== TOOL_NAME) {
    return {
      outcome: 'block',
      policy_id: 'cloudflare-x402-path-b-policy',
      policy_version: '2026-07-08.1',
      reason: 'only the fixed paid MCP reference action is allowed',
    }
  }
  return {
    outcome: 'allow',
    policy_id: 'cloudflare-x402-path-b-policy',
    policy_version: '2026-07-08.1',
    reason: 'paid MCP read is inside the reference price cap and has hash-only x402 evidence',
    authority: {
      mode: 'host-policy',
      principal_hash: hashJson({ host: 'cloudflare-agent-reference' }),
    },
    evidence: {
      price: `${PRICE} ${ASSET}`,
      cloudflare_network: CLOUDFLARE_NETWORK,
      caip2_network: CAIP2_NETWORK,
      route_id: ROUTE_ID,
      rule_id: RULE_ID,
      challenge_hash: challengeHash,
      payment_response_hash: paymentResponseHash,
    },
  }
}

function paymentChallengeFor(atribContextId: string) {
  return {
    x402Version: 2,
    accepts: [
      {
        scheme: 'exact',
        network: CAIP2_NETWORK,
        resource: PAID_ENDPOINT,
        description: 'paid MCP dataset reference',
        maxAmountRequired: '10000',
        asset: 'USDC',
        payTo: '0x2222222222222222222222222222222222222222',
        extra: {
          route_id: ROUTE_ID,
          rule_id: RULE_ID,
          atrib_context_id: atribContextId,
        },
      },
    ],
  }
}

function paymentSignatureFor(challenge: ReturnType<typeof paymentChallengeFor>) {
  return {
    x402Version: 2,
    scheme: 'exact',
    network: CAIP2_NETWORK,
    payload: {
      from: '0x1111111111111111111111111111111111111111',
      to: challenge.accepts[0]!.payTo,
      value: '10000',
      validAfter: '2026-07-08T00:00:00Z',
      validBefore: '2026-07-08T00:05:00Z',
      nonce: '0x' + 'ab'.repeat(32),
      resource: PAID_ENDPOINT,
    },
    signature: '0x' + 'cd'.repeat(65),
  }
}

function paymentResponseFor(challenge: ReturnType<typeof paymentChallengeFor>) {
  return {
    success: true,
    transaction: '0x' + 'ef'.repeat(32),
    network: CAIP2_NETWORK,
    payer: '0x1111111111111111111111111111111111111111',
    requirements: challenge.accepts[0],
  }
}

async function verifyAllTransactionSigners(record: AtribRecord): Promise<boolean> {
  const input = canonicalCrossAttestationInput(record)
  const entries = record.signers ?? []
  if (entries.length < 2) return false
  const results = await Promise.all(
    entries.map((entry) =>
      ed.verifyAsync(
        base64urlDecode(entry.signature),
        input,
        base64urlDecode(entry.creator_key),
      ),
    ),
  )
  return results.every(Boolean)
}

function recordHash(record: AtribRecord): Sha256Uri {
  return `sha256:${createHash('sha256').update(canonicalRecord(record)).digest('hex')}`
}

function hashJson(value: unknown): Sha256Uri {
  return hashString(stableJson(value))
}

function hashString(value: string): Sha256Uri {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

function encodeHeaderJson(value: unknown): string {
  return Buffer.from(stableJson(value), 'utf8').toString('base64url')
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJson(value))
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortJson(item)]),
    )
  }
  return value
}

function isSha256Uri(value: string): value is Sha256Uri {
  return /^sha256:[0-9a-f]{64}$/u.test(value)
}

const result = await runCloudflareX402PathBReference()
console.log(JSON.stringify(result, null, 2))
