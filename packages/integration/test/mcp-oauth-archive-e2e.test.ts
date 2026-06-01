// SPDX-License-Identifier: Apache-2.0

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { describe, expect, it } from 'vitest'
import { bindArchiveServer } from '@atrib/archive-node'
import { canonicalRecord, hexEncode, sha256, type AtribRecord, type ProofBundle } from '@atrib/mcp'
import { startLogServer } from '@atrib/log-node'
import {
  introspectOAuthToken,
  MemoryDpopReplayCache,
  oauthEvidenceFromIntrospectionResult,
  verifyRecord,
  type AuthorizationEvidenceInput,
  type EvidenceVerificationBlock,
} from '@atrib/verify'
import { runMcpOAuthEvidenceHarness } from '../src/mcp-oauth-evidence-harness.js'

function hashRecord(record: AtribRecord): string {
  return `sha256:${hexEncode(sha256(canonicalRecord(record)))}`
}

async function submitRecord(logUrl: string, record: AtribRecord): Promise<ProofBundle> {
  const res = await fetch(`${logUrl}/v1/entries`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(record),
  })
  expect(res.status).toBe(200)
  return (await res.json()) as ProofBundle
}

async function bindIntrospectionServer(): Promise<{
  url: string
  requests: Array<{ authorization: string | null; body: string }>
  close(): Promise<void>
}> {
  const requests: Array<{ authorization: string | null; body: string }> = []
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }
    requests.push({
      authorization: req.headers.authorization ?? null,
      body: Buffer.concat(chunks).toString('utf8'),
    })
    res.statusCode = 200
    res.setHeader('content-type', 'application/json')
    res.end(
      JSON.stringify({
        active: true,
        iss: 'https://issuer.example',
        sub: 'agent-introspected',
        client_id: 'client-introspection',
        scope: 'tools:read tools:write',
        resource: 'https://mcp.example.com/mcp',
      }),
    )
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('missing introspection address')

  return {
    url: `http://127.0.0.1:${address.port}/introspect`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()))
      }),
  }
}

describe('MCP OAuth evidence archive E2E', () => {
  it('archives producer-captured MCP OAuth evidence as Explorer-ready evidence', async () => {
    const harness = await runMcpOAuthEvidenceHarness()
    const log = await startLogServer({ port: 0 })
    const archive = await bindArchiveServer(0, '127.0.0.1', {
      origin: 'archive.test/v1',
      trustedLogEndpoints: [`${log.url}/v1`],
    })
    try {
      const proof = await submitRecord(log.url, harness.record)
      const hash = hashRecord(harness.record)
      if (!harness.sidecar.authorizationEvidence) {
        throw new Error('harness did not capture authorization evidence')
      }
      const capturedAuthorizationEvidence =
        harness.sidecar.authorizationEvidence as AuthorizationEvidenceInput[]

      const cache = new MemoryDpopReplayCache({ nowSeconds: () => 1_800_000_000 })
      const authorizationEvidence = capturedAuthorizationEvidence.map((entry) => ({
        ...entry,
        dpopReplayCache: cache,
      }))
      const verificationOptions = {
        authorizationEvidence,
        ...(harness.sidecar.resolvedFacts ? { resolvedFacts: harness.sidecar.resolvedFacts } : {}),
      }
      const first = await verifyRecord(harness.record, verificationOptions)
      expect(first.valid).toBe(true)
      expect(first.evidence?.[0]?.valid).toBe(true)

      const replay = await verifyRecord(harness.record, verificationOptions)
      expect(replay.evidence?.[0]?.valid).toBe(false)
      expect(replay.evidence?.[0]?.constraints).toContainEqual(
        expect.objectContaining({
          type: 'dpop.jti',
          status: 'failed',
          reason: 'jti already seen',
        }),
      )

      const submit = await fetch(`${archive.url}/v1/records`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          record: harness.record,
          proof,
          _local: harness.sidecar,
        }),
      })
      expect(submit.status).toBe(201)

      const evidence = await fetch(`${archive.url}/v1/evidence/${hash.slice('sha256:'.length)}`)
      expect(evidence.status).toBe(200)
      const text = await evidence.text()
      expect(text).not.toContain('fixture-access-token')
      const body = JSON.parse(text) as {
        record_hash: string
        evidence: EvidenceVerificationBlock[]
        resolved_facts?: { tool_name?: string }
      }
      expect(body.record_hash).toBe(hash)
      expect(body.resolved_facts).toEqual({ tool_name: 'read_file' })
      expect(body.evidence).toHaveLength(1)
      expect(body.evidence[0]).toMatchObject({
        protocol: 'mcp_oauth',
        valid: true,
        issuer: 'https://auth.example.com',
        subject: 'user-123',
        attenuation_ok: true,
        delegation_ok: null,
      })
      expect(body.evidence[0]?.scope).toEqual(['files:read', 'files:write'])
      expect(body.evidence[0]?.constraints).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'scope', status: 'passed' }),
          expect.objectContaining({ type: 'dpop.htm', status: 'passed' }),
          expect.objectContaining({ type: 'dpop.htu', status: 'passed' }),
          expect.objectContaining({ type: 'dpop.ath', status: 'passed' }),
          expect.objectContaining({ type: 'dpop.cnf.jkt', status: 'passed' }),
        ]),
      )

      const retrieved = await fetch(`${archive.url}/v1/record/${hash.slice('sha256:'.length)}`)
      expect(retrieved.status).toBe(200)
      const full = (await retrieved.json()) as { record: AtribRecord; log_proofs: ProofBundle[] }
      expect(full.record).toEqual(harness.record)
      expect(full.log_proofs).toHaveLength(1)
    } finally {
      await archive.close()
      await log.close()
    }
  })

  it('archives host-owned introspection evidence without storing the raw token', async () => {
    const harness = await runMcpOAuthEvidenceHarness()
    const introspectionServer = await bindIntrospectionServer()
    const log = await startLogServer({ port: 0 })
    const archive = await bindArchiveServer(0, '127.0.0.1', {
      origin: 'archive.test/v1',
      trustedLogEndpoints: [`${log.url}/v1`],
    })
    try {
      const introspection = await introspectOAuthToken({
        endpoint: introspectionServer.url,
        token: 'secret-introspection-token',
        tokenTypeHint: 'access_token',
        clientAuthentication: {
          method: 'bearer',
          token: 'host-owned-introspection-secret',
        },
        expectedIssuer: 'https://issuer.example',
        expectedResource: 'https://mcp.example.com/mcp',
      })
      expect(introspection.ok).toBe(true)
      expect(introspectionServer.requests[0]?.authorization).toBe(
        'Bearer host-owned-introspection-secret',
      )
      expect(introspectionServer.requests[0]?.body).toContain('token=secret-introspection-token')
      expect(JSON.stringify(introspection)).not.toContain('secret-introspection-token')

      const authorizationEvidence = [
        oauthEvidenceFromIntrospectionResult(introspection, {
          protocol: 'mcp_oauth',
          issuer: 'https://issuer.example',
          resource: 'https://mcp.example.com/mcp',
          requiredScopes: ['tools:read'],
          expectedClientId: 'client-introspection',
        }),
      ]
      const verification = await verifyRecord(harness.record, {
        authorizationEvidence,
        resolvedFacts: { tool_name: 'introspected_tool' },
      })
      expect(verification.valid).toBe(true)
      expect(verification.evidence?.[0]).toMatchObject({
        protocol: 'mcp_oauth',
        valid: true,
        subject: 'agent-introspected',
      })

      const proof = await submitRecord(log.url, harness.record)
      const hash = hashRecord(harness.record)
      const submit = await fetch(`${archive.url}/v1/records`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          record: harness.record,
          proof,
          evidence: verification.evidence,
          resolvedFacts: { tool_name: 'introspected_tool' },
        }),
      })
      expect(submit.status).toBe(201)

      const evidence = await fetch(`${archive.url}/v1/evidence/${hash.slice('sha256:'.length)}`)
      expect(evidence.status).toBe(200)
      const text = await evidence.text()
      expect(text).not.toContain('secret-introspection-token')
      const body = JSON.parse(text) as {
        evidence: EvidenceVerificationBlock[]
        resolved_facts?: { tool_name?: string }
      }
      expect(body.resolved_facts).toEqual({ tool_name: 'introspected_tool' })
      expect(body.evidence).toHaveLength(1)
      expect(body.evidence[0]).toMatchObject({
        protocol: 'mcp_oauth',
        valid: true,
        issuer: 'https://issuer.example',
        subject: 'agent-introspected',
        attenuation_ok: true,
      })
      expect(body.evidence[0]?.details).toMatchObject({
        token: { introspection_present: true, claims_verified: true },
        client_id: 'client-introspection',
      })
    } finally {
      await archive.close()
      await log.close()
      await introspectionServer.close()
    }
  })
})
