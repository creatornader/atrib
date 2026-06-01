import { describe, expect, it, vi } from 'vitest'
import { createFetchDpopReplayCache, dpopReplayCacheKeyId } from '../src/dpop-replay-cache.js'

describe('FetchDpopReplayCache', () => {
  it('posts replay keys to a shared host endpoint and returns accepted=true as new', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ accepted: true })))
    const cache = createFetchDpopReplayCache({
      endpoint: 'https://replay-cache.test/v1/dpop/check',
      fetchImpl,
      headers: { Authorization: 'Bearer test' },
    })
    const key = {
      issuer: 'https://auth.example.com',
      client_id: 'client-123',
      jkt: 'thumbprint',
      htm: 'POST',
      htu: 'https://mcp.example.com/mcp',
      jti: 'proof-1',
    }

    await expect(cache.checkAndRemember(key, 1_800_000_000)).resolves.toBe(true)

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://replay-cache.test/v1/dpop/check',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test',
        },
      }),
    )
    const body = JSON.parse(fetchImpl.mock.calls[0]![1]!.body as string)
    expect(body).toEqual({
      key,
      key_id: dpopReplayCacheKeyId(key),
      expires_at_seconds: 1_800_000_000,
    })
  })

  it('returns false when the shared host endpoint rejects a replayed key', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ accepted: false })))
    const cache = createFetchDpopReplayCache({
      endpoint: 'https://replay-cache.test/v1/dpop/check',
      fetchImpl,
    })

    await expect(cache.checkAndRemember({ jti: 'proof-1' }, 1_800_000_000)).resolves.toBe(false)
  })

  it('fails closed when the shared endpoint response is malformed', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true })))
    const cache = createFetchDpopReplayCache({
      endpoint: 'https://replay-cache.test/v1/dpop/check',
      fetchImpl,
    })

    await expect(cache.checkAndRemember({ jti: 'proof-1' }, 1_800_000_000)).rejects.toThrow(
      /accepted/,
    )
  })
})
