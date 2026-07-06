// SPDX-License-Identifier: Apache-2.0

/**
 * createAtribClient(): the consolidated client over attest/recall.
 *
 * Daemon-first per D120/the SDK brief: writes and reads prefer the local
 * primitives runtime over MCP Streamable HTTP (one host-owned process,
 * one key owner, one mirror), falling back to in-process engines.
 * `@atrib/emit` is a hard dependency (the write fallback must always
 * work); `@atrib/recall` and `@atrib/verify-mcp` are OPTIONAL peer
 * dependencies loaded lazily, mirroring the P047 pattern — when absent,
 * the corresponding recall shapes degrade to a typed unavailable outcome
 * per §5.8 rather than failing to import.
 *
 * Operational failures never throw (§5.8); they degrade into `warnings`
 * on the result. The only throw paths are contradictory inputs
 * (programmer error).
 */

import { emitInProcess, resolveKey, type ResolvedKey } from '@atrib/emit'
import { resolveEnvContextId } from '@atrib/mcp'
import {
  attestResultFromEmitOutput,
  buildEmitArgs,
  type AttestInput,
  type AttestResult,
  type EmitOutputLike,
} from './attest.js'
import { DEFAULT_PRODUCER, resolveAnchorSet, type AtribClientConfig } from './config.js'
import { DaemonClient } from './daemon.js'
import {
  SHAPE_TO_TOOL,
  shapeOf,
  toToolArgs,
  type RecallOutcome,
  type RecallQuery,
} from './recall.js'

export interface AtribClient {
  /** Single write verb. Never throws on operational failure (§5.8). */
  attest(input: AttestInput): Promise<AttestResult>
  /** Single read verb. Never throws on operational failure (§5.8). */
  recall<T = unknown>(query: RecallQuery): Promise<RecallOutcome<T>>
  /** Close the daemon transport (if one was opened). */
  close(): Promise<void>
}

// Lazy loaders for the OPTIONAL peer fallback engines. Module shapes are
// declared structurally so the emitted .d.ts never references the peer
// packages — consumers without them installed still typecheck.
interface RecallModule {
  recall: (args: Record<string, unknown>) => Promise<unknown>
}
interface VerifyModule {
  handleAtribVerify: (input: Record<string, unknown>) => Promise<unknown>
}

let recallModulePromise: Promise<RecallModule | null> | null = null
function loadRecallModule(): Promise<RecallModule | null> {
  recallModulePromise ??= import('@atrib/recall').then(
    (mod) => mod as unknown as RecallModule,
    () => null,
  )
  return recallModulePromise
}

let verifyModulePromise: Promise<VerifyModule | null> | null = null
function loadVerifyModule(): Promise<VerifyModule | null> {
  verifyModulePromise ??= import('@atrib/verify-mcp').then(
    (mod) => mod as unknown as VerifyModule,
    () => null,
  )
  return verifyModulePromise
}

export function createAtribClient(config: AtribClientConfig = {}): AtribClient {
  const daemonMode = config.daemon?.mode ?? 'prefer'
  const daemon =
    daemonMode === 'off'
      ? null
      : new DaemonClient(config.daemon, {
          attributionReceipts: config.attributionReceipts === true,
        })
  const producer = config.producer ?? DEFAULT_PRODUCER
  const anchorSet = resolveAnchorSet(config.anchors)
  const anchorWarnings = anchorSet.warnings
  const logEndpoint = anchorSet.primaryLogEndpoint

  // Lazily resolve the in-process signing key once. `config.key === null`
  // is an explicit pass-through request; undefined defers to resolveKey().
  let keyPromise: Promise<ResolvedKey | null> | null = null
  const resolveClientKey = (): Promise<ResolvedKey | null> => {
    if (Object.prototype.hasOwnProperty.call(config, 'key')) {
      return Promise.resolve(config.key ?? null)
    }
    keyPromise ??= resolveKey().catch((error: unknown) => {
      console.warn(`atrib: key resolution failed: ${String(error)}`)
      return null
    })
    return keyPromise
  }

  const defaultContextId = (): string | undefined =>
    config.contextId ?? resolveEnvContextId()

  async function attest(input: AttestInput): Promise<AttestResult> {
    // Throws TypeError on contradictory input — the only throw path.
    const args = buildEmitArgs(input, defaultContextId())
    const warnings = [...anchorWarnings]

    if (daemon) {
      const outcome = await daemon.callTool('emit', args)
      const attribution = outcome.ok ? outcome.attribution : undefined
      const emitOutput =
        outcome.ok && typeof outcome.value === 'object' && outcome.value !== null
          ? (outcome.value as EmitOutputLike)
          : null
      // A structurally-garbage daemon result (no record_hash string) is a
      // daemon FAILURE, not a silent all-null success — fall through so
      // the in-process path can still sign.
      if (emitOutput !== null && typeof emitOutput.record_hash === 'string') {
        const result = attestResultFromEmitOutput(emitOutput, 'daemon', warnings)
        return attribution !== undefined
          ? { ...result, attribution_receipt: attribution }
          : result
      }
      const reason = outcome.ok
        ? 'daemon returned an emit result without a record_hash'
        : outcome.reason
      warnings.push(`atrib: daemon attest failed: ${reason}`)
      if (daemonMode === 'require') {
        return {
          record_hash: null,
          context_id: null,
          log_index: null,
          inclusion_proof: null,
          via: 'none',
          warnings,
        }
      }
    }

    const key = await resolveClientKey()
    if (key === null) {
      warnings.push(
        'atrib: no signing key available; operating in pass-through mode (§5.8), no record emitted',
      )
      return {
        record_hash: null,
        context_id: null,
        log_index: null,
        inclusion_proof: null,
        via: 'none',
        warnings,
      }
    }

    try {
      const output = await emitInProcess(args, {
        key,
        producer,
        ...(logEndpoint !== undefined ? { logEndpoint } : {}),
      })
      return attestResultFromEmitOutput(output as EmitOutputLike, 'in-process', warnings)
    } catch (error) {
      // emitInProcess throws only on input-shape validation; surface it as
      // the caller's programmer error.
      throw error instanceof Error ? error : new Error(String(error))
    }
  }

  async function recall<T = unknown>(query: RecallQuery): Promise<RecallOutcome<T>> {
    const shape = shapeOf(query)
    const tool = SHAPE_TO_TOOL[shape]
    if (tool === undefined) {
      throw new TypeError(`atrib: unknown recall shape: ${String(shape)}`)
    }
    const args = toToolArgs(query)
    if (shape === 'session_chain' || shape === 'orphans') {
      if (args['context_id'] === undefined) {
        const contextId = defaultContextId()
        if (contextId !== undefined) args['context_id'] = contextId
      }
    }
    const warnings: string[] = []

    if (daemon) {
      const outcome = await daemon.callTool(tool, args)
      if (outcome.ok) {
        const result: RecallOutcome<T> = {
          shape,
          via: 'daemon',
          data: outcome.value as T,
          warnings,
        }
        return outcome.attribution !== undefined
          ? { ...result, attribution_receipt: outcome.attribution }
          : result
      }
      warnings.push(`atrib: daemon recall (${tool}) failed: ${outcome.reason}`)
      if (daemonMode === 'require') {
        return { shape, via: 'none', data: null, warnings }
      }
    }

    try {
      if (shape === 'history') {
        const mod = await loadRecallModule()
        if (mod === null) {
          warnings.push(
            "atrib: in-process history fallback unavailable — install the optional peer '@atrib/recall'",
          )
          return { shape, via: 'none', data: null, warnings }
        }
        const data = await mod.recall(args)
        return { shape, via: 'in-process', data: data as T, warnings }
      }
      if (shape === 'verify') {
        const mod = await loadVerifyModule()
        if (mod === null) {
          warnings.push(
            "atrib: in-process verify fallback unavailable — install the optional peer '@atrib/verify-mcp'",
          )
          return { shape, via: 'none', data: null, warnings }
        }
        const data = await mod.handleAtribVerify(args)
        return { shape, via: 'in-process', data: data as T, warnings }
      }
    } catch (error) {
      warnings.push(`atrib: in-process recall (${shape}) failed: ${String(error)}`)
      return { shape, via: 'none', data: null, warnings }
    }

    warnings.push(
      `atrib: recall shape '${shape}' has no in-process fallback in @atrib/sdk v0; start the primitives runtime or use the ${tool} tool directly`,
    )
    return { shape, via: 'none', data: null, warnings }
  }

  return {
    attest,
    recall,
    close: async () => {
      if (daemon) await daemon.close()
    },
  }
}
