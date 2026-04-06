import { describe, it, expect } from 'vitest'
import { base64urlEncode, base64urlDecode } from '../src/base64url.js'

describe('base64url', () => {
  it('round-trips 32-byte values', () => {
    const bytes = new Uint8Array(32)
    for (let i = 0; i < 32; i++) bytes[i] = i
    const encoded = base64urlEncode(bytes)
    const decoded = base64urlDecode(encoded)
    expect(decoded).toEqual(bytes)
  })

  it('round-trips 64-byte values', () => {
    const bytes = new Uint8Array(64)
    for (let i = 0; i < 64; i++) bytes[i] = i * 3 + 7
    const encoded = base64urlEncode(bytes)
    const decoded = base64urlDecode(encoded)
    expect(decoded).toEqual(bytes)
  })

  it('encodes 32 bytes to 43 characters (no padding)', () => {
    const bytes = new Uint8Array(32).fill(0xff)
    const encoded = base64urlEncode(bytes)
    expect(encoded.length).toBe(43)
    expect(encoded).not.toContain('=')
    expect(encoded).not.toContain('+')
    expect(encoded).not.toContain('/')
  })

  it('encodes 64 bytes to 86 characters (no padding)', () => {
    const bytes = new Uint8Array(64).fill(0xab)
    const encoded = base64urlEncode(bytes)
    expect(encoded.length).toBe(86)
  })

  it('round-trips empty array', () => {
    const bytes = new Uint8Array(0)
    const encoded = base64urlEncode(bytes)
    expect(encoded).toBe('')
    const decoded = base64urlDecode(encoded)
    expect(decoded).toEqual(bytes)
  })

  it('round-trips 16-byte values', () => {
    const bytes = crypto.getRandomValues(new Uint8Array(16))
    const encoded = base64urlEncode(bytes)
    expect(encoded.length).toBe(22)
    const decoded = base64urlDecode(encoded)
    expect(decoded).toEqual(bytes)
  })

  it('uses URL-safe characters only', () => {
    // Test with bytes that would produce + and / in standard base64
    const bytes = new Uint8Array([0xfb, 0xff, 0xfe, 0xfb, 0xff, 0xfe])
    const encoded = base64urlEncode(bytes)
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/)
  })
})
