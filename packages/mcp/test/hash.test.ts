import { describe, it, expect } from 'vitest'
import { sha256, hexEncode, hexDecode } from '../src/hash.js'

describe('sha256', () => {
  it('hashes empty input to known digest', () => {
    const digest = sha256(new Uint8Array(0))
    const hex = hexEncode(digest)
    // SHA-256("") = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
    expect(hex).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })

  it('hashes "abc" to known digest', () => {
    const encoder = new TextEncoder()
    const digest = sha256(encoder.encode('abc'))
    const hex = hexEncode(digest)
    // SHA-256("abc") = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
    expect(hex).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  it('produces 32-byte output', () => {
    const digest = sha256(new Uint8Array([1, 2, 3]))
    expect(digest.length).toBe(32)
  })
})

describe('hexEncode / hexDecode', () => {
  it('round-trips bytes', () => {
    const bytes = new Uint8Array([0x00, 0x0f, 0xff, 0xab, 0xcd])
    const hex = hexEncode(bytes)
    expect(hex).toBe('000fffabcd')
    const decoded = hexDecode(hex)
    expect(decoded).toEqual(bytes)
  })

  it('produces lowercase hex', () => {
    const bytes = new Uint8Array([0xAB, 0xCD, 0xEF])
    const hex = hexEncode(bytes)
    expect(hex).toBe('abcdef')
  })

  it('hexDecode handles empty string', () => {
    const decoded = hexDecode('')
    expect(decoded).toEqual(new Uint8Array(0))
  })

  it('hexDecode throws on odd-length string', () => {
    // Odd-length hex is malformed — hexDecode now throws rather than silently truncating.
    expect(() => hexDecode('abc')).toThrow('hexDecode: invalid hex string')
  })

  it('hexDecode throws on non-hex characters', () => {
    expect(() => hexDecode('zz')).toThrow('hexDecode: invalid hex string')
    expect(() => hexDecode('0g')).toThrow('hexDecode: invalid hex string')
  })
})
