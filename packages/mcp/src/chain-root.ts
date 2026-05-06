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
 * Resolve the chain_root for a new record being signed, in priority order:
 *   1. Inbound atrib propagation token (the spec-canonical §1.5.2 path) —
 *      `inboundRecordHashHex` if present.
 *   2. autoChain in-memory tail — `autoChainTailHex` for this context_id if
 *      autoChain is on AND a previous record has been signed by this
 *      middleware instance for this context.
 *   3. Cross-producer handoff via `ATRIB_CHAIN_TAIL_<context_id>` env var.
 *      Set by a parent process when spawning a child producer (different
 *      middleware instance, different producer type) so the child's first
 *      sign chains to the parent's tail rather than starting genesis.
 *   4. Synthetic genesis (sha256:hex(SHA-256(UTF-8(context_id)))).
 *
 * Pure function; testable without mocking process.env (env is passed in).
 * The middleware passes process.env at call time.
 */
export function resolveChainRoot(opts: {
  contextId: string
  inboundRecordHashHex?: string | undefined
  autoChainTailHex?: string | undefined
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
  return genesisChainRoot(opts.contextId)
}
