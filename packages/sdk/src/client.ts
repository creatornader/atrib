// SPDX-License-Identifier: Apache-2.0

/**
 * createAtribClient(): the consolidated client over attest/recall.
 *
 * Daemon-first per D120/the SDK brief: writes and reads prefer the local
 * primitives runtime over MCP Streamable HTTP (one host-owned process,
 * one key owner, one mirror), falling back to the in-process engines from
 * @atrib/emit / @atrib/recall / @atrib/verify-mcp. Operational failures
 * never throw (§5.8); they degrade into `warnings` on the result. The only
 * throw paths are contradictory inputs (programmer error).
 */

import { emitInProcess, resolveKey, type ResolvedKey } from '@atrib/emit'
import { resolveEnvContextId } from '@atrib/mcp'
import { recall as recallHistoryInProcess } from '@atrib/recall'
import { handleAtribVerify, type AtribVerifyInput } from '@atrib/verify-mcp'
import {
  attestResultFromEmitOutput,
  buildEmitArgs,
  type AttestInput,
  type AttestResult,
  type EmitOutputLike,
} from './attest.js'
import { DEFAULT_PRODUCER, type AtribClientConfig } from './config.js'
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

export function createAtribClient(config: AtribClientConfig = {}): AtribClient {
  const daemonMode = config.daemon?.mode ?? 'prefer'
  const daemon = daemonMode === 'off' ? null : new DaemonClient(config.daemon)
  const producer = config.producer ?? DEFAULT_PRODUCER
  const anchors = config.anchors ?? []
  const anchorWarnings: string[] = []
  if (anchors.length > 1) {
    anchorWarnings.push(
      'atrib: multi-anchor fan-out is not implemented yet (upgrade-path step 1); submitting to the first anchor only',
    )
  }
  const logEndpoint = anchors[0]

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
      if (outcome.ok && typeof outcome.value === 'object' && outcome.value !== null) {
        return attestResultFromEmitOutput(outcome.value as EmitOutputLike, 'daemon', warnings)
      }
      const reason = outcome.ok
        ? 'daemon returned a non-object emit result'
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
    if (shape === 'history' || shape === 'session_chain' || shape === 'orphans') {
      if (args['context_id'] === undefined) {
        const contextId = defaultContextId()
        if (contextId !== undefined && shape !== 'history') args['context_id'] = contextId
      }
    }
    const warnings: string[] = []

    if (daemon) {
      const outcome = await daemon.callTool(tool, args)
      if (outcome.ok) {
        return { shape, via: 'daemon', data: outcome.value as T, warnings }
      }
      warnings.push(`atrib: daemon recall (${tool}) failed: ${outcome.reason}`)
      if (daemonMode === 'require') {
        return { shape, via: 'none', data: null, warnings }
      }
    }

    try {
      if (shape === 'history') {
        const data = await recallHistoryInProcess(
          args as Parameters<typeof recallHistoryInProcess>[0],
        )
        return { shape, via: 'in-process', data: data as T, warnings }
      }
      if (shape === 'verify') {
        const data = await handleAtribVerify(args as unknown as AtribVerifyInput)
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
