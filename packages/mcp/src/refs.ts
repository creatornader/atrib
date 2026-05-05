// SPDX-License-Identifier: Apache-2.0

/**
 * Record-hash reference primitives shared across the producer side
 * (middleware, atrib-emit, hooks).
 *
 * Per atrib-spec §1.2.5: informed_by entries are "sha256:" + 64 lowercase hex.
 * Per §1.2.7: annotates is the same shape.
 *
 * Co-locating the regex + extractor here means the middleware's
 * autoDetectInformedByFromArgs path, atrib-emit's input validation, and any
 * out-of-tree wrapper (e.g. mcp-wrap) all use the same definitions. Drift
 * between them would silently produce records with inconsistent reference
 * formats (some pass-through, some rejected).
 */

/** Anchored regex matching a single canonical record_hash reference. */
export const SHA256_REF_PATTERN = /^sha256:[0-9a-f]{64}$/

/** Global (unanchored) regex used for scanning prose / nested values. */
export const SHA256_REF_GLOBAL_PATTERN = /sha256:[0-9a-f]{64}/g

/**
 * Walk a value (any shape) and extract all sha256:<64-hex> references.
 * Returns a Set of canonicalized matches.
 *
 * Skips the top-level `chain_root` field, that field carries the chain
 * primitive (parent record's hash), not a reference the agent is claiming
 * informed the action. Per §1.2.3 chain_root is structural metadata.
 *
 * The walker is recursive but only skips `chain_root` at the IMMEDIATE
 * top level of an object. Nested keys like `previous.chain_root` would
 * still be walked (a producer that nests a sha256 deep in args genuinely
 * means it as a reference; the structural-metadata exception is only for
 * the top-level field name).
 */
export function extractRecordHashes(value: unknown): Set<string> {
  const found = new Set<string>()
  function walk(v: unknown, isTopLevel: boolean) {
    if (v === null || v === undefined) return
    if (typeof v === 'string') {
      const matches = v.match(SHA256_REF_GLOBAL_PATTERN)
      if (matches) for (const m of matches) found.add(m)
      return
    }
    if (Array.isArray(v)) {
      for (const item of v) walk(item, false)
      return
    }
    if (typeof v === 'object') {
      for (const [k, vv] of Object.entries(v as Record<string, unknown>)) {
        if (isTopLevel && k === 'chain_root') continue
        walk(vv, false)
      }
    }
  }
  walk(value, true)
  return found
}
