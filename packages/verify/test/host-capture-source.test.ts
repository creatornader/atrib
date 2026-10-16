import { describe, expect, it, vi } from 'vitest'
import canonicalize from 'canonicalize'
import {
  HOST_CAPTURE_METHOD,
  HOST_CAPTURE_TYPE,
  EVIDENCE_TYPES,
  DECLARED_METHOD,
  getPublicKey,
  base64urlEncode,
  signRecord,
  canonicalRecord,
  genesisChainRoot,
  sha256,
  hexEncode,
  commitEvidenceBody,
  createEvidenceNonce,
  type AtribRecord,
  type EvidenceBody,
  type EvidenceKind,
} from '@atrib/mcp'
import { hostCaptureSourceVerifier } from '../src/host-capture-source.js'
import { verifyEvidenceSet } from '../src/evidence-statements.js'

async function captured(protectedMode = false, capturedAt = 1000) {
  const key = new Uint8Array(32).fill(7)
  const source = { namespace: 'urn:host', id: 'local-intercept' }
  const signer = base64urlEncode(await getPublicKey(key))
  const contextId = 'a'.repeat(32)
  const hash = (bytes: Uint8Array) => `sha256:${hexEncode(sha256(bytes))}`
  const json = (value: unknown) => new TextEncoder().encode(canonicalize(value)!)
  const grantBytes = json({ version: 'v1', not_before: 1, expires_at: 2000, revoked: false })
  const grantHash = hash(grantBytes)
  const subject = { namespace: 'urn:request', id: 'request-1' }
  const descriptor = {
    service: 'urn:deploy',
    operation: 'deploy',
    resource: { namespace: 'urn:target', id: 'staging' },
    parameters: { target: 'staging', region: 'us-east' },
  }
  const execution = { namespace: 'urn:execution', id: 'execution-1' }
  async function sign(kind: EvidenceKind, opening: EvidenceBody, parent?: string) {
    const record = await signRecord(
      {
        spec_version: 'atrib/1.0',
        creator_key: signer,
        chain_root: parent ?? genesisChainRoot(contextId),
        event_type: EVIDENCE_TYPES[kind],
        context_id: contextId,
        timestamp: capturedAt,
        signature: '',
        args_hash: commitEvidenceBody(kind, opening),
      } as AtribRecord,
      key,
    )
    return {
      record_hash: hash(canonicalRecord(record)),
      record,
      opening,
      artifacts: [] as Array<{ hash: string; bytes: Uint8Array }>,
    }
  }
  const request = await sign('request', {
    nonce: createEvidenceNonce(),
    subject,
    basis: [],
    source: { kind: 'declared', identity: source, method: DECLARED_METHOD },
    assertion: { descriptor, execution },
  })
  const allow = protectedMode
    ? await sign(
        'authorization',
        {
          nonce: createEvidenceNonce(),
          subject,
          target: { record_hash: request.record_hash },
          source: { kind: 'declared', identity: source, method: DECLARED_METHOD },
          assertion: {
            decision: 'allow',
            authority_version: 'v1',
            not_before: 1,
            expires_at: 2000,
          },
          basis: [{ relation: 'authority', kind: 'artifact', hash: grantHash }],
        },
        request.record_hash,
      )
    : undefined
  if (allow) allow.artifacts.push({ hash: grantHash, bytes: grantBytes })
  const claim = {
    subject,
    target: { record_hash: request.record_hash },
    assertion: {
      phase: 'dispatch' as const,
      outcome: 'pending' as const,
      descriptor,
      execution,
      native_invocation: { namespace: 'urn:native', id: 'native-1' },
      delivery: { namespace: 'urn:delivery', id: 'delivery-1' },
    },
    source: {
      kind: 'boundary' as const,
      identity: source,
      method: HOST_CAPTURE_METHOD,
      observed_at: capturedAt,
    },
  }
  const authority = allow ? [allow.record_hash] : []
  const payload = { nonce: createEvidenceNonce(), claim, authority }
  const record = await signRecord(
    {
      spec_version: 'atrib/1.0',
      creator_key: signer,
      chain_root: request.record_hash,
      event_type: HOST_CAPTURE_TYPE,
      context_id: contextId,
      timestamp: capturedAt,
      args_hash: hash(json(payload)),
      signature: '',
    } as AtribRecord,
    key,
  )
  const bytes = json({ record, payload })
  const artifactHash = hash(bytes)
  const dispatch = await sign(
    'observation',
    {
      ...claim,
      nonce: createEvidenceNonce(),
      basis: [
        { relation: 'source', kind: 'artifact', hash: artifactHash },
        ...authority.map((hash) => ({
          relation: 'authority' as const,
          kind: 'record' as const,
          hash,
        })),
      ],
    },
    request.record_hash,
  )
  dispatch.artifacts.push({ hash: artifactHash, bytes })
  const units = [request, dispatch, ...(allow ? [allow] : [])]
  const rules = Object.entries(EVIDENCE_TYPES).map(([kind, type]) => ({
    type,
    signer_keys: [signer],
    source_keys: [signer],
    source,
    methods: [
      kind === 'request' || kind === 'authorization' ? DECLARED_METHOD : HOST_CAPTURE_METHOD,
    ],
    subject_namespace: 'urn:request',
    max_age_ms: 100,
    authority_versions: ['v1'],
    authorized_descriptors: [descriptor],
    authority_basis: [grantHash],
  }))
  return {
    units,
    input: {
      records: units.map((unit) => unit.record),
      openings: new Map(units.map((unit) => [unit.record_hash, unit.opening])),
      artifacts: new Map(
        units.flatMap((unit) =>
          unit.artifacts.map((artifact) => [artifact.hash, artifact.bytes] as const),
        ),
      ),
      policy: { id: 'test-host', rules, required: ['source', 'binding'] },
      evaluation: {
        purpose: 'historical' as const,
        evaluated_at: capturedAt,
        dispatch_record: dispatch.record_hash,
      },
      requestHash: request.record_hash,
      sourceVerifiers: { [HOST_CAPTURE_METHOD]: hostCaptureSourceVerifier },
    },
  }
}

describe('authenticated host capture', () => {
  it('uses only the fixed evaluation time when the verifier wall clock changes', async () => {
    const { input } = await captured(false, 10_000_000)
    const wallClock = vi.spyOn(Date, 'now').mockReturnValue(0)
    try {
      const before = await verifyEvidenceSet(input)
      wallClock.mockReturnValue(10_000_000)
      const after = await verifyEvidenceSet(input)
      expect(before).toEqual(after)
      expect(before.request!.dimensions.source.state).toBe('supported')
    } finally {
      wallClock.mockRestore()
    }
  })
  it('receives signed host capture with source and descriptor binding supported', async () => {
    const { input } = await captured()
    const result = await verifyEvidenceSet(input)
    expect(result.request!.dimensions.source.state).toBe('supported')
    expect(result.request!.dimensions.binding.state).toBe('supported')
    expect(result.request!.dimensions.effect.state).not.toBe('supported')
    expect(result.request!.dimensions.authority.state).not.toBe('supported')
  })

  it('does not authenticate capture using an ambient signer key', async () => {
    const { input } = await captured()
    input.policy.rules.forEach((rule) => {
      rule.source_keys = []
    })
    const result = await verifyEvidenceSet(input)
    expect(result.request!.dimensions.source.state).not.toBe('supported')
  })

  it('receives the exact allow authenticated by the protected dispatch source', async () => {
    const { input } = await captured(true)
    const result = await verifyEvidenceSet(input)
    expect(result.request!.dimensions.source.state).toBe('supported')
    expect(result.request!.dimensions.binding.state).toBe('supported')
    expect(result.request!.dimensions.authority.state).toBe('supported')
  })

  it('rejects changed artifact payload bytes and leaves withheld artifacts unresolved', async () => {
    const { input } = await captured()
    const [hash, bytes] = [...input.artifacts][0]!
    const changed = new Map(input.artifacts)
    changed.set(
      hash,
      new TextEncoder().encode(new TextDecoder().decode(bytes).replace('staging', 'production')),
    )
    const tampered = await verifyEvidenceSet({ ...input, artifacts: changed })
    expect(tampered.request!.dimensions.source.state).not.toBe('supported')
    const withheld = await verifyEvidenceSet({ ...input, artifacts: new Map() })
    expect(withheld.request!.dimensions.source.state).toBe('unresolved')
  })

  it('rejects a host artifact reused for another claim', async () => {
    const { units, input } = await captured()
    const dispatch = units[1]!
    const body = structuredClone(dispatch.opening)
    body.subject.id = 'forged-request'
    const result = await hostCaptureSourceVerifier.verify({
      record: dispatch.record,
      body,
      artifacts: input.artifacts,
      sourceKeys: [dispatch.record.creator_key],
      evaluatedAt: input.evaluation.evaluated_at,
    })
    expect(result.state).toBe('rejected')
    expect(result.reasons).toContain(
      'https://atrib.dev/evidence/v1/reason/host-capture-claim-mismatch',
    )
  })

  it('verifies the source signature even when the artifact hash is correct', async () => {
    const { units } = await captured()
    const dispatch = units[1]!
    const wrapper = JSON.parse(new TextDecoder().decode(dispatch.artifacts[0]!.bytes))
    wrapper.record.signature = 'A'.repeat(86)
    const bytes = new TextEncoder().encode(JSON.stringify(wrapper))
    const hash = `sha256:${hexEncode(sha256(bytes))}`
    const body = structuredClone(dispatch.opening)
    body.basis[0]!.hash = hash
    const result = await hostCaptureSourceVerifier.verify({
      record: dispatch.record,
      body,
      artifacts: new Map([[hash, bytes]]),
      sourceKeys: [dispatch.record.creator_key],
      evaluatedAt: 1000,
    })
    expect(result.state).toBe('rejected')
    expect(result.reasons).toContain(
      'https://atrib.dev/evidence/v1/reason/host-capture-signature-invalid',
    )
  })
})
