// @atrib/revise MCP server: cognitive primitive #3 of D079.
//
// Specialized form of @atrib/emit that narrows the schema to the revision
// event_type (spec §1.2.9 / D059). Per D079's package layering: depends on
// @atrib/emit as the canonical record-signing surface and wraps handleEmit
// with a narrow Zod schema enforcing the revision-specific required fields
// (revises + reason + prior_position + new_position). The signing + chain
// composition path is byte-identical to atrib-emit's; a verifier MUST NOT
// distinguish revision records signed via this tool from those signed via
// emit's polymorphic surface.
//
// Scope:
//   - One tool: atrib-revise
//   - Narrow input schema: REQUIRES revises (sha256:<64-hex>), reason, prior_position, new_position
//   - One key per process (same identity as the wrapper + atrib-emit)
//   - Persists to the same JSONL mirror convention as atrib-emit
//
// Distinct from atrib-annotate: annotation comments on a past record while
// leaving the prior position intact. Revision asserts the prior is no longer
// held — the prior remains in the graph (records are immutable per spec
// §1.6), and the revision adds a REVISES graph edge that supersedes it.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import {
  handleEmit,
  resolveKey,
  type ResolvedKey,
} from '@atrib/emit'
import {
  createSubmissionQueue,
  EVENT_TYPE_REVISION_URI,
  type SubmissionQueue,
} from '@atrib/mcp'

const SHA256_REF_PATTERN = /^sha256:[0-9a-f]{64}$/
const HEX_32_PATTERN = /^[0-9a-f]{32}$/

const ReviseInput = z.object({
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
    'Optional topic tags. Used by recall_my_attribution_history\'s topics filter. ' +
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
  key?: ResolvedKey
  /** Override the log endpoint (defaults to env or @atrib/mcp default). */
  logEndpoint?: string | undefined
}

/**
 * Wire up the atrib-revise MCP server with one `atrib-revise` tool.
 * Per D079: this is a specialized form of @atrib/emit; the underlying
 * signing pipeline is shared via handleEmit so revision records are
 * byte-identical regardless of which tool produced them.
 */
export async function createAtribReviseServer(
  options: CreateAtribReviseServerOptions = {},
): Promise<AtribReviseServer> {
  const key = options.key ?? (await resolveKey())
  const logEndpoint = options.logEndpoint ?? process.env['ATRIB_LOG_ENDPOINT']
  const queue: SubmissionQueue = createSubmissionQueue(logEndpoint)

  const mcp = new McpServer({ name: 'atrib-revise', version: '0.1.0' })

  mcp.registerTool(
    'atrib-revise',
    {
      description:
        'Supersede a prior position with a stated reason. Cognitive primitive #3 of ' +
        'D079; produces a signed revision event (spec §1.2.9 / D059) that adds a ' +
        'REVISES graph edge to the target record. Use when you now hold a position ' +
        'incompatible with a prior claim; the revision surfaces the change as a ' +
        'first-class graph node rather than a silent edit (records are immutable).',
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
        key,
        queue,
      })
      const out: ReviseOutput = {
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

  return {
    mcp,
    flush: () => queue.flush(),
  }
}
