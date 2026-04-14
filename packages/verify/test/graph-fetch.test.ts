import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fetchGraph, fetchSessionPolicyRecord, fetchPolicyDocument } from '../src/graph-fetch.js'

const CTX = '4bf92f3577b34da6a3ce929d0e0e4736'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('fetchGraph', () => {
  beforeEach(() => vi.restoreAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it('builds the correct URL with default query params', async () => {
    let capturedUrl = ''
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      capturedUrl = String(url)
      return jsonResponse({ nodes: [], edges: [] })
    })
    await fetchGraph('https://graph.atrib.io/v1', CTX)
    expect(capturedUrl).toContain(`/graph/${CTX}`)
    expect(capturedUrl).toContain('include_gap_nodes=true')
    expect(capturedUrl).toContain('include_cross_session=true')
    expect(capturedUrl).not.toContain('tree_size=')
  })

  it('includes tree_size when provided', async () => {
    let capturedUrl = ''
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      capturedUrl = String(url)
      return jsonResponse({})
    })
    await fetchGraph('https://graph.atrib.io/v1', CTX, 4821937)
    expect(capturedUrl).toContain('tree_size=4821937')
  })

  it('strips trailing slash from endpoint', async () => {
    let capturedUrl = ''
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      capturedUrl = String(url)
      return jsonResponse({})
    })
    await fetchGraph('https://graph.atrib.io/v1/', CTX)
    expect(capturedUrl).not.toContain('//graph/')
    expect(capturedUrl).toContain('/v1/graph/')
  })

  it('throws on non-2xx response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('not found', { status: 404, statusText: 'Not Found' }),
    )
    await expect(fetchGraph('https://graph.atrib.io/v1', CTX)).rejects.toThrow(
      /fetchGraph failed: 404/,
    )
  })

  it('throws on 500 response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('boom', { status: 500, statusText: 'Internal Server Error' }),
    )
    await expect(fetchGraph('https://graph.atrib.io/v1', CTX)).rejects.toThrow(/500/)
  })

  it('returns parsed JSON body on success', async () => {
    const expected = {
      spec_version: 'atrib/1.0',
      context_id: CTX,
      nodes: [],
      edges: [],
    }
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(expected))
    const result = await fetchGraph('https://graph.atrib.io/v1', CTX)
    expect(result).toEqual(expected)
  })
})

describe('fetchSessionPolicyRecord', () => {
  beforeEach(() => vi.restoreAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it('builds URL with URL-encoded record id', async () => {
    let capturedUrl = ''
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      capturedUrl = String(url)
      return jsonResponse({})
    })
    await fetchSessionPolicyRecord('https://graph.atrib.io/v1', 'sha256:abc/def')
    expect(capturedUrl).toContain('/policy-records/sha256%3Aabc%2Fdef')
  })

  it('throws on non-2xx', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 404 }))
    await expect(
      fetchSessionPolicyRecord('https://graph.atrib.io/v1', 'sha256:abc'),
    ).rejects.toThrow(/fetchSessionPolicyRecord failed/)
  })
})

describe('fetchPolicyDocument', () => {
  beforeEach(() => vi.restoreAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it('returns parsed policy document', async () => {
    const policy = { spec_version: 'atrib/1.0', edge_weights: { CONVERGES_ON: 1.0 } }
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(policy))
    const result = await fetchPolicyDocument(
      'https://merchant.example/.well-known/atrib-policy.json',
    )
    expect(result).toEqual(policy)
  })

  it('throws on non-2xx', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 404 }))
    await expect(
      fetchPolicyDocument('https://merchant.example/.well-known/atrib-policy.json'),
    ).rejects.toThrow(/fetchPolicyDocument failed/)
  })

  it('propagates fetch network errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'))
    await expect(
      fetchPolicyDocument('https://merchant.example/.well-known/atrib-policy.json'),
    ).rejects.toThrow(/ECONNREFUSED/)
  })
})
