// SPDX-License-Identifier: Apache-2.0

/**
 * Cloudflare Agents packet proof.
 *
 * This test exercises the client-side Cloudflare Agent adapter against a real
 * in-process log. It proves the path this packet claims:
 *
 *   Agent.addMcpServer connection
 *     -> attributeCloudflareAgentMcp()
 *     -> @atrib/agent interceptor
 *     -> ACP completion detection
 *     -> signed transaction record
 *     -> @atrib/log-node inclusion proof
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import * as ed from '@noble/ed25519'
import { sha512 } from '@noble/hashes/sha2.js'
import {
  atrib,
  attributeCloudflareAgentMcp,
  type CloudflareAgentLike,
  type MinimalMcpClient,
} from '@atrib/agent'
import {
  base64urlEncode,
  canonicalRecord,
  hexEncode,
  sha256,
  signRecord,
  verifyInclusion,
  verifyRecord,
  type AtribRecord,
  type ProofBundle,
} from '@atrib/mcp'
import {
  handoffClaimsFromEvidencePacket,
  verifyHandoffClaims,
  verifyRecord as verifyAtribRecord,
} from '@atrib/verify'
import { parseCheckpointBody, startLogServer, type LogServer } from '@atrib/log-node'

ed.hashes.sha512 = sha512

const AGENT_PRIVATE_KEY = new Uint8Array(32).fill(88)
const AGENT_PRIVATE_KEY_B64 = base64urlEncode(AGENT_PRIVATE_KEY)
const AUDIT_AGENT_PRIVATE_KEY = new Uint8Array(32).fill(89)
const CHECKOUT_SERVER_URL = 'https://checkout.example.com'
const LOG_PATH = '/v1/entries'

interface CapturedSubmission {
  record: AtribRecord
  proof: ProofBundle
  priority: string | null
}

function makeFakeClient(onCall: (params: unknown) => unknown): MinimalMcpClient {
  return {
    async callTool(params) {
      return onCall(params) as Awaited<ReturnType<MinimalMcpClient['callTool']>>
    },
  }
}

function makeFakeAgent(
  connections: Record<string, { client: MinimalMcpClient; url?: URL | string }>,
): CloudflareAgentLike {
  return {
    mcp: {
      mcpConnections: connections,
    },
  }
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return input.url
}

function headerValue(headers: HeadersInit | undefined, name: string): string | null {
  if (!headers) return null
  if (headers instanceof Headers) return headers.get(name)
  if (Array.isArray(headers)) {
    const found = headers.find(([key]) => key.toLowerCase() === name.toLowerCase())
    return found?.[1] ?? null
  }
  const key = Object.keys(headers).find(
    (candidate) => candidate.toLowerCase() === name.toLowerCase(),
  )
  return key ? String((headers as Record<string, string>)[key]) : null
}

function recordHash(record: AtribRecord): string {
  return `sha256:${hexEncode(sha256(canonicalRecord(record)))}`
}

function hashText(value: string): string {
  return `sha256:${hexEncode(sha256(new TextEncoder().encode(value)))}`
}

async function makeAuditFollowup(informedBy: string[]): Promise<AtribRecord> {
  const creatorKey = base64urlEncode(await ed.getPublicKeyAsync(AUDIT_AGENT_PRIVATE_KEY))
  return signRecord(
    {
      spec_version: 'atrib/1.0',
      content_id: hashText(`cf-packet-audit:${informedBy.join(',')}`),
      creator_key: creatorKey,
      chain_root: 'sha256:' + '9'.repeat(64),
      event_type: 'https://atrib.dev/v1/types/observation',
      context_id: '8'.repeat(32),
      timestamp: Date.now(),
      informed_by: [...informedBy].sort(),
      signature: '',
    } as AtribRecord,
    AUDIT_AGENT_PRIVATE_KEY,
  )
}

describe('Cloudflare Agent packet proof', () => {
  let logServer: LogServer

  beforeAll(async () => {
    logServer = await startLogServer({
      port: 0,
      logPrivateKey: ed.utils.randomSecretKey(),
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  afterAll(async () => {
    await logServer.close()
  })

  it('emits a signed transaction record for an unwrapped upstream checkout response', async () => {
    const nativeFetch = globalThis.fetch.bind(globalThis)
    const captured: CapturedSubmission[] = []

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const response = await nativeFetch(input, init)
      const url = requestUrl(input)
      const method = init?.method?.toUpperCase() ?? 'GET'
      if (method === 'POST' && url === `${logServer.url}${LOG_PATH}` && init?.body) {
        const record = JSON.parse(String(init.body)) as AtribRecord
        const proof = (await response.clone().json()) as ProofBundle
        captured.push({
          record,
          proof,
          priority: headerValue(init.headers, 'X-atrib-Priority'),
        })
      }
      return response
    })

    const upstreamCalls: unknown[] = []
    const agent = makeFakeAgent({
      checkout: {
        client: makeFakeClient((params) => {
          upstreamCalls.push(params)
          return {
            id: 'checkout_session_cf_packet',
            status: 'completed',
            order: {
              id: 'order_cf_packet',
              permalink_url: 'https://merchant.example/orders/order_cf_packet',
            },
          }
        }),
        url: new URL(`${CHECKOUT_SERVER_URL}/mcp`),
      },
    })

    const interceptor = atrib({
      creatorKey: AGENT_PRIVATE_KEY_B64,
      logEndpoint: `${logServer.url}${LOG_PATH}`,
      sessionToken: 'cf-packet-session',
    })

    const wrapped = attributeCloudflareAgentMcp(agent, { interceptor })
    expect(wrapped).toBe(1)

    const checkoutClient = agent.mcp.mcpConnections.checkout!.client as MinimalMcpClient
    const result = await checkoutClient.callTool({
      name: 'complete_checkout',
      arguments: { checkout_session_id: 'checkout_session_cf_packet' },
    })

    expect(result.status).toBe('completed')
    expect(upstreamCalls).toHaveLength(1)
    expect(
      (upstreamCalls[0] as { _meta?: Record<string, unknown> })._meta?.traceparent as string,
    ).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/)

    await interceptor.flush()

    expect(captured).toHaveLength(1)
    const submission = captured[0]!
    const hash = recordHash(submission.record)

    expect(submission.priority).toBe('high')
    expect(submission.record.event_type).toBe('https://atrib.dev/v1/types/transaction')
    expect(submission.record.session_token).toBe('cf-packet-session')
    await expect(verifyRecord(submission.record)).resolves.toBe(true)

    const recent = (await nativeFetch(`${logServer.url}/v1/recent?limit=5`).then((res) =>
      res.json(),
    )) as {
      entries: Array<{
        record_hash: string
        creator_key: string
        event_type: string
        event_type_byte: number
      }>
    }
    const decoded = recent.entries.find((entry) => entry.record_hash === hash)
    expect(decoded).toMatchObject({
      record_hash: hash,
      creator_key: submission.record.creator_key,
      event_type: 'transaction',
      event_type_byte: 0x02,
    })

    const checkpointBody = submission.proof.checkpoint.split('\n\n')[0]! + '\n'
    const parsedCheckpoint = parseCheckpointBody(checkpointBody)
    const rootHash = new Uint8Array(Buffer.from(parsedCheckpoint.rootHash, 'base64'))
    const leafHash = new Uint8Array(Buffer.from(submission.proof.leaf_hash, 'base64'))
    const proofHashes = submission.proof.inclusion_proof.map(
      (item) => new Uint8Array(Buffer.from(item, 'base64')),
    )

    expect(
      verifyInclusion(
        submission.proof.log_index,
        parsedCheckpoint.treeSize,
        leafHash,
        proofHashes,
        rootHash,
      ),
    ).toBe(true)

    const handoff = await verifyHandoffClaims(
      handoffClaimsFromEvidencePacket({
        kind: 'cloudflare_agent_packet',
        required_record_hashes: [hash],
        records: [
          {
            record_hash: hash,
            record: submission.record,
            proof: submission.proof,
          },
        ],
      }),
      {
        trusted_creator_keys: [submission.record.creator_key],
        allowed_context_ids: [submission.record.context_id],
        require_log_inclusion: true,
        log_public_key: logServer.logPublicKey,
        now_ms: Date.now(),
        max_age_ms: 60_000,
      },
    )

    expect(handoff.accepted_record_hashes).toEqual([hash])
    expect(handoff.rejected).toEqual([])

    const auditRecord = await makeAuditFollowup(handoff.accepted_record_hashes)
    const auditVerification = await verifyAtribRecord(auditRecord, {
      informedByCandidates: [submission.record],
    })

    expect(auditVerification.signatureOk).toBe(true)
    expect(auditVerification.informed_by_resolution?.resolved).toEqual([hash])
  })
})
