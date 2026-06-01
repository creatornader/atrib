// SPDX-License-Identifier: Apache-2.0

import { calculateJwkThumbprint, exportJWK, generateKeyPair, SignJWT } from 'jose'
import { atrib, base64urlEncode, sha256, type AtribRecord, type OnRecordSidecar } from '@atrib/mcp'
import { verifyRecord, type RecordVerificationResult } from '@atrib/verify'
import { createMockMcpServer } from './test-harness.js'

const TEST_PRIVATE_KEY = new Uint8Array(32).fill(77)
const CONTEXT_ID = '1234567890abcdef1234567890abcdef'
const TRACEPARENT = `00-${CONTEXT_ID}-00f067aa0ba902b7-01`
const RESOURCE = 'https://mcp.example.com/mcp'
const ISSUER = 'https://auth.example.com'
const ACCESS_TOKEN = 'fixture-access-token'

export interface McpOAuthEvidenceHarnessResult {
  record: AtribRecord
  sidecar: OnRecordSidecar
  verification: RecordVerificationResult
}

function accessTokenHash(token: string): string {
  return base64urlEncode(sha256(new TextEncoder().encode(token)))
}

async function buildDpopProof(): Promise<{ proofJwt: string; jkt: string }> {
  const { publicKey, privateKey } = await generateKeyPair('ES256')
  const publicJwk = await exportJWK(publicKey)
  const jkt = await calculateJwkThumbprint(publicJwk, 'sha256')
  const proofJwt = await new SignJWT({
    htm: 'POST',
    htu: RESOURCE,
    iat: 1_800_000_000,
    jti: 'mcp-oauth-evidence-harness-1',
    ath: accessTokenHash(ACCESS_TOKEN),
  })
    .setProtectedHeader({ typ: 'dpop+jwt', alg: 'ES256', jwk: publicJwk })
    .sign(privateKey)
  return { proofJwt, jkt }
}

export async function runMcpOAuthEvidenceHarness(): Promise<McpOAuthEvidenceHarnessResult> {
  const { proofJwt, jkt } = await buildDpopProof()
  const serverHandle = createMockMcpServer()
  const records: AtribRecord[] = []
  const sidecars: OnRecordSidecar[] = []

  atrib(serverHandle.server, {
    creatorKey: base64urlEncode(TEST_PRIVATE_KEY),
    serverUrl: RESOURCE,
    logSubmission: 'disabled',
    disclosure: { tool_name: 'verbatim' },
    authorizationEvidence: {
      claimSource: 'extraClaims',
      includeDpopProof: true,
      dpopNowSeconds: 1_800_000_000,
      requiredScopes: ['files:read'],
      protectedResourceMetadata: {
        resource: RESOURCE,
        authorization_servers: [ISSUER],
      },
      issuer: ISSUER,
      audience: RESOURCE,
      requestMethod: 'POST',
    },
    onRecord: (record, sidecar) => {
      records.push(record)
      if (sidecar) sidecars.push(sidecar)
    },
  })

  serverHandle.registerToolHandler(async () => ({
    content: [{ type: 'text', text: 'authorized read complete' }],
  }))

  const handler = serverHandle.getToolHandler()
  if (!handler) throw new Error('missing wrapped tools/call handler')

  await handler(
    {
      method: 'tools/call',
      params: {
        name: 'read_file',
        arguments: { path: '/tmp/example.txt' },
        _meta: { traceparent: TRACEPARENT },
      },
    },
    {
      authInfo: {
        token: ACCESS_TOKEN,
        clientId: 'client-123',
        scopes: ['files:read', 'files:write'],
        expiresAt: 1_800_003_600,
        resource: new URL(RESOURCE),
        extra: {
          claims: {
            iss: ISSUER,
            sub: 'user-123',
            aud: RESOURCE,
            client_id: 'client-123',
            scope: 'files:read files:write',
            resource: RESOURCE,
            exp: 1_800_003_600,
            cnf: { jkt },
          },
        },
      },
      requestInfo: {
        headers: new Headers({ DPoP: proofJwt }),
        url: new URL(RESOURCE),
      },
    },
  )

  const record = records[0]
  const sidecar = sidecars[0]
  if (!record || !sidecar) throw new Error('harness did not capture record and sidecar')

  const authorizationEvidence = sidecar.authorizationEvidence as
    | NonNullable<Parameters<typeof verifyRecord>[1]>['authorizationEvidence']
    | undefined
  if (!authorizationEvidence) throw new Error('harness did not capture authorization evidence')

  const verificationOptions: NonNullable<Parameters<typeof verifyRecord>[1]> = {
    authorizationEvidence,
    ...(sidecar.resolvedFacts ? { resolvedFacts: sidecar.resolvedFacts } : {}),
  }
  const verification = await verifyRecord(record, verificationOptions)

  return { record, sidecar, verification }
}
