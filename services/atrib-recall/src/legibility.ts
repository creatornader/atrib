// SPDX-License-Identifier: Apache-2.0

/**
 * Layer 1 v2 legibility helpers for recall responses.
 *
 * Recall returns records with substrate signals attached (annotations,
 * supersession, scoring). Pre-v2 the response left agents to dereference
 * opaque hashes to figure out what each record was about. This module
 * derives compact human-legible display fields from data already in the
 * mirror so the agent can scan results at a glance.
 *
 * Three fields:
 *   - display_summary: one-line description, fallback chain per event_type
 *   - display_producer: friendly producer label from _local.producer
 *                      sidecar, else short key prefix as "key:<8hex>"
 *   - age: relative time string ("just now", "5m ago", "3d ago",
 *          "2026-04-12" for older than 30 days)
 *
 * All derivations are pure functions of the record + sidecar data; no
 * network calls, no LLM. Silent failure: any helper that can't produce
 * a meaningful value returns a sentinel ("unknown", "no description")
 * rather than throwing.
 */

import type { AtribRecord } from '@atrib/mcp'
import type { AnnotationSummary } from './aggregations.js'

const ATRIB_EVENT_TYPE_PREFIX = 'https://atrib.dev/v1/types/'

const SUMMARY_MAX_LEN = 120
const ARGS_EXCERPT_MAX_LEN = 60
const HASH_PREFIX_LEN = 12

/**
 * One-line human-legible description of the record.
 *
 * Fallback chain:
 *   1. annotation summary (always wins if any annotation pointing at this
 *      record carried a non-empty summary)
 *   2. per-event_type synthesis from record fields + _local.content
 *   3. generic fallback labeled by event_type tail
 *
 * Output is capped at SUMMARY_MAX_LEN; longer text is truncated with an
 * ellipsis. The cap is empirically chosen to fit ~3 records per screen
 * scan in typical terminal widths.
 */
export function synthesizeDisplaySummary(
  record: AtribRecord,
  content: unknown,
  annotations: AnnotationSummary | undefined,
): string {
  // 1. Annotation summary is the highest-quality signal when present.
  if (annotations?.summary && annotations.summary.length > 0) {
    return truncate(annotations.summary, SUMMARY_MAX_LEN)
  }

  // 2. Per-event_type synthesis.
  const tool_name = (record as AtribRecord & { tool_name?: string }).tool_name
  const c = isObject(content) ? content as Record<string, unknown> : {}

  switch (record.event_type) {
    case `${ATRIB_EVENT_TYPE_PREFIX}tool_call`: {
      const args = c.args ?? c.input ?? c.arguments
      if (tool_name) {
        if (isObject(args)) {
          const argsExcerpt = stringifyArgsBrief(args as Record<string, unknown>, ARGS_EXCERPT_MAX_LEN)
          return truncate(`call ${tool_name}(${argsExcerpt})`, SUMMARY_MAX_LEN)
        }
        return `call ${tool_name}`
      }
      return 'tool call'
    }
    case `${ATRIB_EVENT_TYPE_PREFIX}transaction`: {
      const amount = c.amount ?? c.value
      const merchant = c.merchant ?? c.recipient ?? c.to
      const protocol = c.protocol ?? c.via
      if (amount && merchant) {
        const proto = protocol ? ` via ${String(protocol)}` : ''
        return truncate(`${String(amount)} to ${String(merchant)}${proto}`, SUMMARY_MAX_LEN)
      }
      return 'transaction'
    }
    case `${ATRIB_EVENT_TYPE_PREFIX}observation`: {
      const what = c.what
      if (typeof what === 'string' && what.length > 0) {
        return truncate(what, SUMMARY_MAX_LEN)
      }
      return 'observation'
    }
    case `${ATRIB_EVENT_TYPE_PREFIX}directory_anchor`: {
      const root = c.tree_root ?? c.root
      if (typeof root === 'string') {
        return `directory anchor ${truncate(root, 40)}`
      }
      return 'directory anchor'
    }
    case `${ATRIB_EVENT_TYPE_PREFIX}annotation`: {
      const annotates = c.annotates
      const importance = c.importance
      const summary = c.summary
      const annotatesShort = typeof annotates === 'string'
        ? shortHash(annotates)
        : 'unknown'
      if (typeof summary === 'string' && summary.length > 0) {
        const impTag = importance ? `[${String(importance)}] ` : ''
        return truncate(`annotates ${annotatesShort}: ${impTag}${summary}`, SUMMARY_MAX_LEN)
      }
      return `annotates ${annotatesShort}`
    }
    case `${ATRIB_EVENT_TYPE_PREFIX}revision`: {
      const revises = c.revises
      const newPos = c.new_position
      const revisesShort = typeof revises === 'string'
        ? shortHash(revises)
        : 'unknown'
      if (typeof newPos === 'string' && newPos.length > 0) {
        return truncate(`revises ${revisesShort}: ${newPos}`, SUMMARY_MAX_LEN)
      }
      return `revises ${revisesShort}`
    }
    default: {
      // Extension URIs (0xFF) and unknown: surface the URI tail.
      const tail = record.event_type.split('/').pop() ?? record.event_type
      return tail.length > 0 ? tail : 'unknown event'
    }
  }
}

/**
 * Friendly label for the local producer that wrote this record.
 *
 * Order:
 *   1. _local.producer from the D062 sidecar when present (e.g.
 *      "atrib-emit-cli", "claude-hooks-builtin-2b", "claude-code")
 *   2. fallback "key:<8hex>" prefix of creator_key as a clear signal
 *      that no producer label was available
 *
 * Producer (this function) vs signer (the follow-up display_signer
 * field) — DO NOT CONFLATE:
 *   - display_producer = sidecar-only label of which LOCAL CODE signed
 *     the record. Useful for debugging the local producer pipeline
 *     ("atrib-emit-cli wrote this, not claude-hooks-builtin-2b").
 *     Not verifiable. Not portable across operators.
 *   - display_signer (planned) = AKD-backed identity-claim lookup for
 *     which HUMAN OR ORGANIZATION holds the signing key. Verifiable.
 *     Portable across operators. Lives in @atrib/directory.
 * Repurposing display_producer for AKD lookup would break back-compat
 * AND quietly conflate two distinct trust signals; if AKD-backed
 * identity needs to surface, add display_signer as a NEW field, do
 * not change this function's semantics.
 */
export function resolveDisplayProducer(
  record: AtribRecord,
  producer: string | undefined,
): string {
  if (producer && producer.length > 0) {
    return producer
  }
  const key = record.creator_key
  if (typeof key === 'string' && key.length >= 8) {
    return `key:${key.slice(0, 8)}`
  }
  return 'unknown'
}

/**
 * Relative time string. Buckets chosen so agents can scan results
 * "1m / 5h / 3d" without parsing absolute timestamps.
 *
 * Buckets:
 *   < 60s              -> "just now"
 *   < 1h               -> "Xm ago"
 *   < 24h              -> "Xh ago"
 *   < 30d              -> "Xd ago"
 *   older              -> ISO date "YYYY-MM-DD"
 *   future (timestamp > now) -> "future" (sentinel; should not happen)
 */
export function formatAge(timestamp: number, now: number): string {
  // Defensive: NaN / Infinity / non-finite inputs would later throw at
  // new Date().toISOString() (RangeError "Invalid time value"). Return
  // a sentinel instead so the recall response stays well-formed even if
  // a malformed record makes it through the load path.
  if (!Number.isFinite(timestamp) || !Number.isFinite(now)) return 'unknown'
  const diff = now - timestamp
  if (diff < 0) return 'future'
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  if (diff < 30 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`
  return new Date(timestamp).toISOString().slice(0, 10)
}

// --- helpers ---

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s
  // Trim trailing whitespace before the ellipsis so we don't end on "  …".
  return s.slice(0, maxLen - 1).trimEnd() + '…'
}

function shortHash(hash: string): string {
  // "sha256:abc..." -> "sha256:abc..." truncated to a recognizable prefix
  // for inline display ("sha256:cbcb2322309e…").
  if (hash.startsWith('sha256:')) {
    return `sha256:${hash.slice(7, 7 + HASH_PREFIX_LEN)}…`
  }
  return hash.length > HASH_PREFIX_LEN ? `${hash.slice(0, HASH_PREFIX_LEN)}…` : hash
}

function stringifyArgsBrief(args: Record<string, unknown>, maxLen: number): string {
  const parts: string[] = []
  for (const [k, v] of Object.entries(args)) {
    let vStr: string
    if (typeof v === 'string') {
      // Inline short strings; truncate long ones.
      vStr = v.length > 20 ? `"${v.slice(0, 19)}…"` : `"${v}"`
    } else if (typeof v === 'number' || typeof v === 'boolean') {
      vStr = String(v)
    } else if (v === null) {
      vStr = 'null'
    } else if (Array.isArray(v)) {
      vStr = `[${v.length}]`
    } else if (typeof v === 'object') {
      vStr = '{…}'
    } else {
      vStr = String(v)
    }
    parts.push(`${k}=${vStr}`)
    if (parts.join(', ').length >= maxLen) break
  }
  return truncate(parts.join(', '), maxLen)
}
