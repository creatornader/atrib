// SPDX-License-Identifier: Apache-2.0

/**
 * chain_root computation (§1.2.3).
 *
 * Genesis: "sha256:" + hex(SHA-256(UTF-8(context_id)))
 * Chain:   "sha256:" + hex(SHA-256(JCS(signed_parent_record)))
 */

import { sha256, hexEncode } from './hash.js'
import { canonicalRecord } from './canon.js'
import type { AtribRecord } from './types.js'

const encoder = new TextEncoder()

/**
 * Compute the chain_root for a genesis record (§1.2.3).
 * Anchors the chain to the context_id.
 */
export function genesisChainRoot(contextId: string): string {
  const digest = sha256(encoder.encode(contextId))
  return `sha256:${hexEncode(digest)}`
}

/**
 * Compute the chain_root for a non-genesis record.
 * Hash of the parent record's canonical signed form.
 */
export function chainRoot(parentRecord: AtribRecord): string {
  const canonical = canonicalRecord(parentRecord)
  const digest = sha256(canonical)
  return `sha256:${hexEncode(digest)}`
}

/**
 * Resolve the chain_root for a new record being signed.
 *
 * This helper is the single source of truth for chain-root selection across
 * all atrib producers (the wrapper middleware, atrib-emit, and any future
 * producer signing under the same identity). The precedence ordering is
 * normative per spec §1.2.3 and tested in the conformance corpus at
 * `spec/conformance/1.2.3/multi-producer/`.
 *
 * Precedence (highest to lowest):
 *   1. Inbound atrib propagation token, `inboundRecordHashHex`.
 *      The spec-canonical §1.5.2 cross-process handoff (MCP `_meta.atrib`,
 *      W3C tracestate, X-Atrib-Chain header). When present, the new record
 *      MUST chain to it; ignoring it would re-genesis a chain the caller
 *      explicitly extended.
 *   2. autoChain in-memory tail, `autoChainTailHex`.
 *      Within-process continuity; the producer signed a previous record
 *      under the same context in this process and remembers its hash.
 *   3. Cross-producer env-var handoff, `ATRIB_CHAIN_TAIL_<context_id>`.
 *      Parent process sets this when spawning a child producer so the
 *      child's first sign chains to the parent's tail. Decoded as a full
 *      `sha256:<64-hex>` string; malformed values fall through.
 *   4. Cross-producer mirror-file inheritance, `mirrorTailHex`.
 *      File-as-IPC fallback: caller pre-reads the most recent record from
 *      a shared on-disk mirror (filtered to the same context_id; see
 *      `readMirrorTail` in `./mirror.ts`) and passes its canonical hash
 *      here. Lower priority than env-var because env-var is set
 *      explicitly by the spawning process and reflects the freshest tail
 *      the spawner knows about, while the mirror may lag (file write
 *      hasn't completed, or a peer producer signed something the mirror
 *      hasn't reflected yet).
 *   5. Synthetic genesis, `sha256:hex(SHA-256(UTF-8(context_id)))` per
 *      §1.2.3. Final fallback when no upstream chain context exists.
 *
 * Pure synchronous function. The middleware and atrib-emit pass
 * `process.env` at call time; tests inject a stub env to avoid leaking
 * state between cases.
 */
export function resolveChainRoot(opts: {
  contextId: string
  inboundRecordHashHex?: string | undefined
  autoChainTailHex?: string | undefined
  mirrorTailHex?: string | undefined
  env?: NodeJS.ProcessEnv
}): string {
  if (opts.inboundRecordHashHex) {
    return `sha256:${opts.inboundRecordHashHex}`
  }
  if (opts.autoChainTailHex) {
    return `sha256:${opts.autoChainTailHex}`
  }
  const env = opts.env ?? process.env
  const envTail = env[`ATRIB_CHAIN_TAIL_${opts.contextId}`]
  if (envTail && /^sha256:[0-9a-f]{64}$/.test(envTail)) {
    return envTail
  }
  if (opts.mirrorTailHex && /^[0-9a-f]{64}$/.test(opts.mirrorTailHex)) {
    return `sha256:${opts.mirrorTailHex}`
  }
  return genesisChainRoot(opts.contextId)
}
