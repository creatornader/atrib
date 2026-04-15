import { describe, it, expect } from 'vitest'
import { zeroize } from '../src/zeroize.js'

describe('zeroize', () => {
  it('fills a buffer with zeros', () => {
    const buf = new Uint8Array([1, 2, 3, 4, 5])
    zeroize(buf)
    expect(buf).toEqual(new Uint8Array(5))
  })

  it('works on an already-zero buffer', () => {
    const buf = new Uint8Array(8)
    zeroize(buf)
    expect(buf).toEqual(new Uint8Array(8))
  })

  it('works on an empty buffer', () => {
    const buf = new Uint8Array(0)
    zeroize(buf)
    expect(buf.length).toBe(0)
  })

  it('modifies the buffer in place', () => {
    const buf = new Uint8Array([0xff, 0xfe, 0xfd])
    const ref = buf
    zeroize(buf)
    // Same reference, all zeros.
    expect(ref).toBe(buf)
    expect(ref[0]).toBe(0)
    expect(ref[1]).toBe(0)
    expect(ref[2]).toBe(0)
  })

  it('zeros a 32-byte key-sized buffer', () => {
    const buf = new Uint8Array(32).fill(0xab)
    zeroize(buf)
    for (let i = 0; i < 32; i++) {
      expect(buf[i]).toBe(0)
    }
  })
})
