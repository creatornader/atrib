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

/**
 * One anchor in the anchor set (P043 headroom). A bare string is an
 * atrib-log §2.6.1 endpoint. The object form carries the forthcoming
 * `anchor_type` discriminator from the P043 draft: absent or 'atrib-log'
 * means an atrib log; other types (e.g. 'rekor', 'rfc3161-tsa') are not
 * yet supported and degrade with a warning. Non-atrib anchoring will use
 * a fresh anchoring signature over a reconstructible anchor-claim
 * artifact — never the record's own signature.
 */
export type AnchorSpec =
  | string
  | {
      endpoint: string
      anchor_type?: string
    }

export interface AtribClientConfig {
  daemon?: DaemonConfig
  /**
   * Anchor set: submission targets. Default:
   * [$ATRIB_LOG_ENDPOINT ?? https://log.atrib.dev/v1/entries].
   * Only the first atrib-log anchor is submitted to today (single-anchor
   * posture until upgrade-path step 1 lands); extra anchors produce a
   * warning, not an error.
   */
  anchors?: AnchorSpec[]
  /**
   * Explicit opt-in to single-anchor operation once the ≥2-anchor default
   * posture lands (upgrade-path step 1) — the escape hatch mirroring
   * `allow_unresolved_informed_by` (D113). Currently informational: the
   * default posture today IS single-anchor.
   */
  allowSingleAnchor?: boolean
  /**
   * Opt-in parsing of `dev.atrib/attribution` attestation receipts from
   * daemon tool results' `_meta` (P049 draft). Default false. Receipts
   * are advisory; trust still derives from verifying signed records.
   */
  attributionReceipts?: boolean
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

/**
 * Accepted D138 anchor_type registry (spec §2.11.9). Only 'atrib-log'
 * (the default when absent) is submitted to today; the others activate
 * with the multi-anchor fan-out in the protocol packages.
 */
export const ANCHOR_TYPES = [
  'atrib-log',
  'sigstore-rekor',
  'rfc3161-tsa',
  'opentimestamps',
] as const
export type AnchorType = (typeof ANCHOR_TYPES)[number]

export function resolveDaemonEndpoint(config?: DaemonConfig): string {
  return (
    config?.endpoint ??
    process.env['ATRIB_PRIMITIVES_HTTP_ENDPOINT'] ??
    DEFAULT_DAEMON_ENDPOINT
  )
}

export interface ResolvedAnchorSet {
  /** First atrib-log endpoint, the single submission target today. */
  primaryLogEndpoint: string | undefined
  warnings: string[]
}

/**
 * Normalize the anchor set to today's single-atrib-log posture, warning
 * (never erroring) about the parts upgrade-path step 1 will activate.
 */
export function resolveAnchorSet(anchors: AnchorSpec[] | undefined): ResolvedAnchorSet {
  const warnings: string[] = []
  if (!anchors || anchors.length === 0) {
    return { primaryLogEndpoint: undefined, warnings }
  }
  const atribLogEndpoints: string[] = []
  for (const spec of anchors) {
    // Hostile/malformed entries warn-and-skip, never throw (§5.8): the
    // documented anchor posture is "warning, not an error".
    let endpoint: unknown
    let anchorType: unknown
    if (typeof spec === 'string') {
      endpoint = spec
    } else if (typeof spec === 'object' && spec !== null) {
      endpoint = (spec as { endpoint?: unknown }).endpoint
      anchorType = (spec as { anchor_type?: unknown }).anchor_type
    } else {
      warnings.push(`atrib: anchor entry ${String(spec)} is not a string or object; skipping`)
      continue
    }
    if (typeof endpoint !== 'string') {
      warnings.push('atrib: anchor entry without a string endpoint; skipping')
      continue
    }
    if (anchorType !== undefined && anchorType !== 'atrib-log') {
      warnings.push(
        `atrib: anchor_type '${String(anchorType)}' (${endpoint}) is not supported yet (upgrade-path step 1); skipping this anchor`,
      )
      continue
    }
    try {
      new URL(endpoint)
    } catch {
      warnings.push(`atrib: anchor endpoint '${endpoint}' is not a valid URL; skipping`)
      continue
    }
    atribLogEndpoints.push(endpoint)
  }
  if (atribLogEndpoints.length > 1) {
    warnings.push(
      'atrib: multi-anchor fan-out is not implemented yet (upgrade-path step 1); submitting to the first anchor only',
    )
  }
  return { primaryLogEndpoint: atribLogEndpoints[0], warnings }
}
