// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  ATTRIBUTION_EXTENSION_ID,
  INTERCEPTOR_NAME,
  VerifiableAuditInterceptor,
  runMcpInterceptorAuditProof,
} from '../src/mcp-interceptor-audit.js'

describe('MCP verifiable audit interceptor', () => {
  it('pairs request and response phases over the experimental MCP methods', async () => {
    const result = await runMcpInterceptorAuditProof()

    expect(result.sdk).toEqual({
      package: '@modelcontextprotocol/sdk',
      transport: 'InMemoryTransport',
      methods: ['interceptors/list', 'interceptor/invoke'],
      capability_declared: true,
    })
    expect(result.discovery.interceptors).toHaveLength(1)
    expect(result.discovery.interceptors[0]?.name).toBe(INTERCEPTOR_NAME)
    expect(result.paired.request.info.pairing.status).toBe('pending_response')
    expect(result.paired.response.info.pairing.status).toBe('paired')
    expect(result.paired.receipt_valid).toBe(true)
    expect(result.paired.record_valid).toBe(true)
    expect(result.paired.record_hash).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(result.paired.args_hash).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(result.paired.result_hash).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(result.privacy.private_sidecar_contains_phrase).toBe(true)
    expect(result.privacy.public_record_contains_phrase).toBe(false)
  })

  it('does not emit a receipt when the response lacks an exact operation identity', async () => {
    const result = await runMcpInterceptorAuditProof()

    expect(result.missing_identity.response.info.pairing).toEqual({
      status: 'unpaired',
      reason: 'traceId and spanId are required to pair request and response phases',
    })
    expect(result.missing_identity.receipt_emitted).toBe(false)
  })

  it('surfaces operation identity reuse without replacing the first request', async () => {
    const interceptor = new VerifiableAuditInterceptor()
    const context = { traceId: 'trace-1', spanId: 'span-1' }
    const first = await interceptor.invoke({
      name: INTERCEPTOR_NAME,
      event: 'tools/call',
      phase: 'request',
      payload: { params: { name: 'read_file', arguments: { path: 'one.txt' } } },
      context,
    })
    const conflict = await interceptor.invoke({
      name: INTERCEPTOR_NAME,
      event: 'tools/call',
      phase: 'request',
      payload: { params: { name: 'read_file', arguments: { path: 'two.txt' } } },
      context,
    })

    expect(first.info.pairing.status).toBe('pending_response')
    expect(conflict.info.pairing.status).toBe('conflict')
    expect(conflict.info).not.toHaveProperty(ATTRIBUTION_EXTENSION_ID)
    expect(interceptor.records).toHaveLength(0)
  })

  it('rejects unknown interceptors and lifecycle events', async () => {
    const interceptor = new VerifiableAuditInterceptor()
    const base = {
      event: 'tools/call',
      phase: 'request' as const,
      payload: {},
      context: { traceId: 'trace-1', spanId: 'span-1' },
    }

    await expect(interceptor.invoke({ ...base, name: 'other-interceptor' })).rejects.toThrow(
      'unknown interceptor: other-interceptor',
    )
    await expect(
      interceptor.invoke({ ...base, name: INTERCEPTOR_NAME, event: 'resources/read' }),
    ).rejects.toThrow('unsupported lifecycle event: resources/read')
    expect(interceptor.records).toHaveLength(0)
  })
})
