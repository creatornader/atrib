// SPDX-License-Identifier: Apache-2.0

/**
 * Client configuration for the consolidated atrib SDK.
 *
 * Topology per the SDK session brief: the local primitives runtime (the
 * daemon) is the default peer; in-process signing via `@atrib/emit` is the
 * fallback. Anchors are an interface, not a log-node coupling: the config
 * takes an anchor SET, but until upgrade-path step 1 (anchor plurality)
 * lands, submission targets the first anchor with the existing
 * single-log proof shape.
 */

import type { ResolvedKey } from '@atrib/emit'

export type DaemonMode = 'prefer' | 'require' | 'off'

export interface DaemonConfig {
  /**
   * MCP Streamable HTTP endpoint of the local primitives runtime.
   * Default: $ATRIB_PRIMITIVES_HTTP_ENDPOINT, then http://127.0.0.1:8796/mcp.
   */
  endpoint?: string
  /**
   * 'prefer' (default): try the daemon, fall back in-process.
   * 'require': daemon only; operational failure degrades to a warning
   *            result (never a throw) per §5.8.
   * 'off': in-process only.
   */
  mode?: DaemonMode
  /** Connect/call timeout in ms. Default 1500 (connect) / 10000 (call). */
  connectTimeoutMs?: number
  callTimeoutMs?: number
  /** Cooldown before re-probing an unreachable daemon. Default 30000. */
  retryCooldownMs?: number
}

export interface AtribClientConfig {
  daemon?: DaemonConfig
  /**
   * Anchor set: log submission endpoints accepting §2.6.1 POSTs.
   * Default: [$ATRIB_LOG_ENDPOINT ?? https://log.atrib.dev/v1/entries].
   * Only anchors[0] is submitted to today (single-anchor posture until
   * upgrade-path step 1); extra anchors produce a warning, not an error.
   */
  anchors?: string[]
  /**
   * Explicit opt-in to single-anchor operation once the ≥2-anchor default
   * posture lands (upgrade-path step 1). Currently informational: the
   * default posture today IS single-anchor.
   */
  allowSingleAnchor?: boolean
  /**
   * Pre-resolved signing key for the in-process path. Default: the
   * `@atrib/emit` `resolveKey()` ladder (ATRIB_PRIVATE_KEY env, key file,
   * Keychain, 1Password). `null` disables in-process signing (pass-through
   * per §5.8 rule 5).
   */
  key?: ResolvedKey | null
  /**
   * Explicit context_id (32 lowercase hex). Stateless-MCP-native posture:
   * context identity is an explicit per-request value; this is only the
   * per-client default. Default: resolveEnvContextId() at call time.
   */
  contextId?: string
  /** `_local.producer` mirror sidecar label. Default 'atrib-sdk'. */
  producer?: string
}

export const DEFAULT_DAEMON_ENDPOINT = 'http://127.0.0.1:8796/mcp'
export const DEFAULT_CONNECT_TIMEOUT_MS = 1500
export const DEFAULT_CALL_TIMEOUT_MS = 10_000
export const DEFAULT_RETRY_COOLDOWN_MS = 30_000
export const DEFAULT_PRODUCER = 'atrib-sdk'

export function resolveDaemonEndpoint(config?: DaemonConfig): string {
  return (
    config?.endpoint ??
    process.env['ATRIB_PRIMITIVES_HTTP_ENDPOINT'] ??
    DEFAULT_DAEMON_ENDPOINT
  )
}
