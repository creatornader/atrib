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
  EVENT_TYPE_ANNOTATION_URI,
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
// 16 bytes encoded as base64url with no padding = 22 chars per spec §1.2.6.
const PROVENANCE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/

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
  chain_root: z.string().regex(SHA256_REF_PATTERN).optional().describe(
    "Caller-managed chain_root, the 'sha256:<64-hex>' hash of the immediately " +
    'preceding record in this context_id. When supplied alongside context_id, ' +
    'atrib-emit uses both verbatim instead of treating context_id as a fresh ' +
    'genesis. Required when caller manages chain state across multiple emits ' +
    "under one context_id (e.g. multi-record watcher pipelines). When omitted " +
    'with context_id present, atrib-emit synthesizes the genesis chain_root ' +
    'per spec §1.2.3. Without context_id, this field is meaningless and ' +
    'returns a warnings-only response.',
  ),
  provenance_token: z.string().regex(PROVENANCE_TOKEN_PATTERN).optional().describe(
    '22-char base64url cross-session causal anchor per spec §1.2.6 / D044. ' +
    'Genesis-record-only: atrib-emit refuses to sign a record that carries ' +
    'this field if its chain_root is not the genesis chain_root for the ' +
    'context_id (per §5.8 graceful-degradation, this returns a warnings-only ' +
    'response rather than a malformed record).',
  ),
  annotates: z.string().regex(SHA256_REF_PATTERN).optional().describe(
    "'sha256:<64-hex>' record_hash this annotation describes per spec §1.2.7 / D058. " +
    'REQUIRED when event_type is the annotation URI; FORBIDDEN on any other event_type. ' +
    'atrib-emit enforces the require/forbid invariant per §1.2.7 (validators MUST reject ' +
    'violations) and returns a warnings-only response rather than signing a malformed record.',
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

  mcp.registerTool(
    'emit',
    {
      description:
        'Sign and submit an explicit cognitive event (observation, annotation, revision, etc.) under your atrib identity. Emits a record that chains with your wrapper-signed tool calls when context_id is shared.',
      inputSchema: EmitInput.shape,
    },
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

  // chain_root without context_id is malformed: chain_root is meaningless
  // outside the context it chains within. Surface a warning instead of
  // synthesizing one of the two halves.
  if (input.chain_root && !input.context_id) {
    return emptyOutput(input.context_id ?? randomContextId(), [
      'chain_root requires context_id (chain_root has no meaning without a context to chain within)',
    ])
  }

  // provenance_token is genesis-record-only per spec §1.2.6. If the caller
  // also supplied chain_root, that chain_root must equal the genesis
  // chain_root for the context_id. Middleware refuses to sign malformed
  // records per §5.8 rather than emit something the validator + verifier
  // would reject.
  if (input.provenance_token && input.chain_root && input.context_id) {
    const genesisRoot = genesisChainRoot(input.context_id)
    if (input.chain_root !== genesisRoot) {
      return emptyOutput(input.context_id, [
        'provenance_token is genesis-record-only per §1.2.6; ' +
          'chain_root must equal genesisChainRoot(context_id) when provenance_token is supplied',
      ])
    }
  }

  // annotates require/forbid invariant per spec §1.2.7 / D058. Validators MUST
  // reject violations; we surface as warnings-only per §5.8 so callers see why
  // we refused to sign rather than getting back a malformed record. Use the
  // @atrib/mcp normative constant so the URI string lives in one place.
  if (input.event_type === EVENT_TYPE_ANNOTATION_URI && !input.annotates) {
    return emptyOutput(input.context_id ?? randomContextId(), [
      'annotation event_type requires annotates per §1.2.7 (D058); ' +
        'omitted records would fail validator admission',
    ])
  }
  if (input.annotates && input.event_type !== EVENT_TYPE_ANNOTATION_URI) {
    return emptyOutput(input.context_id ?? randomContextId(), [
      'annotates is FORBIDDEN on non-annotation event_types per §1.2.7 (D058); ' +
        `received event_type=${input.event_type}`,
    ])
  }

  // autoChain inheritance: when the caller omits context_id, read the
  // wrapper's local mirror and inherit its most-recent record's context_id
  // (chaining on top of that record's hash). Falls back to a fresh genesis
  // when no mirror is present. The inheritance source is surfaced to the
  // caller in the warnings array so the agent knows which session this
  // emit landed in. When the caller supplies BOTH context_id and chain_root,
  // resolveChainContext uses them verbatim — the path needed by consumers
  // that thread chain state themselves.
  const chain = await resolveChainContext({
    callerContextId: input.context_id,
    callerChainRoot: input.chain_root,
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
      provenanceToken: input.provenance_token,
      annotates: input.annotates,
    })
  } catch (e) {
    return emptyOutput(contextId, [
      `signing failed: ${e instanceof Error ? e.message : String(e)}`,
    ])
  }

  const recordHash = record.signature ? hashRecord(record) : null

  // Submit asynchronously; the queue handles retry + degradation per §5.8.
  // Cognitive events default to normal priority — annotations/observations
  // never need to block the agent.
  queue.submit(record, 'normal')

  // Best-effort mirror; mirrorRecord internally swallows errors per §5.8.
  // Persist the pre-sign `content` payload as a `_local` sidecar so
  // consumers (recall, trace, summarize) can surface semantic context
  // alongside the cryptographic evidence. The sidecar lives at the
  // envelope level — the signed record bytes are unchanged.
  await mirrorRecord(record, queue.getProof(recordHash ?? '') ?? null, {
    content: input.content,
    producer: 'atrib-emit',
  })

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

// Test-only export of handleEmit. Mirrors the `__test_only__` pattern
// used in sign.ts; lets unit tests assert on the validation paths
// without going through the McpServer transport surface.
export const __test_only__ = { handleEmit }
