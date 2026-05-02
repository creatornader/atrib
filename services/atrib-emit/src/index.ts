// atrib-emit MCP server: registers the explicit `emit` tool that lets an
// agent sign arbitrary cognitive events (observations, annotations,
// revisions) under its own identity. Reuses @atrib/mcp's signing and
// submission primitives so emit-signed records are byte-identical to
// wrapper-signed ones.
//
// Scope:
//   - One tool: emit
//   - One key per process (the agent's wrapper key)
//   - Reuses @atrib/mcp signing + submission queue
//   - Persists to the same JSONL convention as the wrapper

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { randomBytes } from 'node:crypto'
import {
  canonicalRecord,
  createSubmissionQueue,
  genesisChainRoot,
  hexEncode,
  isValidEventTypeUri,
  sha256,
  type AtribRecord,
  type ProofBundle,
  type SubmissionQueue,
} from '@atrib/mcp'
import { resolveChainContext } from './auto-chain.js'
import { resolveKey, type ResolvedKey } from './keys.js'
import { buildAndSignEmitRecord } from './sign.js'
import { mirrorRecord } from './storage.js'

const SHA256_REF_PATTERN = /^sha256:[0-9a-f]{64}$/
const HEX_32_PATTERN = /^[0-9a-f]{32}$/

const EmitInput = z.object({
  event_type: z.string().min(1).max(256).describe(
    "Event type URI per spec §1.2.4. Common normative values: " +
    "'https://atrib.dev/v1/types/observation', '...annotation', '...revision'. " +
    'Extension URIs in any namespace OK.',
  ),
  content: z.record(z.unknown()).describe(
    'Semantic content of the cognitive event. Shape varies per event_type. ' +
    "For observation: { what: string, why_noted?: string, topics?: string[] }. " +
    "For annotation: { annotates: 'sha256:...', importance: 'critical'|'high'|'medium'|'low'|'noise', summary: string, topics?: string[] }. " +
    "For revision: { revises: 'sha256:...', prior_position: string, new_position: string, reason: string }.",
  ),
  context_id: z.string().regex(HEX_32_PATTERN).optional().describe(
    '32-hex context_id. If omitted, a fresh genesis context_id is generated and the record is treated as a new chain.',
  ),
  informed_by: z.array(z.string().regex(SHA256_REF_PATTERN)).optional().describe(
    "Array of 'sha256:<64-hex>' record_hashes that informed this event. " +
    'Sorted lexicographically before signing per §1.2.5.',
  ),
})

type EmitOutput = {
  record_hash: string
  log_index: number | null
  inclusion_proof: ProofBundle['inclusion_proof'] | null
  context_id: string
  warnings: string[]
}

export interface AtribEmitServer {
  /** Underlying McpServer; expose for testing or composition. */
  mcp: McpServer
  /** Drain pending submissions (for tests/shutdown). */
  flush(): Promise<void>
}

export interface CreateAtribEmitServerOptions {
  /** Override the resolved key (primarily for testing). */
  key?: ResolvedKey
  /** Override the log endpoint (defaults to env or @atrib/mcp default). */
  logEndpoint?: string | undefined
}

/**
 * Wire up the atrib-emit MCP server with one `emit` tool.
 * Returns an AtribEmitServer handle whose `.mcp` is ready to attach to a
 * transport (StdioServerTransport for the standalone binary; in-process
 * transport for tests).
 */
export async function createAtribEmitServer(
  options: CreateAtribEmitServerOptions = {},
): Promise<AtribEmitServer> {
  const key = options.key ?? (await resolveKey())
  const logEndpoint = options.logEndpoint ?? process.env['ATRIB_LOG_ENDPOINT']
  const queue: SubmissionQueue = createSubmissionQueue(logEndpoint)

  const mcp = new McpServer({ name: 'atrib-emit', version: '0.1.0' })

  mcp.tool(
    'emit',
    'Sign and submit an explicit cognitive event (observation, annotation, revision, etc.) under your atrib identity. Emits a record that chains with your wrapper-signed tool calls when context_id is shared.',
    EmitInput.shape,
    async (rawInput) => {
      const input = EmitInput.parse(rawInput)
      const result = await handleEmit({ input, key, queue })
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      }
    },
  )

  return {
    mcp,
    flush: () => queue.flush(),
  }
}

interface HandleEmitInput {
  input: z.infer<typeof EmitInput>
  key: ResolvedKey | null
  queue: SubmissionQueue
}

/**
 * Build, sign, submit, mirror. Returns the EmitOutput shape promised in the
 * scope doc. Per §5.8 degradation: never throws to the agent; surfaces all
 * partial-failure conditions in `warnings`.
 */
async function handleEmit({ input, key, queue }: HandleEmitInput): Promise<EmitOutput> {
  const warnings: string[] = []

  if (!isValidEventTypeUri(input.event_type)) {
    return emptyOutput(input.context_id ?? randomContextId(), [
      `event_type is not a valid absolute URI per §1.4.5: ${input.event_type}`,
    ])
  }

  if (!key) {
    return emptyOutput(input.context_id ?? randomContextId(), [
      'no signing key resolved (set ATRIB_PRIVATE_KEY, ATRIB_KEY_FILE, or store seed in macOS Keychain as service "atrib-creator")',
    ])
  }

  // autoChain inheritance: when the caller omits context_id, read the
  // wrapper's local mirror and inherit its most-recent record's context_id
  // (chaining on top of that record's hash). Falls back to a fresh genesis
  // when no mirror is present. The inheritance source is surfaced to the
  // caller in the warnings array so the agent knows which session this
  // emit landed in.
  const chain = await resolveChainContext({
    callerContextId: input.context_id,
    genesisChainRoot,
    randomContextId,
  })
  const contextId = chain.contextId
  const chainRoot = chain.chainRoot
  if (chain.inheritedFrom === 'wrapper-mirror') {
    warnings.push(`inherited context_id from wrapper mirror: ${contextId}`)
  }

  let record
  try {
    record = await buildAndSignEmitRecord({
      privateKey: key.privateKey,
      eventType: input.event_type,
      contextId,
      chainRoot,
      content: input.content,
      informedBy: input.informed_by,
    })
  } catch (e) {
    return emptyOutput(contextId, [
      `signing failed: ${e instanceof Error ? e.message : String(e)}`,
    ])
  }

  const recordHash = record.signature ? hashRecord(record) : null

  // Submit asynchronously; the queue handles retry + degradation per §5.8.
  // Cognitive events default to normal priority, annotations/observations
  // never need to block the agent.
  queue.submit(record, 'normal')

  // Best-effort mirror; mirrorRecord internally swallows errors per §5.8.
  await mirrorRecord(record, queue.getProof(recordHash ?? '') ?? null)

  // Try to read a proof if the queue submitted synchronously and the log
  // returned one within the same tick. Most submissions return null here
  // and the proof shows up on a later poll via getProof.
  const proof = recordHash ? queue.getProof(recordHash) ?? null : null

  if (!proof) {
    warnings.push('submission queued; proof not yet available (poll the log later if needed)')
  }

  return {
    record_hash: recordHash ?? 'sha256:unknown',
    log_index: proof?.log_index ?? null,
    inclusion_proof: proof?.inclusion_proof ?? null,
    context_id: contextId,
    warnings,
  }
}

function emptyOutput(contextId: string, warnings: string[]): EmitOutput {
  return {
    record_hash: 'sha256:unknown',
    log_index: null,
    inclusion_proof: null,
    context_id: contextId,
    warnings,
  }
}

function randomContextId(): string {
  // 16 random bytes → 32 hex chars; matches the spec's context_id format.
  return randomBytes(16).toString('hex')
}

function hashRecord(record: AtribRecord): string {
  return `sha256:${hexEncode(sha256(canonicalRecord(record)))}`
}
