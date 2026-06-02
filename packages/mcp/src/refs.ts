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
 * Field names that may carry record references for the middleware's
 * auto-detect path.
 *
 * `informed_by` is intentionally not included. For wrapped tools, that field
 * usually belongs to the upstream tool's own envelope. Treating it as the
 * wrapper record's claim double-counts edges and can promote unresolved refs
 * before the upstream tool has validated them. Wrappers that want that field
 * to become an edge should use an explicit informedBy callback or
 * @atrib/mcp-wrap informedByPaths.
 */
const AUTO_DETECT_RECORD_REF_KEYS = new Set([
  'record_hash',
  'record_hashes',
  'accepted_record_hashes',
  'required_record_hashes',
  'source_record_hash',
  'target_record_hash',
  'from_record_hash',
  'to_record_hash',
  'start_record_hash',
  'parent_record_hash',
  'annotates',
  'revises',
])

/** Env var used by parent producers to thread a parent record into child records. */
export const ATRIB_PARENT_RECORD_HASH_ENV = 'ATRIB_PARENT_RECORD_HASH'

/**
 * Return the parent record hash seed from an environment object.
 *
 * Invalid values are ignored so parent-child threading preserves the
 * degradation contract: attribution metadata may drop, but the tool call
 * must not fail.
 */
export function parentRecordHashFromEnv(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const value = env[ATRIB_PARENT_RECORD_HASH_ENV]
  return typeof value === 'string' && SHA256_REF_PATTERN.test(value) ? value : undefined
}

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

/**
 * Extract record-reference candidates from structured reference fields only.
 *
 * This is the safe input for autoDetectInformedByFromArgs. It does not scan
 * arbitrary prose, content payloads, args_hash/result_hash/content_id
 * commitments, or nested informed_by envelopes. Those values may be
 * meaningful evidence, but they are not automatically graph edges.
 */
export function extractRecordReferenceCandidates(value: unknown): Set<string> {
  const found = new Set<string>()

  function collect(v: unknown) {
    if (v === null || v === undefined) return
    if (typeof v === 'string') {
      const matches = v.match(SHA256_REF_GLOBAL_PATTERN)
      if (matches) for (const m of matches) found.add(m)
      return
    }
    if (Array.isArray(v)) {
      for (const item of v) collect(item)
      return
    }
    if (typeof v === 'object') {
      for (const item of Object.values(v as Record<string, unknown>)) collect(item)
    }
  }

  function walk(v: unknown) {
    if (v === null || v === undefined) return
    if (Array.isArray(v)) {
      for (const item of v) walk(item)
      return
    }
    if (typeof v !== 'object') return

    for (const [key, child] of Object.entries(v as Record<string, unknown>)) {
      if (AUTO_DETECT_RECORD_REF_KEYS.has(key)) collect(child)
      else walk(child)
    }
  }

  walk(value)
  return found
}
