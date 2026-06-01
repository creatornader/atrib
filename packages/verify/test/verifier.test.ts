import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AtribVerifier } from '../src/verifier.js'
import { signRecommendation } from '../src/recommendation.js'
import { calculate, DEFAULT_POLICY } from '../src/calculate.js'
import { base64urlEncode, getPublicKey } from '@atrib/mcp'
import type { GraphResponse, RecommendationDocument, SessionPolicyRecord } from '../src/types.js'
import type { Ap2ViEvidenceBundle } from '../src/ap2-vi-evidence.js'
import autonomousFixture from '../../agent/test/fixtures/ap2/vi_autonomous_success_evidence.json'

const MERCHANT_KEY = new Uint8Array(32).fill(11)
const MERCHANT_KEY_B64 = base64urlEncode(MERCHANT_KEY)
const CTX = '4bf92f3577b34da6a3ce929d0e0e4736'

function makeGraph(): GraphResponse {
  return {
    spec_version: 'atrib/1.0',
    context_id: CTX,
    generated_at: 0,
    node_count: 3,
    edge_count: 2,
    has_transaction: true,
    cross_session_count: 0,
    nodes: [
      {
        id: 'a',
        event_type: 'tool_call',
        event_type_uri: 'https://atrib.dev/v1/types/tool_call',
        content_id: 'sha256:a',
        creator_key: 'KEY_A',
        chain_root: `sha256:${'0'.repeat(64)}`,
        context_id: CTX,
        timestamp: 1000,
        log_index: 1,
        verification_state: 'signature_valid',
        is_genesis: true,
      },
      {
        id: 'b',
        event_type: 'tool_call',
        event_type_uri: 'https://atrib.dev/v1/types/tool_call',
        content_id: 'sha256:b',
        creator_key: 'KEY_B',
        chain_root: `sha256:${'0'.repeat(64)}`,
        context_id: CTX,
        timestamp: 1100,
        log_index: 2,
        verification_state: 'signature_valid',
        is_genesis: false,
      },
      {
        id: 't',
        event_type: 'transaction',
        event_type_uri: 'https://atrib.dev/v1/types/transaction',
        content_id: 'sha256:t',
        creator_key: 'KEY_M',
        chain_root: `sha256:${'0'.repeat(64)}`,
        context_id: CTX,
        timestamp: 1200,
        log_index: 3,
        verification_state: 'signature_valid',
        is_genesis: false,
      },
    ],
    edges: [
      { type: 'CONVERGES_ON', source: 'a', target: 't', directed: true },
      { type: 'CONVERGES_ON', source: 'b', target: 't', directed: true },
    ],
  }
}

describe('AtribVerifier: construction', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('constructs with no options', () => {
    const v = new AtribVerifier()
    expect(v).toBeDefined()
  })

  it('constructs with merchantKey', () => {
    const v = new AtribVerifier({ merchantKey: MERCHANT_KEY_B64 })
    expect(v).toBeDefined()
  })

  it('warns and continues when merchantKey is wrong length', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    new AtribVerifier({ merchantKey: base64urlEncode(new Uint8Array(16)) })
    expect(warnSpy).toHaveBeenCalled()
  })

  it('warns and continues when merchantKey is malformed base64url', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    new AtribVerifier({ merchantKey: '!!!not-base64url!!!' })
    expect(warnSpy).toHaveBeenCalled()
  })
})

describe('AtribVerifier.verify()', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns valid=true for a self-consistent recommendation', async () => {
    const graph = makeGraph()
    // Build the document with the correct distribution
    const expectedDist = calculate(graph, DEFAULT_POLICY)
    const unsigned = {
      spec_version: 'atrib/1.0' as const,
      document_type: 'settlement_recommendation' as const,
      context_id: CTX,
      transaction_id: 't',
      policy_record_id: 'default',
      graph_checkpoint: 'log.atrib.dev/v1',
      graph_tree_size: 3,
      calculated_at: 1743860000000,
      calculated_by: 'https://resolve.atrib.dev/v1',
      distribution: expectedDist,
      maximum_total_share: null,
      warnings: [],
    }
    const signed = await signRecommendation(unsigned, MERCHANT_KEY)
    const merchantPub = base64urlEncode(await getPublicKey(MERCHANT_KEY))

    // Mock fetch:
    //   1) graph fetch → returns graph
    //   2) /pubkey fetch → returns merchant public key (we pretend resolve uses it)
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = String(url)
      if (u.includes('/graph/')) {
        return new Response(JSON.stringify(graph), { status: 200 })
      }
      if (u.endsWith('/pubkey')) {
        return new Response(merchantPub, { status: 200 })
      }
      return new Response('', { status: 404 })
    })

    const verifier = new AtribVerifier()
    const result = await verifier.verify(signed)
    expect(result.signatureOk).toBe(true)
    expect(result.calcMatch).toBe(true)
    expect(result.valid).toBe(true)
    expect(result.graph_node_count).toBe(3)
    expect(result.warnings).toEqual([])
  })

  it('attaches AP2 VI evidence to recommendation verification as a tiered result', async () => {
    const graph = makeGraph()
    const expectedDist = calculate(graph, DEFAULT_POLICY)
    const unsigned = {
      spec_version: 'atrib/1.0' as const,
      document_type: 'settlement_recommendation' as const,
      context_id: CTX,
      transaction_id: 't',
      policy_record_id: 'default',
      graph_checkpoint: 'log.atrib.dev/v1',
      graph_tree_size: 3,
      calculated_at: 1743860000000,
      calculated_by: 'https://resolve.atrib.dev/v1',
      distribution: expectedDist,
      maximum_total_share: null,
      warnings: [],
    }
    const signed = await signRecommendation(unsigned, MERCHANT_KEY)
    const merchantPub = base64urlEncode(await getPublicKey(MERCHANT_KEY))

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = String(url)
      if (u.includes('/graph/')) return new Response(JSON.stringify(graph), { status: 200 })
      if (u.endsWith('/pubkey')) return new Response(merchantPub, { status: 200 })
      return new Response('', { status: 404 })
    })

    const verifier = new AtribVerifier()
    const result = await verifier.verify(signed, {
      ap2ViEvidence: autonomousFixture as Ap2ViEvidenceBundle,
      ap2ViEvidenceOptions: { nowSeconds: 1_779_840_000 },
    })

    expect(result.valid).toBe(true)
    expect(result.signatureOk).toBe(true)
    expect(result.calcMatch).toBe(true)
    expect(result.ap2_vi_evidence?.valid).toBe(true)
    expect(result.ap2_vi_evidence?.vi.mode).toBe('autonomous')
    expect(result.ap2_vi_evidence?.vi.constraints.status).toBe('passed')
    expect(result.evidence).toHaveLength(1)
    expect(result.evidence?.[0]?.protocol).toBe('ap2_vi')
    expect(result.evidence?.[0]?.valid).toBe(true)
  })

  it('attaches OAuth evidence to recommendation verification without changing validity', async () => {
    const graph = makeGraph()
    const expectedDist = calculate(graph, DEFAULT_POLICY)
    const unsigned = {
      spec_version: 'atrib/1.0' as const,
      document_type: 'settlement_recommendation' as const,
      context_id: CTX,
      transaction_id: 't',
      policy_record_id: 'default',
      graph_checkpoint: 'log.atrib.dev/v1',
      graph_tree_size: 3,
      calculated_at: 1743860000000,
      calculated_by: 'https://resolve.atrib.dev/v1',
      distribution: expectedDist,
      maximum_total_share: null,
      warnings: [],
    }
    const signed = await signRecommendation(unsigned, MERCHANT_KEY)
    const merchantPub = base64urlEncode(await getPublicKey(MERCHANT_KEY))

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = String(url)
      if (u.includes('/graph/')) return new Response(JSON.stringify(graph), { status: 200 })
      if (u.endsWith('/pubkey')) return new Response(merchantPub, { status: 200 })
      return new Response('', { status: 404 })
    })

    const verifier = new AtribVerifier()
    const result = await verifier.verify(signed, {
      authorizationEvidence: [
        {
          protocol: 'mcp_oauth',
          claimsVerified: true,
          claims: {
            iss: 'https://auth.example.com',
            sub: 'user-123',
            aud: 'https://mcp.example.com/mcp',
            client_id: 'client-123',
            scope: 'files:read files:write',
            resource: 'https://mcp.example.com/mcp',
          },
          issuer: 'https://auth.example.com',
          audience: 'https://mcp.example.com/mcp',
          requiredScopes: ['files:read'],
          expectedClientId: 'client-123',
        },
      ],
    })

    expect(result.valid).toBe(true)
    expect(result.signatureOk).toBe(true)
    expect(result.calcMatch).toBe(true)
    expect(result.evidence).toHaveLength(1)
    expect(result.evidence?.[0]?.protocol).toBe('mcp_oauth')
    expect(result.evidence?.[0]?.valid).toBe(true)
    expect(result.evidence?.[0]?.attenuation_ok).toBe(true)
  })

  it('keeps AP2 VI verifier errors tiered from recommendation validity', async () => {
    const graph = makeGraph()
    const expectedDist = calculate(graph, DEFAULT_POLICY)
    const unsigned = {
      spec_version: 'atrib/1.0' as const,
      document_type: 'settlement_recommendation' as const,
      context_id: CTX,
      transaction_id: 't',
      policy_record_id: 'default',
      graph_checkpoint: 'log.atrib.dev/v1',
      graph_tree_size: 3,
      calculated_at: 1743860000000,
      calculated_by: 'https://resolve.atrib.dev/v1',
      distribution: expectedDist,
      maximum_total_share: null,
      warnings: [],
    }
    const signed = await signRecommendation(unsigned, MERCHANT_KEY)
    const merchantPub = base64urlEncode(await getPublicKey(MERCHANT_KEY))

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = String(url)
      if (u.includes('/graph/')) return new Response(JSON.stringify(graph), { status: 200 })
      if (u.endsWith('/pubkey')) return new Response(merchantPub, { status: 200 })
      return new Response('', { status: 404 })
    })

    const verifier = new AtribVerifier()
    const result = await verifier.verify(signed, {
      ap2ViEvidence: null as unknown as Ap2ViEvidenceBundle,
    })

    expect(result.valid).toBe(true)
    expect(result.signatureOk).toBe(true)
    expect(result.calcMatch).toBe(true)
    expect(result.ap2_vi_evidence?.valid).toBe(false)
    expect(result.ap2_vi_evidence?.errors[0]).toMatch(/^ap2_vi_evidence verification error:/)
  })

  it('returns calcMatch=false when distribution is wrong', async () => {
    const graph = makeGraph()
    const merchantPub = base64urlEncode(await getPublicKey(MERCHANT_KEY))
    const unsigned = {
      spec_version: 'atrib/1.0' as const,
      document_type: 'settlement_recommendation' as const,
      context_id: CTX,
      transaction_id: 't',
      policy_record_id: 'default',
      graph_checkpoint: 'log.atrib.dev/v1',
      graph_tree_size: 3,
      calculated_at: 1743860000000,
      calculated_by: 'https://resolve.atrib.dev/v1',
      // wrong distribution
      distribution: { KEY_A: 1.0 },
      maximum_total_share: null,
      warnings: [],
    }
    const signed = await signRecommendation(unsigned, MERCHANT_KEY)

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = String(url)
      if (u.includes('/graph/')) {
        return new Response(JSON.stringify(graph), { status: 200 })
      }
      if (u.endsWith('/pubkey')) {
        return new Response(merchantPub, { status: 200 })
      }
      return new Response('', { status: 404 })
    })

    const verifier = new AtribVerifier()
    const result = await verifier.verify(signed)
    expect(result.signatureOk).toBe(true) // sig is fine
    expect(result.calcMatch).toBe(false) // calc doesn't match
    expect(result.valid).toBe(false)
    expect(result.warnings.some((w) => w.includes('local recalculation'))).toBe(true)
  })

  it('returns signatureOk=false for tampered document', async () => {
    const graph = makeGraph()
    const merchantPub = base64urlEncode(await getPublicKey(MERCHANT_KEY))
    const expectedDist = calculate(graph, DEFAULT_POLICY)
    const unsigned = {
      spec_version: 'atrib/1.0' as const,
      document_type: 'settlement_recommendation' as const,
      context_id: CTX,
      transaction_id: 't',
      policy_record_id: 'default',
      graph_checkpoint: 'log.atrib.dev/v1',
      graph_tree_size: 3,
      calculated_at: 1743860000000,
      calculated_by: 'https://resolve.atrib.dev/v1',
      distribution: expectedDist,
      maximum_total_share: null,
      warnings: [],
    }
    const signed = await signRecommendation(unsigned, MERCHANT_KEY)
    // Tamper after signing
    const tampered: RecommendationDocument = { ...signed, calculated_at: 9999999999999 }

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = String(url)
      if (u.includes('/graph/')) return new Response(JSON.stringify(graph), { status: 200 })
      if (u.endsWith('/pubkey')) return new Response(merchantPub, { status: 200 })
      return new Response('', { status: 404 })
    })

    const verifier = new AtribVerifier()
    const result = await verifier.verify(tampered)
    expect(result.signatureOk).toBe(false)
    expect(result.valid).toBe(false)
  })

  it('records warning when calculated_by is "local" (no key resolution)', async () => {
    const graph = makeGraph()
    const expectedDist = calculate(graph, DEFAULT_POLICY)
    const unsigned = {
      spec_version: 'atrib/1.0' as const,
      document_type: 'settlement_recommendation' as const,
      context_id: CTX,
      transaction_id: 't',
      policy_record_id: 'default',
      graph_checkpoint: 'log.atrib.dev/v1',
      graph_tree_size: 3,
      calculated_at: 1743860000000,
      calculated_by: 'local', // ← local
      distribution: expectedDist,
      maximum_total_share: null,
      warnings: [],
    }
    const signed = await signRecommendation(unsigned, MERCHANT_KEY)

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = String(url)
      if (u.includes('/graph/')) return new Response(JSON.stringify(graph), { status: 200 })
      return new Response('', { status: 404 })
    })

    const verifier = new AtribVerifier()
    const result = await verifier.verify(signed)
    // Calculation matched but signature couldn't be verified for "local"
    expect(result.calcMatch).toBe(true)
    expect(result.signatureOk).toBe(false)
    expect(result.valid).toBe(false)
    expect(result.warnings.some((w) => w.includes('unknown calculated_by'))).toBe(true)
  })

  it('uses session policy record + agreed policy when policy_record_id is not "default"', async () => {
    const graph = makeGraph()
    const sessionPolicy: SessionPolicyRecord = {
      spec_version: 'atrib/1.0',
      record_id: 'sha256:abc',
      context_id: CTX,
      agreed_policy: 'https://merchant.example.com/.well-known/atrib-policy.json',
      applied_constraints: { minimum_floors: { KEY_A: 0.7 } },
      warnings: [],
    }
    const merchantPolicyDoc = {
      spec_version: 'atrib/1.0' as const,
      edge_weights: { CONVERGES_ON: 1.0, unsigned: 0 },
    }
    const expectedDist = calculate(graph, merchantPolicyDoc, sessionPolicy)
    const merchantPub = base64urlEncode(await getPublicKey(MERCHANT_KEY))
    const unsigned = {
      spec_version: 'atrib/1.0' as const,
      document_type: 'settlement_recommendation' as const,
      context_id: CTX,
      transaction_id: 't',
      policy_record_id: 'sha256:abc',
      graph_checkpoint: 'log.atrib.dev/v1',
      graph_tree_size: 3,
      calculated_at: 1743860000000,
      calculated_by: 'https://resolve.atrib.dev/v1',
      distribution: expectedDist,
      maximum_total_share: null,
      warnings: [],
    }
    const signed = await signRecommendation(unsigned, MERCHANT_KEY)

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = String(url)
      if (u.includes('/graph/')) return new Response(JSON.stringify(graph), { status: 200 })
      if (u.includes('/policy-records/')) {
        return new Response(JSON.stringify(sessionPolicy), { status: 200 })
      }
      if (u.includes('atrib-policy.json')) {
        return new Response(JSON.stringify(merchantPolicyDoc), { status: 200 })
      }
      if (u.endsWith('/pubkey')) return new Response(merchantPub, { status: 200 })
      return new Response('', { status: 404 })
    })

    const verifier = new AtribVerifier()
    const result = await verifier.verify(signed)
    expect(result.signatureOk).toBe(true)
    expect(result.calcMatch).toBe(true)
    expect(result.valid).toBe(true)
    // KEY_A floored to 0.7
    expect(result.distribution['KEY_A']).toBeCloseTo(0.7, 9)
    expect(result.distribution['KEY_B']).toBeCloseTo(0.3, 9)
  })
})

describe('AtribVerifier.calculate(): post-hoc (§5.5.3)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns a signed recommendation with merchant key', async () => {
    const graph = makeGraph()
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response(JSON.stringify(graph), { status: 200 }),
    )
    const verifier = new AtribVerifier({ merchantKey: MERCHANT_KEY_B64 })
    const rec = await verifier.calculate({
      context_id: CTX,
      policy: 'default',
      signWith: 'merchant',
    })
    expect(rec.calculated_by).toBe('local')
    expect(rec.policy_record_id).toBe('default')
    expect(rec.signature).not.toBe('')
    expect(rec.signature.length).toBeGreaterThan(80)
    // Distribution should match local calc
    expect(rec.distribution['KEY_A']).toBeCloseTo(0.5, 9)
    expect(rec.distribution['KEY_B']).toBeCloseTo(0.5, 9)
  })

  it('returns unsigned recommendation with warning when merchantKey not set', async () => {
    const graph = makeGraph()
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response(JSON.stringify(graph), { status: 200 }),
    )
    const verifier = new AtribVerifier() // no merchantKey
    const rec = await verifier.calculate({
      context_id: CTX,
      policy: 'default',
      signWith: 'merchant',
    })
    expect(rec.signature).toBe('')
    expect(rec.warnings).toContain('merchantKey not set. Recommendation unsigned')
  })

  it('§5.8: never throws on graph fetch failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'))
    const verifier = new AtribVerifier({ merchantKey: MERCHANT_KEY_B64 })
    const rec = await verifier.calculate({
      context_id: CTX,
      policy: 'default',
      signWith: 'merchant',
    })
    expect(rec).toBeDefined()
    expect(rec.warnings.some((w) => w.includes('graph fetch'))).toBe(true)
  })

  it('records warning when graph has no transaction node', async () => {
    const graph = makeGraph()
    graph.nodes = graph.nodes.filter((n) => n.event_type !== 'transaction')
    graph.has_transaction = false
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response(JSON.stringify(graph), { status: 200 }),
    )
    const verifier = new AtribVerifier({ merchantKey: MERCHANT_KEY_B64 })
    const rec = await verifier.calculate({
      context_id: CTX,
      policy: 'default',
      signWith: 'merchant',
    })
    expect(rec.warnings.some((w) => w.includes('no transaction node'))).toBe(true)
    expect(rec.distribution).toEqual({})
  })

  it('passes through a custom policy document', async () => {
    const graph = makeGraph()
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response(JSON.stringify(graph), { status: 200 }),
    )
    const verifier = new AtribVerifier({ merchantKey: MERCHANT_KEY_B64 })
    const rec = await verifier.calculate({
      context_id: CTX,
      policy: {
        spec_version: 'atrib/1.0',
        edge_weights: { CONVERGES_ON: 1.0, unsigned: 0 },
        constraints: { maximum_total_share: 0.25 },
      },
      signWith: 'merchant',
    })
    expect(rec.maximum_total_share).toBe(0.25)
  })
})
