// @atrib/annotate MCP server: cognitive primitive #2 of D079.
//
// Specialized form of @atrib/emit that narrows the schema to the annotation
// event_type (spec §1.2.7 / D058). Per D079's package layering: depends on
// @atrib/emit as the canonical record-signing surface and wraps handleEmit
// with a narrow Zod schema enforcing the annotation-specific required fields
// (annotates + importance + summary). The signing + chain composition path
// is byte-identical to atrib-emit's; a verifier MUST NOT distinguish
// annotation records signed via this tool from those signed via emit's
// polymorphic surface.
//
// Scope:
//   - One tool: atrib-annotate
//   - Narrow input schema: REQUIRES annotates (sha256:<64-hex>), importance, summary
//   - One key per process (same identity as the wrapper + atrib-emit)
//   - Persists to the same JSONL mirror convention as atrib-emit

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import {
  handleEmit,
  resolveKey,
  type ResolvedKey,
} from '@atrib/emit'
import {
  createSubmissionQueue,
  EVENT_TYPE_ANNOTATION_URI,
  type SubmissionQueue,
} from '@atrib/mcp'

const SHA256_REF_PATTERN = /^sha256:[0-9a-f]{64}$/
const HEX_32_PATTERN = /^[0-9a-f]{32}$/

const Importance = z.enum(['critical', 'high', 'medium', 'low', 'noise'])

const AnnotateInput = z.object({
  annotates: z.string().regex(SHA256_REF_PATTERN).describe(
    "'sha256:<64-hex>' record_hash this annotation describes per spec §1.2.7 / D058. " +
      'REQUIRED. The target record can be any prior record (yours or another agent\'s).',
  ),
  importance: Importance.describe(
    'Felt importance for future-self recall ranking. ' +
      "'critical' (load-bearing decisions, identity claims), " +
      "'high' (worth surfacing in default recall), " +
      "'medium' (general signal), " +
      "'low' (background noting), " +
      "'noise' (deliberately deprioritized for recall).",
  ),
  summary: z.string().min(1).max(2048).describe(
    'One-line semantic gist of the annotation. The recall pipeline reads this verbatim ' +
      'for snippet display; keep it under ~120 chars when possible. ' +
      'Distinct from the annotated record\'s own content, this summary captures what ' +
      'future-you should know about why this record matters.',
  ),
  topics: z.array(z.string().min(1).max(128)).max(16).optional().describe(
    'Optional topic tags. Used by recall_my_attribution_history\'s topics filter. ' +
      'Lowercase-hyphenated convention (e.g. "bug-fix", "design-decision").',
  ),
  context_id: z.string().regex(HEX_32_PATTERN).optional().describe(
    '32-hex context_id. Defaults to process.env.ATRIB_CONTEXT_ID per D078 when omitted; ' +
      'falls back to a fresh genesis context_id if neither is set.',
  ),
  informed_by: z.array(z.string().regex(SHA256_REF_PATTERN)).optional().describe(
    "Array of 'sha256:<64-hex>' record_hashes that informed this annotation. " +
      'Sorted lexicographically before signing per §1.2.5. The `annotates` reference ' +
      'is separate from `informed_by` and need not be duplicated here.',
  ),
})

type AnnotateInputT = z.infer<typeof AnnotateInput>

type AnnotateOutput = {
  record_hash: string
  log_index: number | null
  inclusion_proof: unknown
  context_id: string
  warnings: string[]
}

export interface AtribAnnotateServer {
  /** Underlying McpServer; expose for testing or composition. */
  mcp: McpServer
  /** Drain pending submissions (for tests/shutdown). */
  flush(): Promise<void>
}

export interface CreateAtribAnnotateServerOptions {
  /** Override the resolved key (primarily for testing). */
  key?: ResolvedKey
  /** Override the log endpoint (defaults to env or @atrib/mcp default). */
  logEndpoint?: string | undefined
}

/**
 * Wire up the atrib-annotate MCP server with one `atrib-annotate` tool.
 * Per D079: this is a specialized form of @atrib/emit; the underlying
 * signing pipeline is shared via handleEmit so annotation records are
 * byte-identical regardless of which tool produced them.
 */
export async function createAtribAnnotateServer(
  options: CreateAtribAnnotateServerOptions = {},
): Promise<AtribAnnotateServer> {
  const key = options.key ?? (await resolveKey())
  const logEndpoint = options.logEndpoint ?? process.env['ATRIB_LOG_ENDPOINT']
  const queue: SubmissionQueue = createSubmissionQueue(logEndpoint)

  const mcp = new McpServer({ name: 'atrib-annotate', version: '0.1.0' })

  mcp.registerTool(
    'atrib-annotate',
    {
      description:
        'Mark a past record\'s importance and meaning without superseding it. ' +
        'Cognitive primitive #2 of D079; produces a signed annotation event ' +
        '(spec §1.2.7 / D058) that adds an ANNOTATES graph edge to the target. ' +
        'Use when you want future-self or other agents to read back this past ' +
        'record with weighted importance and a one-line gist.',
      inputSchema: AnnotateInput.shape,
    },
    async (rawInput) => {
      const input = AnnotateInput.parse(rawInput) as AnnotateInputT
      const result = await handleEmit({
        input: {
          event_type: EVENT_TYPE_ANNOTATION_URI,
          content: {
            annotates: input.annotates,
            importance: input.importance,
            summary: input.summary,
            ...(input.topics ? { topics: input.topics } : {}),
          },
          annotates: input.annotates,
          ...(input.context_id ? { context_id: input.context_id } : {}),
          ...(input.informed_by ? { informed_by: input.informed_by } : {}),
        },
        key,
        queue,
      })
      const out: AnnotateOutput = {
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
