// SPDX-License-Identifier: Apache-2.0

import canonicalize from 'canonicalize'
import { base64urlDecode, base64urlEncode } from './base64url.js'
import { hexEncode, sha256 } from './hash.js'

export type JsonCommitmentScheme = 'plain-sha256' | 'salted-sha256'

export interface JsonCommitment {
  hash: string
  salt?: string
}

export interface SaltedJsonCommitment extends JsonCommitment {
  salt: string
}

export type JsonCommitmentFor<Scheme extends JsonCommitmentScheme> = Scheme extends 'salted-sha256'
  ? SaltedJsonCommitment
  : JsonCommitment

export type RandomBytes = (length: number) => Uint8Array

function systemRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return bytes
}

/**
 * Commit to a JSON value using the §8.3 JCS posture shared by middleware
 * and direct SDK action capture.
 */
export function createJsonCommitment<Scheme extends JsonCommitmentScheme>(
  value: unknown,
  scheme: Scheme,
  randomBytes: RandomBytes = systemRandomBytes,
): JsonCommitmentFor<Scheme> {
  const json = canonicalize(value)
  if (typeof json !== 'string') {
    throw new TypeError('atrib: commitment value must be JCS-canonicalizable JSON')
  }
  const valueBytes = new TextEncoder().encode(json)

  if (scheme === 'plain-sha256') {
    return { hash: `sha256:${hexEncode(sha256(valueBytes))}` } as JsonCommitmentFor<Scheme>
  }

  const saltBytes = randomBytes(16)
  if (!(saltBytes instanceof Uint8Array) || saltBytes.length !== 16) {
    throw new TypeError('atrib: commitment random source must return 16 bytes')
  }
  const combined = new Uint8Array(saltBytes.length + valueBytes.length)
  combined.set(saltBytes, 0)
  combined.set(valueBytes, saltBytes.length)
  return {
    hash: `sha256:${hexEncode(sha256(combined))}`,
    salt: base64urlEncode(saltBytes),
  } as JsonCommitmentFor<Scheme>
}

/** Hash a verbatim tool or action name using the §8.2 hashed-name posture. */
export function createToolNameCommitment(name: string): string {
  return `sha256:${hexEncode(sha256(new TextEncoder().encode(name)))}`
}

/** Replay a plain or salted §8.3 JSON commitment against supplied material. */
export function verifyJsonCommitment(
  value: unknown,
  commitment: { hash: string; salt?: string },
): boolean {
  const json = canonicalize(value)
  if (typeof json !== 'string') return false
  const valueBytes = new TextEncoder().encode(json)
  if (commitment.salt === undefined) {
    return `sha256:${hexEncode(sha256(valueBytes))}` === commitment.hash
  }
  let saltBytes: Uint8Array
  try {
    saltBytes = base64urlDecode(commitment.salt)
  } catch {
    return false
  }
  if (saltBytes.length !== 16) return false
  const combined = new Uint8Array(saltBytes.length + valueBytes.length)
  combined.set(saltBytes, 0)
  combined.set(valueBytes, saltBytes.length)
  return `sha256:${hexEncode(sha256(combined))}` === commitment.hash
}
