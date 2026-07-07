// SPDX-License-Identifier: Apache-2.0

/**
 * Client configuration for the consolidated atrib SDK.
 *
 * Topology per the SDK session brief: the local primitives runtime (the
 * daemon) is the default peer; in-process signing via `@atrib/emit` is the
 * fallback. Anchors are the D138 anchor-plurality surface from `@atrib/mcp`
 * (spec §2.11.7-§2.11.13): the config takes an anchor SET which is
 * normalized into an `AnchorSetConfig` and fanned out through
 * `createAnchorFanout` on the in-process attest path. When no anchors are
 * configured, the `BUILT_IN_DEFAULT_ANCHOR_SET` (two independent anchors)
 * applies.
 */

import { ANCHOR_TYPES, type AnchorDescriptor, type AnchorSetConfig, type AnchorType } from '@atrib/mcp'
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
 * One anchor in the anchor set (D138, spec §2.11.12). A bare string is an
 * atrib-log §2.6.1 endpoint (normalized to `{ url }`). The object form is
 * `AnchorDescriptor` from `@atrib/mcp`: `anchor_type` absent means
 * `'atrib-log'`; `url` wins over `endpoint` when both are set; the
 * registered types are `ANCHOR_TYPES` (§2.11.8 v1 registry).
 */
export type AnchorSpec = string | AnchorDescriptor

export interface AtribClientConfig {
  daemon?: DaemonConfig
  /**
   * Anchor set (D138, §2.11.12). When omitted, the two-anchor
   * `BUILT_IN_DEFAULT_ANCHOR_SET` from `@atrib/mcp` applies and the emit
   * pipeline keeps its own env/default atrib-log endpoint. Hostile or
   * malformed entries warn-and-skip, never error (§5.8).
   */
  anchors?: AnchorSpec[]
  /**
   * Opt-in acknowledgment that a sub-plurality (< 2) anchor set is
   * deliberate (§2.11.12 rule 3) — the anchor analog of
   * `allow_unresolved_informed_by` (D113). Maps to
   * `AnchorSetConfig.allow_single_anchor`.
   */
  allowSingleAnchor?: boolean
  /**
   * Opt-in parsing of `dev.atrib/attribution` attestation receipts from
   * daemon tool results' `_meta` (D141). Default false. Receipts are
   * advisory; trust still derives from verifying signed records. Parsed
   * blocks are additionally run through `verifyAttributionReceipt`.
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

const ANCHOR_TYPE_SET: ReadonlySet<string> = new Set(ANCHOR_TYPES)

export function resolveDaemonEndpoint(config?: DaemonConfig): string {
  return (
    config?.endpoint ??
    process.env['ATRIB_PRIMITIVES_HTTP_ENDPOINT'] ??
    DEFAULT_DAEMON_ENDPOINT
  )
}

export interface ResolvedAnchorSet {
  /**
   * Canonical §2.11.12 anchor-set config for `createAnchorFanout`. `{}`
   * (no `anchors` key) when the caller configured nothing, so the
   * built-in default set applies downstream.
   */
  config: AnchorSetConfig
  /**
   * First effective `'atrib-log'` descriptor's `url ?? endpoint`, passed
   * to the emit pipeline as its §2.6.1 log endpoint. Undefined when the
   * config is empty (the built-in default set applies and emitInProcess
   * keeps its own env/default endpoint).
   */
  primaryLogEndpoint: string | undefined
  warnings: string[]
}

/**
 * Normalize the caller's anchor set into a D138 `AnchorSetConfig`
 * (§2.11.12). Hostile/malformed entries — null, non-object/non-string,
 * missing string `url`/`endpoint`, unparseable URL, unregistered
 * `anchor_type` — warn-and-skip, never throw (§5.8). Plurality posture
 * (warn on < 2 anchors without `allow_single_anchor`) is resolved by the
 * fan-out via `resolveAnchorPosture`, not here.
 */
export function resolveAnchorSet(
  anchors: AnchorSpec[] | undefined,
  allowSingleAnchor?: boolean,
): ResolvedAnchorSet {
  const warnings: string[] = []
  if (anchors === undefined) {
    // No anchor config at all: the BUILT_IN_DEFAULT_ANCHOR_SET applies
    // (§2.11.12 rule 1) and the emit pipeline keeps its own env/default
    // atrib-log endpoint.
    return { config: {}, primaryLogEndpoint: undefined, warnings }
  }
  const descriptors: AnchorDescriptor[] = []
  let primaryLogEndpoint: string | undefined
  for (const spec of anchors) {
    // Hostile/malformed entries warn-and-skip, never throw (§5.8).
    let descriptor: AnchorDescriptor
    if (typeof spec === 'string') {
      descriptor = { url: spec }
    } else if (typeof spec === 'object' && spec !== null && !Array.isArray(spec)) {
      descriptor = spec
    } else {
      warnings.push(`atrib: anchor entry ${String(spec)} is not a string or object; skipping`)
      continue
    }
    const anchorType = (descriptor as { anchor_type?: unknown }).anchor_type
    if (anchorType !== undefined && (typeof anchorType !== 'string' || !ANCHOR_TYPE_SET.has(anchorType))) {
      const named = (descriptor.url ?? descriptor.endpoint) as unknown
      warnings.push(
        `atrib: anchor_type '${String(anchorType)}'${typeof named === 'string' ? ` (${named})` : ''} is not in the §2.11.8 registry (${ANCHOR_TYPES.join(', ')}); skipping this anchor`,
      )
      continue
    }
    const effectiveType: AnchorType = (anchorType as AnchorType | undefined) ?? 'atrib-log'
    // `url` wins over `endpoint` when both are set (the §2.11.12 sample
    // config spells the field `url`; both spellings are accepted).
    const endpoint = (descriptor as { url?: unknown }).url ?? (descriptor as { endpoint?: unknown }).endpoint
    if (effectiveType === 'atrib-log' || endpoint !== undefined) {
      if (typeof endpoint !== 'string') {
        warnings.push('atrib: anchor entry without a string url/endpoint; skipping')
        continue
      }
      try {
        new URL(endpoint)
      } catch {
        warnings.push(`atrib: anchor endpoint '${endpoint}' is not a valid URL; skipping`)
        continue
      }
      if (effectiveType === 'atrib-log' && primaryLogEndpoint === undefined) {
        primaryLogEndpoint = endpoint
      }
    }
    descriptors.push(descriptor)
  }
  const config: AnchorSetConfig = {
    anchors: descriptors,
    ...(allowSingleAnchor === true ? { allow_single_anchor: true } : {}),
  }
  return { config, primaryLogEndpoint, warnings }
}
