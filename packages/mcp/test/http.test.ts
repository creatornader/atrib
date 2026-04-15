import { describe, it, expect } from 'vitest'
import { handleAtribRequest, createAtribHttpHandler } from '../src/http.js'
import type { AtribServer } from '../src/middleware.js'
import type { ProofBundle } from '../src/submission.js'

const TEST_POLICY = {
  spec_version: 'atrib/1.0',
  policy_id: 'https://example.com/.well-known/atrib-policy.json',
  role: 'creator',
  edge_weights: { direct: 1.0, indirect: 0.5 },
}

const TEST_PROOF: ProofBundle = {
  log_index: 42,
  checkpoint: 'log.atrib.dev/v1\n43\nabc123',
  inclusion_proof: ['aGVsbG8=', 'd29ybGQ='],
  leaf_hash: 'dGVzdA==',
}

const TEST_HASH = 'a'.repeat(64)

/** Create a minimal mock AtribServer for HTTP handler tests. */
function createMockServer(options: {
  policy?: Record<string, unknown> | null
  proofs?: Map<string, ProofBundle>
}): AtribServer {
  const proofs = options.proofs ?? new Map()
  return {
    policy: options.policy ?? null,
    getProof: (hash: string) => proofs.get(hash),
    flush: async () => {},
  } as unknown as AtribServer
}

// ---------------------------------------------------------------------------
// handleAtribRequest (framework-agnostic)
// ---------------------------------------------------------------------------

describe('handleAtribRequest', () => {
  describe('policy endpoint (§5.3.6)', () => {
    it('returns 200 with policy when configured', () => {
      const server = createMockServer({ policy: TEST_POLICY })
      const result = handleAtribRequest(server, 'GET', '/.well-known/atrib-policy.json')

      expect(result).not.toBeNull()
      expect(result!.status).toBe(200)
      expect(result!.headers['Content-Type']).toBe('application/json')
      expect(result!.headers['Cache-Control']).toBe('max-age=300')
      expect(JSON.parse(result!.body)).toEqual(TEST_POLICY)
    })

    it('returns 404 when no policy is configured', () => {
      const server = createMockServer({ policy: null })
      const result = handleAtribRequest(server, 'GET', '/.well-known/atrib-policy.json')

      expect(result).not.toBeNull()
      expect(result!.status).toBe(404)
    })

    it('returns 405 for non-GET/HEAD methods', () => {
      const server = createMockServer({ policy: TEST_POLICY })

      for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
        const result = handleAtribRequest(server, method, '/.well-known/atrib-policy.json')
        expect(result).not.toBeNull()
        expect(result!.status).toBe(405)
        expect(result!.headers['Allow']).toBe('GET, HEAD')
      }
    })

    it('allows HEAD requests with empty body', () => {
      const server = createMockServer({ policy: TEST_POLICY })
      const result = handleAtribRequest(server, 'HEAD', '/.well-known/atrib-policy.json')

      expect(result).not.toBeNull()
      expect(result!.status).toBe(200)
      expect(result!.headers['Content-Type']).toBe('application/json')
      expect(result!.body).toBe('')
    })

    it('returns null for trailing slash (not an exact match)', () => {
      const server = createMockServer({ policy: TEST_POLICY })
      expect(handleAtribRequest(server, 'GET', '/.well-known/atrib-policy.json/')).toBeNull()
    })
  })

  describe('proof endpoint (§5.3.5)', () => {
    it('returns 200 with proof when cached', () => {
      const proofs = new Map([[TEST_HASH, TEST_PROOF]])
      const server = createMockServer({ proofs })
      const result = handleAtribRequest(server, 'GET', `/.well-known/atrib-proof/${TEST_HASH}`)

      expect(result).not.toBeNull()
      expect(result!.status).toBe(200)
      expect(result!.headers['Content-Type']).toBe('application/json')
      expect(result!.headers['Cache-Control']).toBe('public, max-age=31536000, immutable')
      expect(JSON.parse(result!.body)).toEqual(TEST_PROOF)
    })

    it('returns 404 when proof is not cached', () => {
      const server = createMockServer({})
      const unknownHash = 'b'.repeat(64)
      const result = handleAtribRequest(server, 'GET', `/.well-known/atrib-proof/${unknownHash}`)

      expect(result).not.toBeNull()
      expect(result!.status).toBe(404)
    })

    it('returns 400 for invalid hash format', () => {
      const server = createMockServer({})

      // Too short
      const short = handleAtribRequest(server, 'GET', '/.well-known/atrib-proof/abc123')
      expect(short!.status).toBe(400)

      // Non-hex characters
      const nonHex = handleAtribRequest(server, 'GET', `/.well-known/atrib-proof/${'g'.repeat(64)}`)
      expect(nonHex!.status).toBe(400)

      // Empty hash (just the prefix with trailing slash)
      const empty = handleAtribRequest(server, 'GET', '/.well-known/atrib-proof/')
      expect(empty!.status).toBe(400)
    })

    it('returns 400 for off-by-one hash lengths', () => {
      const server = createMockServer({})

      const tooShort = handleAtribRequest(server, 'GET', `/.well-known/atrib-proof/${'a'.repeat(63)}`)
      expect(tooShort!.status).toBe(400)

      const tooLong = handleAtribRequest(server, 'GET', `/.well-known/atrib-proof/${'a'.repeat(65)}`)
      expect(tooLong!.status).toBe(400)
    })

    it('returns 400 for uppercase hex (hashes are lowercase only)', () => {
      const server = createMockServer({})
      const upper = handleAtribRequest(server, 'GET', `/.well-known/atrib-proof/${'A'.repeat(64)}`)
      expect(upper!.status).toBe(400)
    })

    it('returns 400 for trailing slash after valid hash', () => {
      const proofs = new Map([[TEST_HASH, TEST_PROOF]])
      const server = createMockServer({ proofs })
      const result = handleAtribRequest(server, 'GET', `/.well-known/atrib-proof/${TEST_HASH}/`)
      expect(result!.status).toBe(400)
    })

    it('returns 400 for extra path segments after hash', () => {
      const server = createMockServer({})
      const result = handleAtribRequest(server, 'GET', `/.well-known/atrib-proof/${TEST_HASH}/extra`)
      expect(result!.status).toBe(400)
    })

    it('returns 400 for unicode in hash position', () => {
      const server = createMockServer({})
      const result = handleAtribRequest(server, 'GET', '/.well-known/atrib-proof/\u{1F600}abcdef')
      expect(result!.status).toBe(400)
    })

    it('returns 405 for non-GET/HEAD methods', () => {
      const proofs = new Map([[TEST_HASH, TEST_PROOF]])
      const server = createMockServer({ proofs })

      for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
        const result = handleAtribRequest(server, method, `/.well-known/atrib-proof/${TEST_HASH}`)
        expect(result).not.toBeNull()
        expect(result!.status).toBe(405)
        expect(result!.headers['Allow']).toBe('GET, HEAD')
      }
    })

    it('allows HEAD requests with empty body', () => {
      const proofs = new Map([[TEST_HASH, TEST_PROOF]])
      const server = createMockServer({ proofs })
      const result = handleAtribRequest(server, 'HEAD', `/.well-known/atrib-proof/${TEST_HASH}`)

      expect(result).not.toBeNull()
      expect(result!.status).toBe(200)
      expect(result!.headers['Content-Type']).toBe('application/json')
      expect(result!.body).toBe('')
    })
  })

  describe('pass-through', () => {
    it('returns null for unmatched paths', () => {
      const server = createMockServer({ policy: TEST_POLICY })

      expect(handleAtribRequest(server, 'GET', '/')).toBeNull()
      expect(handleAtribRequest(server, 'GET', '/api/data')).toBeNull()
      expect(handleAtribRequest(server, 'GET', '/.well-known/other')).toBeNull()
      expect(handleAtribRequest(server, 'GET', '/.well-known/atrib-policy.json/')).toBeNull()
    })
  })
})

// ---------------------------------------------------------------------------
// createAtribHttpHandler (web-standard Request => Response)
// ---------------------------------------------------------------------------

describe('createAtribHttpHandler', () => {
  describe('policy endpoint', () => {
    it('returns a Response with correct status, headers, and body', async () => {
      const server = createMockServer({ policy: TEST_POLICY })
      const handler = createAtribHttpHandler(server)
      const response = handler(new Request('https://example.com/.well-known/atrib-policy.json'))

      expect(response).not.toBeNull()
      expect(response!.status).toBe(200)
      expect(response!.headers.get('Content-Type')).toBe('application/json')
      expect(response!.headers.get('Cache-Control')).toBe('max-age=300')

      const body = await response!.json()
      expect(body).toEqual(TEST_POLICY)
    })

    it('returns 404 Response when policy is not configured', async () => {
      const server = createMockServer({ policy: null })
      const handler = createAtribHttpHandler(server)
      const response = handler(new Request('https://example.com/.well-known/atrib-policy.json'))

      expect(response).not.toBeNull()
      expect(response!.status).toBe(404)
      const body = await response!.text()
      expect(body).toBe('No policy configured')
    })

    it('returns 405 Response for POST', async () => {
      const server = createMockServer({ policy: TEST_POLICY })
      const handler = createAtribHttpHandler(server)
      const response = handler(
        new Request('https://example.com/.well-known/atrib-policy.json', { method: 'POST' }),
      )

      expect(response).not.toBeNull()
      expect(response!.status).toBe(405)
      expect(response!.headers.get('Allow')).toBe('GET, HEAD')
    })

    it('HEAD returns null body in Response', async () => {
      const server = createMockServer({ policy: TEST_POLICY })
      const handler = createAtribHttpHandler(server)
      const response = handler(
        new Request('https://example.com/.well-known/atrib-policy.json', { method: 'HEAD' }),
      )

      expect(response).not.toBeNull()
      expect(response!.status).toBe(200)
      const body = await response!.text()
      expect(body).toBe('')
    })

    it('strips query strings (pathname only)', async () => {
      const server = createMockServer({ policy: TEST_POLICY })
      const handler = createAtribHttpHandler(server)
      const response = handler(
        new Request('https://example.com/.well-known/atrib-policy.json?debug=true'),
      )

      expect(response).not.toBeNull()
      expect(response!.status).toBe(200)
      const body = await response!.json()
      expect(body).toEqual(TEST_POLICY)
    })
  })

  describe('proof endpoint', () => {
    it('returns a Response with correct status, headers, and body', async () => {
      const proofs = new Map([[TEST_HASH, TEST_PROOF]])
      const server = createMockServer({ proofs })
      const handler = createAtribHttpHandler(server)
      const response = handler(
        new Request(`https://example.com/.well-known/atrib-proof/${TEST_HASH}`),
      )

      expect(response).not.toBeNull()
      expect(response!.status).toBe(200)
      expect(response!.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable')

      const body = await response!.json()
      expect(body).toEqual(TEST_PROOF)
    })

    it('returns 400 Response for invalid hash', async () => {
      const server = createMockServer({})
      const handler = createAtribHttpHandler(server)
      const response = handler(
        new Request('https://example.com/.well-known/atrib-proof/not-a-hash'),
      )

      expect(response).not.toBeNull()
      expect(response!.status).toBe(400)
    })

    it('strips query strings from proof URL', async () => {
      const proofs = new Map([[TEST_HASH, TEST_PROOF]])
      const server = createMockServer({ proofs })
      const handler = createAtribHttpHandler(server)
      const response = handler(
        new Request(`https://example.com/.well-known/atrib-proof/${TEST_HASH}?debug=true`),
      )

      expect(response).not.toBeNull()
      expect(response!.status).toBe(200)
      const body = await response!.json()
      expect(body).toEqual(TEST_PROOF)
    })
  })

  describe('pass-through', () => {
    it('returns null for unmatched routes', () => {
      const server = createMockServer({ policy: TEST_POLICY })
      const handler = createAtribHttpHandler(server)
      expect(handler(new Request('https://example.com/api/data'))).toBeNull()
    })

    it('returns null for trailing slash on policy path', () => {
      const server = createMockServer({ policy: TEST_POLICY })
      const handler = createAtribHttpHandler(server)
      expect(handler(new Request('https://example.com/.well-known/atrib-policy.json/'))).toBeNull()
    })
  })
})
