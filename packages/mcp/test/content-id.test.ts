import { describe, it, expect } from 'vitest'
import { computeContentId, normalizeServerUrl } from '../src/content-id.js'

describe('normalizeServerUrl', () => {
  it('lowercases scheme and host', () => {
    expect(normalizeServerUrl('HTTPS://Tools.Example.Com/')).toBe('https://tools.example.com')
  })

  it('removes trailing slash', () => {
    expect(normalizeServerUrl('https://tools.example.com/')).toBe('https://tools.example.com')
  })

  it('preserves explicit port', () => {
    expect(normalizeServerUrl('https://tools.example.com:8443/')).toBe(
      'https://tools.example.com:8443',
    )
  })

  it('preserves path without trailing slash', () => {
    expect(normalizeServerUrl('https://example.com/api/v1')).toBe('https://example.com/api/v1')
  })

  it('removes trailing slash from path', () => {
    expect(normalizeServerUrl('https://example.com/api/v1/')).toBe('https://example.com/api/v1')
  })

  it('excludes query strings', () => {
    expect(normalizeServerUrl('https://example.com/api?key=val')).toBe('https://example.com/api')
  })

  it('excludes fragments', () => {
    expect(normalizeServerUrl('https://example.com/api#section')).toBe('https://example.com/api')
  })

  it('normalizing same URL with different casing produces same result', () => {
    const a = normalizeServerUrl('HTTPS://Tools.Example.Com/')
    const b = normalizeServerUrl('https://tools.example.com')
    expect(a).toBe(b)
  })
})

describe('computeContentId', () => {
  it('returns sha256-prefixed hex string', () => {
    const id = computeContentId('https://tools.example.com', 'search_web')
    expect(id).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  it('is deterministic', () => {
    const a = computeContentId('https://tools.example.com', 'search_web')
    const b = computeContentId('https://tools.example.com', 'search_web')
    expect(a).toBe(b)
  })

  it('different tool names produce different content_ids', () => {
    const a = computeContentId('https://tools.example.com', 'search_web')
    const b = computeContentId('https://tools.example.com', 'fetch_data')
    expect(a).not.toBe(b)
  })

  it('different server URLs produce different content_ids', () => {
    const a = computeContentId('https://server-a.example.com', 'search_web')
    const b = computeContentId('https://server-b.example.com', 'search_web')
    expect(a).not.toBe(b)
  })

  it('normalizes server URL before hashing', () => {
    const a = computeContentId('HTTPS://Tools.Example.Com/', 'search_web')
    const b = computeContentId('https://tools.example.com', 'search_web')
    expect(a).toBe(b)
  })

  it('preserves tool name case', () => {
    const a = computeContentId('https://tools.example.com', 'Search_Web')
    const b = computeContentId('https://tools.example.com', 'search_web')
    expect(a).not.toBe(b)
  })
})
