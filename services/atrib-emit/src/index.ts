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
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  EVENT_TYPE_ANNOTATION_URI,
  EVENT_TYPE_REVISION_URI,
  canonicalRecord,
  createSubmissionQueue,
  genesisChainRoot,
  hexEncode,
  inheritChainContext,
  isValidEventTypeUri,
  parentRecordHashFromEnv,
  resolveEnvContextId,
  SHA256_REF_PATTERN,
  sha256,
  type AtribRecord,
  type ProofBundle,
  type SubmissionQueue,
} from '@atrib/mcp'
import { resolveKey, type ResolvedKey } from './keys.js'
import { buildAndSignEmitRecord } from './sign.js'
import { mirrorRecord } from './storage.js'

// Read-side mirror inheritance: ATRIB_AUTOCHAIN_SOURCE points at the file
// atrib-emit reads to inherit cross-producer chain state (typically the
// wrapper's mirror). Falls back to ATRIB_MIRROR_FILE (where emit writes,
// rarely useful as a read source, but kept for backward compatibility),
// then to the per-agent default. Distinct from ATRIB_MIRROR_FILE which is
// where emit's own records are persisted.
function readMirrorPath(): string {
  return (
    process.env['ATRIB_AUTOCHAIN_SOURCE'] ??
    process.env['ATRIB_MIRROR_FILE'] ??
    join(homedir(), '.atrib', 'records', `${process.env['ATRIB_AGENT'] ?? 'claude-code'}.jsonl`)
  )
}

const HEX_32_PATTERN = /^[0-9a-f]{32}$/
// 16 bytes encoded as base64url with no padding = 22 chars per spec §1.2.6.
const PROVENANCE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/

const EmitInput = z.object({
  event_type: z.string().min(1).max(256).describe(
    "Event type URI per spec §1.2.4. Common normative values: " +
    "'https://atrib.dev/v1/types/observation', '...annotation', '...revision'. " +
    'Extension URIs in any namespace OK.',
  ),
  content: z.record(z.string(), z.unknown()).describe(
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
  revises: z.string().regex(SHA256_REF_PATTERN).optional().describe(
    "'sha256:<64-hex>' record_hash this revision supersedes per spec §1.2.9 / D059. " +
    'REQUIRED when event_type is the revision URI; FORBIDDEN on any other event_type. ' +
    'atrib-emit enforces the require/forbid invariant per §1.2.9 (validators MUST reject ' +
    'violations) and returns a warnings-only response rather than signing a malformed record.',
  ),
  tool_name: z.string().min(1).max(64).optional().describe(
    'Optional §8.2 tool_name disclosure. Verbatim or transformed name (verbatim, opaque, ' +
    'or hashed per §8.2). Lets emit-signed records carry the tool name for downstream ' +
    'consumers (e.g. recall_my_attribution_history filtering by tool_name). Absence ' +
    'indicates the §8.1 default posture (no disclosure).',
  ),
  args_hash: z.string().regex(SHA256_REF_PATTERN).optional().describe(
    'Optional §8.3 args_hash commitment. Format: "sha256:" + 64 lowercase hex. Lets ' +
    'emit-signed records carry a commitment to canonical args bytes for downstream ' +
    'consumers (e.g. recall filtering by args_hash, or replay detection). Salted vs ' +
    'plain forms hash identically on the wire; the salt (when used) is carried in the ' +
    'separate args_salt field, which this surface does not yet expose.',
  ),
  result_hash: z.string().regex(SHA256_REF_PATTERN).optional().describe(
    'Optional §8.3 result_hash commitment. Format: "sha256:" + 64 lowercase hex. Lets ' +
    'emit-signed records carry a commitment to canonical result bytes for downstream ' +
    'consumers. Salted vs plain forms hash identically on the wire; the salt (when used) ' +
    'is carried in the separate result_salt field, which this surface does not yet expose.',
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
  /**
   * Producer label written to the sidecar's `_local.producer` field for
   * cross-source disambiguation in mirror queries. Defaults to
   * `'atrib-emit'` for the bare server path; specialized wrappers
   * (`@atrib/annotate`, `@atrib/revise`) pass their own identity so
   * downstream consumers can tell which surface signed each record.
   */
  producer?: string
}

/**
 * Build, sign, submit, mirror. Returns the EmitOutput shape promised in the
 * scope doc. Per §5.8 degradation: never throws to the agent; surfaces all
 * partial-failure conditions in `warnings`.
 */
async function handleEmit({ input, key, queue, producer }: HandleEmitInput): Promise<EmitOutput> {
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

  // revises require/forbid invariant per spec §1.2.9 / D059. Same shape as
  // the annotates invariant above. Validators MUST reject violations; we
  // surface as warnings-only per §5.8 so callers see why we refused to sign
  // rather than getting back a malformed record.
  if (input.event_type === EVENT_TYPE_REVISION_URI && !input.revises) {
    return emptyOutput(input.context_id ?? randomContextId(), [
      'revision event_type requires revises per §1.2.9 (D059); ' +
        'omitted records would fail validator admission',
    ])
  }
  if (input.revises && input.event_type !== EVENT_TYPE_REVISION_URI) {
    return emptyOutput(input.context_id ?? randomContextId(), [
      'revises is FORBIDDEN on non-revision event_types per §1.2.9 (D059); ' +
        `received event_type=${input.event_type}`,
    ])
  }

  // Env-var context_id default: when the caller omitted context_id, fall back
  // to @atrib/mcp's resolveEnvContextId, which applies the D078 + D083
  // precedence: ATRIB_CONTEXT_ID first (explicit operator/harness intent),
  // then a registered harness env var (e.g. CLAUDE_CODE_SESSION_ID). Both
  // produce a validated 32-hex string or undefined; invalid values silently
  // fall through to the existing inheritChainContext logic. Explicit
  // input.context_id still wins per "explicit beats implicit."
  const callerContextId = input.context_id ?? resolveEnvContextId()

  // Multi-producer chain composition per spec §1.2.3 / D067. Single source
  // of truth in @atrib/mcp's inheritChainContext: caller-supplied verbatim
  // when both fields supplied, else cascade through env-tail (cross-producer
  // handoff) and mirror-file inheritance (filtered to the same context_id),
  // falling back to genesis. When caller omits context_id entirely, the
  // helper inherits BOTH context_id and chain_root from the mirror's most
  // recent record. The cognitive-extractor hook spawning atrib-emit with
  // ATRIB_CHAIN_TAIL_<context_id> + the agent's context_id is the primary
  // case that needs preserving; pre-fix this produced isolated genesis records
  // because atrib-emit's local resolver short-circuited on caller context.
  const chain = await inheritChainContext({
    callerContextId,
    callerChainRoot: input.chain_root,
    mirrorPath: readMirrorPath(),
    randomContextId,
  })
  const contextId = chain.contextId
  const chainRoot = chain.chainRoot
  if (chain.inheritedFrom === 'fresh-orphan') {
    // Per D072: caller passed no context_id, so the producer synthesized
    // a fresh isolate rather than inheriting from the mirror tail. Surface
    // this as a warning so operators can trace the runtime miswire that
    // caused it (typically a Layer-2 hook that didn't thread session_id).
    warnings.push(
      `synthesized orphan context_id ${contextId} (caller passed no context_id; fix runtime to thread session_id per D072)`,
    )
  }

  // ATRIB_PARENT_RECORD_HASH env-var seeding (D104, producer-side
  // parent-child causality threading). When a parent producer spawns a child
  // producer (multi-process subagent, cross-process delegate, framework worker
  // node, etc.) and writes its parent's record_hash into this env, each emit
  // call auto-prepends it to informed_by. Uses the existing §1.2.5
  // primitive, no spec change. Only valid sha256:<64-hex> values are honored;
  // anything else is silently ignored. Caller-passed informed_by entries take
  // precedence in ordering (env-seed prepends, dedupe preserves first occurrence);
  // sign.ts then sorts lexicographically per §1.2.5 before the canonical-bytes
  // hash so the wire-level shape is order-independent. Limitations: single-
  // process hosts where parent and child share env (e.g., Claude Code's Task
  // tool) cannot use this convention naively because the parent's PostToolUse
  // signature fires after the child has already emitted; those cases need
  // retroactive annotation or a future explicit handoff event. See D104.
  const validParentHash = parentRecordHashFromEnv()
  const effectiveInformedBy = validParentHash
    ? Array.from(
        new Set([validParentHash, ...(input.informed_by ?? [])]),
      )
    : input.informed_by

  let record
  try {
    record = await buildAndSignEmitRecord({
      privateKey: key.privateKey,
      eventType: input.event_type,
      contextId,
      chainRoot,
      content: input.content,
      informedBy: effectiveInformedBy,
      provenanceToken: input.provenance_token,
      annotates: input.annotates,
      revises: input.revises,
      toolName: input.tool_name,
      argsHash: input.args_hash,
      resultHash: input.result_hash,
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
  // Persist the pre-sign `content` payload as a `_local` sidecar so
  // consumers (recall, trace, summarize) can surface semantic context
  // alongside the cryptographic evidence. The sidecar lives at the
  // envelope level, the signed record bytes are unchanged.
  await mirrorRecord(record, recordHash ? getProofFor(queue, recordHash) ?? null : null, {
    content: input.content,
    producer: producer ?? 'atrib-emit',
  })

  // Try to read a proof if the queue submitted synchronously and the log
  // returned one within the same tick. Most submissions return null here
  // and the proof shows up on a later poll via getProof.
  const proof = recordHash ? getProofFor(queue, recordHash) ?? null : null

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

/**
 * `@atrib/mcp`'s submission queue caches proofs by *bare hex*, while
 * everywhere else in atrib uses the spec §1.4.2 `sha256:<64-hex>` form.
 * Strip the prefix when querying the cache. Without this bridge, every
 * proof lookup returned undefined: handleEmit and emitInProcess both
 * always reported `log_index: null` and a misleading "submission queued"
 * warning, even when the record had already landed on the log.
 */
function getProofFor(queue: SubmissionQueue, recordHash: string): ProofBundle | undefined {
  return queue.getProof(
    recordHash.startsWith('sha256:') ? recordHash.slice('sha256:'.length) : recordHash,
  )
}

export interface EmitInProcessOptions {
  /** Override the resolved key (primarily for testing). */
  key?: ResolvedKey
  /** Override the log endpoint (defaults to ATRIB_LOG_ENDPOINT or @atrib/mcp default). */
  logEndpoint?: string | undefined
  /**
   * Producer label written to the sidecar's `_local.producer` field for
   * cross-source disambiguation. Defaults to `'atrib-emit'`. Callers that
   * represent a distinct surface should pass their own identifier (e.g.
   * `'atrib-emit-cli'` for the CLI binary, `'atrib-annotate'` /
   * `'atrib-revise'` for specialized cognitive primitives) so mirror
   * consumers can bucket records by emitter without inspecting envelopes.
   */
  producer?: string
  /**
   * Upper bound on the post-sign queue flush, in milliseconds. Default
   * 5000ms. The submission queue itself has a 30s retry budget against an
   * unreachable log (`MAX_WINDOW_MS` in `@atrib/mcp`); without this
   * deadline, a network blip leaves a detached hook process blocked for
   * up to 30s waiting on retries it cannot do anything about. Past the
   * deadline emitInProcess returns the record with a `flush-deadline`
   * warning attached: the record is signed, mirrored, and queued in
   * memory for retry, but `log.atrib.dev` confirmation is not yet
   * established. The hook's own mirror file holds the record either way.
   * Set to a higher value for callers that can afford to wait (an
   * interactive CLI, a service with its own backpressure).
   */
  flushDeadlineMs?: number
}

const DEFAULT_FLUSH_DEADLINE_MS = 5000

/**
 * Emit one cognitive event in-process, without an MCP transport.
 *
 * This is the canonical in-process entrypoint for callers that already
 * run inside a short-lived Node process (lifecycle/PostToolUse hooks,
 * watchers, batch jobs) and should NOT pay the cost of spawning the
 * atrib-emit binary and running an MCP stdio handshake just to sign one
 * record. It packages the recipe the D079 public-helpers block below
 * documents — resolve key, build a submission queue, call handleEmit —
 * and additionally flushes the queue before returning, because a hook
 * process exits immediately afterward and a still-pending submission
 * would be lost with it.
 *
 * Records are byte-identical to MCP-server-signed and wrapper-signed
 * records: this routes through the same handleEmit path createAtribEmitServer
 * uses. Per §5.8 it never throws for operational failures — a missing key
 * or a queued-but-unconfirmed submission surfaces in EmitOutput.warnings.
 * It DOES throw on a malformed input (EmitInput.parse), same as the MCP
 * tool handler; callers catch and degrade.
 *
 * The flush is bounded by `flushDeadlineMs` (default 5s). If the log is
 * unreachable, the submission queue's internal retry will overrun the
 * deadline; emitInProcess then returns the record with a `flush-deadline`
 * warning rather than blocking up to 30s. The record is still signed and
 * mirrored locally; only the log-side confirmation is uncertain.
 */
export async function emitInProcess(
  rawInput: unknown,
  options: EmitInProcessOptions = {},
): Promise<EmitOutput> {
  const input = EmitInput.parse(rawInput)
  const key = options.key ?? (await resolveKey())
  const logEndpoint = options.logEndpoint ?? process.env['ATRIB_LOG_ENDPOINT']
  const flushDeadlineMs = options.flushDeadlineMs ?? DEFAULT_FLUSH_DEADLINE_MS
  const queue: SubmissionQueue = createSubmissionQueue(logEndpoint)
  const result = await handleEmit({ input, key, queue, producer: options.producer })
  // Drain before returning, bounded by flushDeadlineMs. The typical caller
  // is a detached hook process that exits right after this resolves; we
  // don't want the queue's 30s retry budget on an unreachable log to
  // stall that process. Racing the flush against a timeout lets the
  // caller fall through with a warning instead.
  const flushed = await Promise.race([
    queue.flush().then(() => true as const),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), flushDeadlineMs)),
  ])
  if (!flushed) {
    result.warnings.push(
      `flush exceeded ${flushDeadlineMs}ms deadline; record signed and mirrored locally, log submission may still be in flight`,
    )
    return result
  }
  // Flush completed within the deadline. handleEmit had to read the proof
  // synchronously, before the submission promise could resolve, so its
  // result carries `log_index: null` and a "submission queued; proof not
  // yet available" warning. After flush the proof is in the queue's cache;
  // re-read it and patch the result so callers see the proof they would
  // get if they queried the log directly. The warning becomes misleading
  // (the submission DID complete), so drop it.
  const proof = getProofFor(queue, result.record_hash)
  if (proof) {
    result.log_index = proof.log_index
    result.inclusion_proof = proof.inclusion_proof
    result.warnings = result.warnings.filter(
      (w) => !w.startsWith('submission queued; proof not yet available'),
    )
  }
  return result
}

// Test-only export of handleEmit. Mirrors the `__test_only__` pattern
// used in sign.ts; lets unit tests assert on the validation paths
// without going through the McpServer transport surface.
export const __test_only__ = { handleEmit }

// ---- public helpers (D079, for atrib-annotate, atrib-revise, future specialized writers) ----
//
// These exports let downstream MCP packages depend on @atrib/emit as the
// canonical record-signing surface and wrap it with a narrow schema. The
// shape is: caller constructs a key + queue (or reuses atrib-emit's
// resolveKey + createSubmissionQueue), parses its own narrow input into an
// EmitInput shape, calls handleEmit, returns the EmitOutput.
//
// Stable as of @atrib/emit@0.8.0. Breaking changes here require a major bump.
export { handleEmit, EmitInput }
export type { EmitOutput }
export { resolveKey } from './keys.js'
export type { ResolvedKey } from './keys.js'
