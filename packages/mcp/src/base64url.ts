// SPDX-License-Identifier: Apache-2.0

/**
 * Base64url encoding/decoding (RFC 4648 §5, no padding).
 */

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

export function base64urlEncode(bytes: Uint8Array): string {
  let result = ''
  const len = bytes.length
  for (let i = 0; i < len; i += 3) {
    const b0 = bytes[i]!
    const b1 = i + 1 < len ? bytes[i + 1]! : 0
    const b2 = i + 2 < len ? bytes[i + 2]! : 0
    result += CHARS[(b0 >> 2)!]
    result += CHARS[((b0 & 0x03) << 4) | (b1 >> 4)]
    if (i + 1 < len) result += CHARS[((b1 & 0x0f) << 2) | (b2 >> 6)]
    if (i + 2 < len) result += CHARS[b2 & 0x3f]
  }
  return result
}

export function base64urlDecode(str: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(str)) {
    throw new Error('base64urlDecode: invalid base64url characters')
  }
  const lookup = new Uint8Array(128)
  for (let i = 0; i < CHARS.length; i++) {
    lookup[CHARS.charCodeAt(i)] = i
  }

  // Calculate output length accounting for no-padding
  const rem = str.length % 4
  const paddedLen = rem === 0 ? str.length : str.length + (4 - rem)
  const outLen = (paddedLen * 3) / 4 - (rem === 2 ? 2 : rem === 3 ? 1 : 0)
  const out = new Uint8Array(outLen)

  let j = 0
  for (let i = 0; i < str.length; i += 4) {
    const c0 = lookup[str.charCodeAt(i)]!
    const c1 = i + 1 < str.length ? lookup[str.charCodeAt(i + 1)]! : 0
    const c2 = i + 2 < str.length ? lookup[str.charCodeAt(i + 2)]! : 0
    const c3 = i + 3 < str.length ? lookup[str.charCodeAt(i + 3)]! : 0

    out[j++] = (c0 << 2) | (c1 >> 4)
    if (j < outLen) out[j++] = ((c1 & 0x0f) << 4) | (c2 >> 2)
    if (j < outLen) out[j++] = ((c2 & 0x03) << 6) | c3
  }

  return out
}
