// SPDX-License-Identifier: Apache-2.0

/**
 * Agent-to-subagent producer handoff helpers.
 *
 * A subagent spawn needs three independent signals to preserve structure:
 *
 * - ATRIB_CONTEXT_ID keeps the child in the parent session when that is the
 *   chosen runtime shape.
 * - ATRIB_CHAIN_TAIL_<context_id> lets the child's first record chain to the
 *   parent tail.
 * - ATRIB_PARENT_RECORD_HASH lets the child's first record cite the parent
 *   dispatch through informed_by.
 *
 * Keeping the bundle in one helper prevents adapters from setting only one or
 * two of the signals and then producing split chains or missing parent links.
 */

import { ATRIB_PARENT_RECORD_HASH_ENV, SHA256_REF_PATTERN } from './refs.js'

export const ATRIB_CONTEXT_ID_ENV = 'ATRIB_CONTEXT_ID'

const CONTEXT_ID_PATTERN = /^[0-9a-f]{32}$/

export interface BuildSubagentProducerEnvOptions {
  /** Parent session context_id for same-session subagents. */
  contextId?: string | undefined
  /** Signed parent dispatch record hash, `sha256:<64-hex>`. */
  parentRecordHash?: string | undefined
  /**
   * Chain tail the child should inherit. Defaults to parentRecordHash when the
   * parent dispatch record is also the latest known tail.
   */
  chainTailRecordHash?: string | undefined
  /** Existing env to copy before adding atrib handoff values. */
  baseEnv?: Record<string, string | undefined> | undefined
}

/**
 * Return the per-context chain-tail env var name, or undefined for invalid ids.
 */
export function chainTailEnvName(contextId: string): string | undefined {
  return CONTEXT_ID_PATTERN.test(contextId) ? `ATRIB_CHAIN_TAIL_${contextId}` : undefined
}

/**
 * Build the canonical env bundle for spawning a child producer.
 *
 * Invalid context ids or record hashes are omitted rather than throwing. This
 * preserves atrib's degradation contract: a bad attribution hint must not block
 * the subagent from running.
 */
export function buildSubagentProducerEnv(
  opts: BuildSubagentProducerEnvOptions,
): Record<string, string> {
  const env: Record<string, string> = {}

  for (const [key, value] of Object.entries(opts.baseEnv ?? {})) {
    if (typeof value === 'string') env[key] = value
  }

  const contextId =
    opts.contextId && CONTEXT_ID_PATTERN.test(opts.contextId) ? opts.contextId : undefined
  const tailEnvName = contextId ? chainTailEnvName(contextId) : undefined
  if (contextId) env[ATRIB_CONTEXT_ID_ENV] = contextId

  const parentRecordHash =
    opts.parentRecordHash && SHA256_REF_PATTERN.test(opts.parentRecordHash)
      ? opts.parentRecordHash
      : undefined
  if (parentRecordHash) env[ATRIB_PARENT_RECORD_HASH_ENV] = parentRecordHash

  const chainTailRecordHash =
    opts.chainTailRecordHash && SHA256_REF_PATTERN.test(opts.chainTailRecordHash)
      ? opts.chainTailRecordHash
      : parentRecordHash
  if (tailEnvName && chainTailRecordHash) env[tailEnvName] = chainTailRecordHash

  return env
}
