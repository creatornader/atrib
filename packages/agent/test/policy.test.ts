import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { initializeSessionPolicy } from '../src/policy.js'

const CTX = '4bf92f3577b34da6a3ce929d0e0e4736'

function policyResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('initializeSessionPolicy', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('basic record construction', () => {
    it('returns a record with correct shape when no domains given', async () => {
      const record = await initializeSessionPolicy({ contextId: CTX })
      expect(record.spec_version).toBe('atrib/1.0')
      expect(record.context_id).toBe(CTX)
      expect(record.merchant_policy).toBe('default')
      expect(record.agreed_policy).toBe('default')
      expect(record.creator_policies).toEqual([])
      expect(record.applied_constraints.minimum_floors).toEqual({})
      expect(typeof record.created_at).toBe('number')
    })

    it('computes record_id as sha256 hex of canonical form', async () => {
      const record = await initializeSessionPolicy({ contextId: CTX })
      expect(record.record_id).toMatch(/^sha256:[0-9a-f]{64}$/)
    })

    it('record_id is deterministic for identical inputs', async () => {
      // Pin created_at so two runs yield identical canonical forms
      const fixedNow = 1743850000000
      vi.spyOn(Date, 'now').mockReturnValue(fixedNow)
      const a = await initializeSessionPolicy({ contextId: CTX })
      const b = await initializeSessionPolicy({ contextId: CTX })
      expect(a.record_id).toBe(b.record_id)
    })
  })

  describe('merchant policy fetch', () => {
    it('warns when merchant policy not found (404)', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('not found', { status: 404 }))
      const record = await initializeSessionPolicy({
        contextId: CTX,
        merchantDomain: 'https://merchant.example.com',
      })
      expect(record.merchant_policy).toBe('default')
      expect(record.warnings.some((w) => w.includes('merchant policy not found'))).toBe(true)
    })

    it('uses merchant policy URL when fetch succeeds', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(policyResponse({ spec_version: 'atrib/1.0' }))
      const record = await initializeSessionPolicy({
        contextId: CTX,
        merchantDomain: 'https://merchant.example.com',
      })
      expect(record.merchant_policy).toContain('merchant.example.com')
      expect(record.agreed_policy).toContain('merchant.example.com')
    })

    it('treats network failures as not_found', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'))
      const record = await initializeSessionPolicy({
        contextId: CTX,
        merchantDomain: 'https://merchant.example.com',
      })
      expect(record.merchant_policy).toBe('default')
    })
  })

  describe('creator policy fetch', () => {
    it('fetches creator policies for each serverUrl', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
        policyResponse({ spec_version: 'atrib/1.0' }),
      )
      const record = await initializeSessionPolicy({
        contextId: CTX,
        serverUrls: ['https://a.example', 'https://b.example'],
      })
      expect(record.creator_policies).toHaveLength(2)
      expect(record.creator_policies[0]?.status).toBe('compatible')
      expect(record.creator_policies[1]?.status).toBe('compatible')
    })

    it('marks not_found when creator policy is missing', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 404 }))
      const record = await initializeSessionPolicy({
        contextId: CTX,
        serverUrls: ['https://a.example'],
      })
      expect(record.creator_policies[0]?.status).toBe('not_found')
    })
  })

  describe('§4.5.2 Rule 6: contradictory constraints rejected', () => {
    it('rejects policies where minimum_share > maximum_share', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        policyResponse({
          spec_version: 'atrib/1.0',
          constraints: { minimum_share: 0.5, maximum_share: 0.3 },
        }),
      )
      const record = await initializeSessionPolicy({
        contextId: CTX,
        serverUrls: ['https://a.example'],
      })
      // Contradictory policy is rejected → not_found
      expect(record.creator_policies[0]?.status).toBe('not_found')
    })

    it('rejects policies with negative constraint values', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        policyResponse({
          spec_version: 'atrib/1.0',
          constraints: { minimum_share: -0.1 },
        }),
      )
      const record = await initializeSessionPolicy({
        contextId: CTX,
        serverUrls: ['https://a.example'],
      })
      expect(record.creator_policies[0]?.status).toBe('not_found')
    })
  })

  describe('§4.5.2 Rule 5: floors summing >1.0 are irreconcilable', () => {
    it('falls back to default when creator floors sum >1.0', async () => {
      let call = 0
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        call++
        // Two creator floors of 0.6 each → sum = 1.2 > 1.0
        return policyResponse({
          spec_version: 'atrib/1.0',
          constraints: { minimum_own_share: 0.6 },
        })
      })
      const record = await initializeSessionPolicy({
        contextId: CTX,
        serverUrls: ['https://a.example', 'https://b.example'],
      })
      expect(call).toBe(2)
      expect(record.agreed_policy).toBe('default')
      expect(record.applied_constraints.minimum_floors).toEqual({})
      expect(record.creator_policies.every((c) => c.status === 'conflict_defaulted')).toBe(true)
      expect(record.warnings.some((w) => w.includes('>1.0'))).toBe(true)
    })
  })

  describe('§4.5.2 Rule 3: single creator floor exceeds merchant cap', () => {
    it('falls back to default when one creator floor > merchant cap', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
        const u = String(url)
        if (u.includes('merchant.example')) {
          return policyResponse({
            spec_version: 'atrib/1.0',
            constraints: { maximum_total_share: 0.3 },
          })
        }
        return policyResponse({
          spec_version: 'atrib/1.0',
          constraints: { minimum_own_share: 0.5 },
        })
      })
      const record = await initializeSessionPolicy({
        contextId: CTX,
        merchantDomain: 'https://merchant.example.com',
        serverUrls: ['https://a.example'],
      })
      expect(record.agreed_policy).toBe('default')
      expect(record.applied_constraints.minimum_floors).toEqual({})
      expect(record.warnings.some((w) => w.includes('exceeds merchant cap'))).toBe(true)
    })
  })

  describe('§4.5.2 Rules 1+2: floor scaling under merchant cap', () => {
    it('scales floors proportionally when sum exceeds cap but each fits', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
        const u = String(url)
        if (u.includes('merchant.example')) {
          return policyResponse({
            spec_version: 'atrib/1.0',
            constraints: { maximum_total_share: 0.4 },
          })
        }
        // Each individual floor (0.3) fits under cap, but sum (0.6) > cap
        return policyResponse({
          spec_version: 'atrib/1.0',
          constraints: { minimum_own_share: 0.3 },
        })
      })
      const record = await initializeSessionPolicy({
        contextId: CTX,
        merchantDomain: 'https://merchant.example.com',
        serverUrls: ['https://a.example', 'https://b.example'],
      })
      // Should NOT default — should scale
      expect(record.agreed_policy).not.toBe('default')
      const floors = record.applied_constraints.minimum_floors
      // Each scaled to 0.3 * (0.4/0.6) = 0.2
      expect(floors['https://a.example']).toBeCloseTo(0.2, 5)
      expect(floors['https://b.example']).toBeCloseTo(0.2, 5)
      expect(record.creator_policies.every((c) => c.status === 'floor_scaled')).toBe(true)
      expect(record.warnings.some((w) => w.includes('scaled by'))).toBe(true)
    })

    it('does not scale when floor sum is within cap', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
        const u = String(url)
        if (u.includes('merchant.example')) {
          return policyResponse({
            spec_version: 'atrib/1.0',
            constraints: { maximum_total_share: 0.8 },
          })
        }
        return policyResponse({
          spec_version: 'atrib/1.0',
          constraints: { minimum_own_share: 0.3 },
        })
      })
      const record = await initializeSessionPolicy({
        contextId: CTX,
        merchantDomain: 'https://merchant.example.com',
        serverUrls: ['https://a.example', 'https://b.example'],
      })
      const floors = record.applied_constraints.minimum_floors
      expect(floors['https://a.example']).toBe(0.3)
      expect(floors['https://b.example']).toBe(0.3)
      expect(record.creator_policies.every((c) => c.status === 'compatible')).toBe(true)
    })
  })

  describe('mixed creator policies', () => {
    it('handles a mix of compatible and not_found creators', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
        if (String(url).includes('a.example')) {
          return policyResponse({ spec_version: 'atrib/1.0' })
        }
        return new Response('', { status: 404 })
      })
      const record = await initializeSessionPolicy({
        contextId: CTX,
        serverUrls: ['https://a.example', 'https://b.example'],
      })
      const aEntry = record.creator_policies.find((c) => c.server_url === 'https://a.example')
      const bEntry = record.creator_policies.find((c) => c.server_url === 'https://b.example')
      expect(aEntry?.status).toBe('compatible')
      expect(bEntry?.status).toBe('not_found')
    })
  })
})
