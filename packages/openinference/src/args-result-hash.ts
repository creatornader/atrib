// SPDX-License-Identifier: Apache-2.0

/**
 * Args / result hash extraction per spec §8.3 (D045 salted-commitment
 * posture). Reads `input.value` + `output.value` from an OpenInference
 * span and produces the optional `args_hash` / `args_salt` /
 * `result_hash` / `result_salt` fields atrib's record format defines.
 * OpenInference stores those values as strings. When the string is valid
 * JSON, hash the parsed JSON value in JCS form. Otherwise hash the string
 * itself in JCS form. This matches verifier-side body replay.
 *
 * Three postures are supported (matching spec §8.3):
 *   - **'none'** (default) -- nothing emitted. Matches the §8.1 default
 *     privacy posture: verifiers cannot independently confirm what the
 *     agent claims to have sent or received.
 *   - **'plain'** -- emit `args_hash = sha256(canonical_args_bytes)` and
 *     `result_hash = sha256(canonical_result_bytes)`. No salt; verifiers
 *     can re-derive given the original args/result bytes. Lower privacy:
 *     a knowledgeable adversary can dictionary-attack short args.
 *   - **'salted'** -- emit `args_hash = sha256(salt || canonical_args_bytes)`
 *     plus `args_salt`, and the same for result. Higher privacy: salt
 *     prevents dictionary attacks; verifier needs both salt and original
 *     bytes to confirm.
 *
 * The processor's caller picks the posture per their threat model.
 * Default 'none' preserves §8.1 backwards-compatibility.
 */

import canonicalize from 'canonicalize'
import { sha256, hexEncode, base64urlEncode } from '@atrib/mcp'

export type ArgsResultHashPosture = 'none' | 'plain' | 'salted'

const SALT_LENGTH_BYTES = 16

export type ArgsResultHashFields = {
  readonly args_hash?: string
  readonly args_salt?: string
  readonly result_hash?: string
  readonly result_salt?: string
}

/**
 * Compute the args/result hash fields for a single OpenInference span's
 * `input.value` and `output.value`. Returns an empty object for posture
 * 'none' or when both inputs are absent.
 */
export function deriveArgsResultHashFields(
  posture: ArgsResultHashPosture,
  io: { input?: string; output?: string },
): ArgsResultHashFields {
  if (posture === 'none') return {}

  const fields: {
    args_hash?: string
    args_salt?: string
    result_hash?: string
    result_salt?: string
  } = {}

  if (io.input !== undefined) {
    if (posture === 'salted') {
      const salt = randomSalt()
      fields.args_hash = hashSalted(salt, canonicalMaterialBytes(io.input))
      fields.args_salt = base64urlEncode(salt)
    } else {
      fields.args_hash = hashPlain(canonicalMaterialBytes(io.input))
    }
  }

  if (io.output !== undefined) {
    if (posture === 'salted') {
      const salt = randomSalt()
      fields.result_hash = hashSalted(salt, canonicalMaterialBytes(io.output))
      fields.result_salt = base64urlEncode(salt)
    } else {
      fields.result_hash = hashPlain(canonicalMaterialBytes(io.output))
    }
  }

  return fields
}

function canonicalMaterialBytes(value: string): Uint8Array {
  const canonical = canonicalize(parseJsonOrString(value))
  if (canonical === undefined) {
    throw new Error('OpenInference input/output material is not JCS-encodable')
  }
  return new TextEncoder().encode(canonical)
}

function parseJsonOrString(value: string): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return value
  }
}

function hashPlain(bytes: Uint8Array): string {
  return `sha256:${hexEncode(sha256(bytes))}`
}

function hashSalted(salt: Uint8Array, bytes: Uint8Array): string {
  const concat = new Uint8Array(salt.length + bytes.length)
  concat.set(salt, 0)
  concat.set(bytes, salt.length)
  return `sha256:${hexEncode(sha256(concat))}`
}

function randomSalt(): Uint8Array {
  const out = new Uint8Array(SALT_LENGTH_BYTES)
  crypto.getRandomValues(out)
  return out
}
