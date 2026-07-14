// SPDX-License-Identifier: Apache-2.0

// The legacy `atrib-revise` tool: cognitive primitive #3 of D079, kept as a
// permanent alias over the attest write funnel. Narrows the schema to the
// revision event_type (spec §1.2.9 / D059) with the revision-specific
// required fields (revises + prior_position + new_position + reason). The
// signing + chain composition path is byte-identical to `attest` with
// ref.kind='revises'; a verifier MUST NOT distinguish revision records by
// the tool name that signed them.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { createSubmissionQueue, EVENT_TYPE_REVISION_URI, type SubmissionQueue } from '@atrib/mcp'
import {
  handleEmit,
  registerAttestTool,
  resolveEmitLocalSubstrateShadowFromEnv,
  type EmitLocalSubstrateShadowOptions,
  type WriteToolDeps,
} from './index.js'
import { resolveKey, type ResolvedKey } from './keys.js'

const SHA256_REF_PATTERN = /^sha256:[0-9a-f]{64}$/
const HEX_32_PATTERN = /^[0-9a-f]{32}$/

export const ReviseInput = z.object({
  revises: z.string().regex(SHA256_REF_PATTERN).describe(
    "'sha256:<64-hex>' record_hash this revision supersedes per spec §1.2.9 / D059. " +
      'REQUIRED. The target record can be any prior record (yours or another agent\'s).',
  ),
  prior_position: z.string().min(1).max(4096).describe(
    'One-line summary of the position being superseded. Captures what was previously held ' +
      'so a reader sees the contradiction surfaced as a first-class graph node rather than ' +
      'a silent edit.',
  ),
  new_position: z.string().min(1).max(4096).describe(
    'One-line summary of the new position replacing the prior. The substantive claim that ' +
      'supersedes the revised record.',
  ),
  reason: z.string().min(1).max(4096).describe(
    'Why the revision happened. New evidence, contradicting record, model update, ' +
      'corrected reasoning, etc. Recall pipelines surface this verbatim so future-self ' +
      'sees what motivated the change.',
  ),
  topics: z.array(z.string().min(1).max(128)).max(16).optional().describe(
    'Optional topic tags. Used by recall\'s topics filter. ' +
      'Lowercase-hyphenated convention (e.g. "contradiction", "model-update").',
  ),
  context_id: z.string().regex(HEX_32_PATTERN).optional().describe(
    '32-hex context_id. Defaults to process.env.ATRIB_CONTEXT_ID per D078 when omitted; ' +
      'falls back to a fresh genesis context_id if neither is set.',
  ),
  informed_by: z.array(z.string().regex(SHA256_REF_PATTERN)).optional().describe(
    "Array of 'sha256:<64-hex>' record_hashes that informed this revision. " +
      'Sorted lexicographically before signing per §1.2.5. The `revises` reference ' +
      'is separate from `informed_by` and need not be duplicated here.',
  ),
})

type ReviseInputT = z.infer<typeof ReviseInput>

type ReviseOutput = {
  signed: true
  record_hash: string
  log_index: number | null
  inclusion_proof: unknown
  context_id: string
  warnings: string[]
}

export interface AtribReviseServer {
  /** Underlying McpServer; expose for testing or composition. */
  mcp: McpServer
  /** Drain pending submissions (for tests/shutdown). */
  flush(): Promise<void>
}

export interface CreateAtribReviseServerOptions {
  /** Override the resolved key (primarily for testing). */
  key?: ResolvedKey | null | undefined
  /** Override the log endpoint (defaults to env or @atrib/mcp default). */
  logEndpoint?: string | undefined
  /**
   * Optional long-lived-agent local substrate shadow probe. `undefined` reads
   * opt-in env config; `false` disables env config for this server.
   */
  localSubstrate?: EmitLocalSubstrateShadowOptions | false | undefined
}

/**
 * Register the legacy `atrib-revise` tool. The handler call shape is
 * unchanged from the standalone @atrib/revise server, so historical
 * behavior is preserved exactly; only the mounting surface moved.
 */
export function registerReviseTool(mcp: McpServer, deps: WriteToolDeps): void {
  const localSubstrate =
    deps.options.localSubstrate === false
      ? undefined
      : (deps.options.localSubstrate ??
        resolveEmitLocalSubstrateShadowFromEnv({
          producer: 'atrib-revise',
          transport: 'stdio-mcp-server',
        }))

  mcp.registerTool(
    'atrib-revise',
    {
      description:
        'Supersede a prior position with a stated reason. Produces a signed ' +
        'revision event (spec §1.2.9 / D059) that adds a REVISES graph edge to ' +
        'the target record. Use when you now hold a position incompatible with a ' +
        'prior claim; the revision surfaces the change as a first-class graph node ' +
        'rather than a silent edit (records are immutable). Legacy alias: new ' +
        'callers should prefer `attest` with ref.kind="revises"; records are ' +
        'byte-identical either way.',
      inputSchema: ReviseInput.shape,
    },
    async (rawInput) => {
      const input = ReviseInput.parse(rawInput) as ReviseInputT
      const result = await handleEmit({
        input: {
          event_type: EVENT_TYPE_REVISION_URI,
          content: {
            revises: input.revises,
            prior_position: input.prior_position,
            new_position: input.new_position,
            reason: input.reason,
            ...(input.topics ? { topics: input.topics } : {}),
          },
          revises: input.revises,
          ...(input.context_id ? { context_id: input.context_id } : {}),
          ...(input.informed_by ? { informed_by: input.informed_by } : {}),
        },
        key: await deps.resolveServerKey(),
        queue: deps.queue,
        producer: 'atrib-revise',
        ...(localSubstrate ? { localSubstrate } : {}),
      })
      if (!result.signed) {
        return {
          isError: true,
          content: [{ type: 'text', text: result.refusals.join('\n') }],
        }
      }
      const out: ReviseOutput = {
        signed: true,
        record_hash: result.record_hash,
        log_index: result.log_index,
        inclusion_proof: result.inclusion_proof,
        context_id: result.context_id,
        warnings: result.warnings,
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(out, null, 2) }],
      }
    },
  )
}

/**
 * Wire up the legacy atrib-revise MCP server. Mounts `atrib-revise` plus
 * `attest` (alias-window rule W1). The underlying signing pipeline is
 * shared via handleEmit so revision records are byte-identical regardless
 * of which tool produced them.
 */
export async function createAtribReviseServer(
  options: CreateAtribReviseServerOptions = {},
): Promise<AtribReviseServer> {
  const deps = buildReviseWriteToolDeps(options)
  const mcp = new McpServer({ name: 'atrib-revise', version: '0.1.0' })
  registerReviseTool(mcp, deps)
  registerAttestTool(mcp, deps)
  return {
    mcp,
    flush: () => deps.queue.flush(),
  }
}

function buildReviseWriteToolDeps(options: CreateAtribReviseServerOptions): WriteToolDeps {
  const logEndpoint = options.logEndpoint ?? process.env['ATRIB_LOG_ENDPOINT']
  const queue: SubmissionQueue = createSubmissionQueue(logEndpoint)
  return {
    resolveServerKey: createServerKeyResolver(options),
    queue,
    logEndpoint,
    options,
  }
}

function createServerKeyResolver(
  options: CreateAtribReviseServerOptions,
): () => Promise<ResolvedKey | null> {
  if (Object.prototype.hasOwnProperty.call(options, 'key')) {
    const fixed = options.key ?? null
    return async () => fixed
  }
  let resolved: Promise<ResolvedKey | null> | null = null
  return async () => {
    resolved ??= resolveKey()
    return resolved
  }
}
