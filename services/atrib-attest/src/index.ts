// @atrib/attest: atrib's write-verb home. Registers the `attest` tool (the
// two-verb surface's write half) plus the three legacy write tool names
// (`emit`, `atrib-annotate`, `atrib-revise`) as permanent aliases over the
// same handleEmit funnel, so a record signed through any of the four names
// is byte-identical in canonical form. Reuses @atrib/mcp's signing and
// submission primitives so all of them match wrapper-signed records too.
//
// Scope:
//   - Write union server: attest + emit + atrib-annotate + atrib-revise
//   - Legacy single-purpose factories preserved (each mounts its legacy
//     name plus `attest` per the alias-window rule W1)
//   - One key per process (the agent's wrapper key)
//   - Reuses @atrib/mcp signing + submission queue
//   - Persists to the same JSONL convention as the wrapper; the default
//     mirror filename pattern `atrib-emit-<agent>.jsonl` is frozen (L3):
//     existing files keep their names forever

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { randomBytes } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  EVENT_TYPE_ANNOTATION_URI,
  EVENT_TYPE_REVISION_URI,
  LOCAL_SUBSTRATE_DEFAULT_TIMEOUT_MS,
  LOCAL_SUBSTRATE_REQUEST_SCHEMA,
  canonicalRecord,
  createHttpLocalSubstrateTransport,
  createSubmissionQueue,
  genesisChainRoot,
  hexEncode,
  inheritChainContext,
  isValidEventTypeUri,
  normalizeEventType,
  parentRecordHashFromEnv,
  resolveEnvContextId,
  SHA256_REF_PATTERN,
  sha256,
  tryLocalSubstrateCoordinator,
  type AtribRecord,
  type LocalSubstrateCoordinatorRequest,
  type LocalSubstrateCoordinatorTransport,
  type LocalSubstrateDegradationPolicy,
  type LocalSubstrateHarnessClass,
  type LocalSubstrateProducer,
  type LocalSubstrateWalJoin,
  type ProofBundle,
  type SubmissionQueue,
  type TryLocalSubstrateCoordinatorResult,
  type UnsignedAtribRecord,
} from '@atrib/mcp'
import { resolveKey, type ResolvedKey } from './keys.js'
import { filterResolvableInformedBy, type RecordReferenceResolver } from './reference-resolution.js'
import { buildAndSignEmitRecord } from './sign.js'
import { mirrorRecord } from './storage.js'
import {
  AttestInput,
  isAttestMappingRefusal,
  mapAttestInput,
  type AttestInputT,
} from './attest.js'
import { registerAnnotateTool } from './annotate.js'
import { registerReviseTool } from './revise.js'

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
    join(
      homedir(),
      '.atrib',
      'records',
      `atrib-emit-${process.env['ATRIB_AGENT'] ?? 'claude-code'}.jsonl`,
    )
  )
}

const HEX_32_PATTERN = /^[0-9a-f]{32}$/
// 16 bytes encoded as base64url with no padding = 22 chars per spec §1.2.6.
const PROVENANCE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/
const DEFAULT_KEY_RESOLVE_RETRY_MS = 30_000
const TRUE_ENV_VALUES = new Set(['1', 'true', 'yes', 'on'])

function keyResolveRetryMs(): number {
  const raw = process.env['ATRIB_KEY_RESOLVE_RETRY_MS']
  if (raw === undefined || raw === '') return DEFAULT_KEY_RESOLVE_RETRY_MS
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_KEY_RESOLVE_RETRY_MS
}

export function requiresExplicitContextId(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env['ATRIB_REQUIRE_EXPLICIT_CONTEXT_ID']
  return raw !== undefined && TRUE_ENV_VALUES.has(raw.trim().toLowerCase())
}

const EmitInput = z.object({
  event_type: z
    .string()
    .min(1)
    .max(256)
    .describe(
      'Event type URI per spec §1.2.4. Common normative values: ' +
        "'https://atrib.dev/v1/types/observation', '...annotation', '...revision'. " +
        "The shorthand aliases 'observation', 'annotation', 'revision', 'tool_call', " +
        "'transaction', and 'directory_anchor' are accepted and normalized before signing. " +
        'Extension URIs in any namespace OK.',
    ),
  content: z
    .record(z.string(), z.unknown())
    .describe(
      'Semantic content of the cognitive event. Shape varies per event_type. ' +
        'For observation: { what: string, why_noted?: string, topics?: string[] }. ' +
        "For annotation: { annotates: 'sha256:...', importance: 'critical'|'high'|'medium'|'low'|'noise', summary: string, topics?: string[] }. " +
        "For revision: { revises: 'sha256:...', prior_position: string, new_position: string, reason: string }.",
    ),
  context_id: z
    .string()
    .regex(HEX_32_PATTERN)
    .optional()
    .describe(
      '32-hex context_id. If omitted, a fresh genesis context_id is generated and the record is treated as a new chain.',
    ),
  informed_by: z
    .array(z.string().regex(SHA256_REF_PATTERN))
    .optional()
    .describe(
      "Array of 'sha256:<64-hex>' record_hashes that informed this event. " +
        'By default, atrib-emit keeps only refs it can find in local mirrors or ' +
        'the configured log lookup. Sorted lexicographically before signing per §1.2.5.',
    ),
  allow_unresolved_informed_by: z
    .boolean()
    .optional()
    .describe(
      'Set true only when the caller deliberately wants to sign dangling ' +
        'informed_by refs. Defaults false so temp fixture hashes and evidence ' +
        'commitments do not become graph edges by accident.',
    ),
  chain_root: z
    .string()
    .regex(SHA256_REF_PATTERN)
    .optional()
    .describe(
      "Caller-managed chain_root, the 'sha256:<64-hex>' hash of the immediately " +
        'preceding record in this context_id. When supplied alongside context_id, ' +
        'atrib-emit uses both verbatim instead of treating context_id as a fresh ' +
        'genesis. Required when caller manages chain state across multiple emits ' +
        'under one context_id (e.g. multi-record watcher pipelines). When omitted ' +
        'with context_id present, atrib-emit synthesizes the genesis chain_root ' +
        'per spec §1.2.3. Without context_id, this field is meaningless and ' +
        'returns a signed:false refusal.',
    ),
  provenance_token: z
    .string()
    .regex(PROVENANCE_TOKEN_PATTERN)
    .optional()
    .describe(
      '22-char base64url cross-session causal anchor per spec §1.2.6 / D044. ' +
        'Genesis-record-only: atrib-emit refuses to sign a record that carries ' +
        'this field if its chain_root is not the genesis chain_root for the ' +
        'context_id (this returns a signed:false refusal rather than a malformed record).',
    ),
  annotates: z
    .string()
    .regex(SHA256_REF_PATTERN)
    .optional()
    .describe(
      "'sha256:<64-hex>' record_hash this annotation describes per spec §1.2.7 / D058. " +
        'REQUIRED when event_type is the annotation URI; FORBIDDEN on any other event_type. ' +
        'atrib-emit enforces the require/forbid invariant per §1.2.7 (validators MUST reject ' +
        'violations) and returns a signed:false refusal rather than signing a malformed record.',
    ),
  revises: z
    .string()
    .regex(SHA256_REF_PATTERN)
    .optional()
    .describe(
      "'sha256:<64-hex>' record_hash this revision supersedes per spec §1.2.9 / D059. " +
        'REQUIRED when event_type is the revision URI; FORBIDDEN on any other event_type. ' +
        'atrib-emit enforces the require/forbid invariant per §1.2.9 (validators MUST reject ' +
        'violations) and returns a signed:false refusal rather than signing a malformed record.',
    ),
  tool_name: z
    .string()
    .min(1)
    .max(64)
    .optional()
    .describe(
      'Optional §8.2 tool_name disclosure. Verbatim or transformed name (verbatim, opaque, ' +
        'or hashed per §8.2). Lets emit-signed records carry the tool name for downstream ' +
        'consumers (e.g. recall_my_attribution_history filtering by tool_name). Absence ' +
        'indicates the §8.1 default posture (no disclosure).',
    ),
  args_hash: z
    .string()
    .regex(SHA256_REF_PATTERN)
    .optional()
    .describe(
      'Optional §8.3 args_hash commitment. Format: "sha256:" + 64 lowercase hex. Lets ' +
        'emit-signed records carry a commitment to canonical args bytes for downstream ' +
        'consumers (e.g. recall filtering by args_hash, or replay detection). Salted vs ' +
        'plain forms hash identically on the wire; the salt (when used) is carried in the ' +
        'separate args_salt field, which this surface does not yet expose.',
    ),
  result_hash: z
    .string()
    .regex(SHA256_REF_PATTERN)
    .optional()
    .describe(
      'Optional §8.3 result_hash commitment. Format: "sha256:" + 64 lowercase hex. Lets ' +
        'emit-signed records carry a commitment to canonical result bytes for downstream ' +
        'consumers. Salted vs plain forms hash identically on the wire; the salt (when used) ' +
        'is carried in the separate result_salt field, which this surface does not yet expose.',
    ),
})

type EmitSignedOutput = {
  signed: true
  record_hash: string
  log_index: number | null
  inclusion_proof: ProofBundle['inclusion_proof'] | null
  context_id: string
  receipt_id?: string
  warnings: string[]
}

type EmitRefusalOutput = {
  signed: false
  context_id: string
  refusals: string[]
}

type EmitOutput = EmitSignedOutput | EmitRefusalOutput

export interface EmitLocalSubstrateShadowAttempt {
  result: TryLocalSubstrateCoordinatorResult
  expectedRecordHash: string
  responseRecordHash?: string
  recordHashMatches: boolean
}

export interface EmitLocalSubstrateShadowOptions {
  /** Coordinator transport. HTTP, Unix-socket adapters, and tests all plug in here. */
  transport: LocalSubstrateCoordinatorTransport
  /**
   * Producer envelope written outside the signed record bytes. Defaults to a
   * long-lived-agent envelope for the current process and producer label.
   */
  producer?: LocalSubstrateProducer | undefined
  /** Per-call timeout for the shadow probe. Defaults to 500ms. */
  timeoutMs?: number | undefined
  /** Degradation posture written into the coordinator request envelope. */
  fallback?: LocalSubstrateDegradationPolicy | undefined
  /**
   * Wait for the bounded shadow attempt before returning. Short-lived
   * producers use this so the process does not exit before telemetry lands.
   */
  waitForAttempt?: boolean | undefined
  /** Observer hook for tests, telemetry, or rollout reports. Never blocks emit. */
  onAttempt?: ((attempt: EmitLocalSubstrateShadowAttempt) => void | Promise<void>) | undefined
  /** Warning hook for mismatch or observer failures. Never affects emit. */
  onWarning?: ((message: string, detail?: unknown) => void) | undefined
}

export interface EmitLocalSubstrateCommitAttempt {
  result: TryLocalSubstrateCoordinatorResult
  expectedRecordHash: string
  responseRecordHash?: string
  recordHashMatches: boolean
}

export interface EmitLocalSubstrateWalCommitMetadata extends LocalSubstrateWalJoin {
  join_back_target: string
}

export interface EmitLocalSubstrateCommitOptions {
  /** Coordinator transport. HTTP, Unix-socket adapters, and tests all plug in here. */
  transport: LocalSubstrateCoordinatorTransport
  /** Producer envelope written outside the signed record bytes. */
  producer?: LocalSubstrateProducer | undefined
  /** Per-call timeout for the commit request. Defaults to 500ms. */
  timeoutMs?: number | undefined
  /** Degradation posture written into the coordinator request envelope. */
  fallback?: LocalSubstrateDegradationPolicy | undefined
  /**
   * WAL join-back metadata for watcher-WAL coordinator commits. Omit for a
   * long-lived-agent `sign_record` commit.
   */
  wal?: EmitLocalSubstrateWalCommitMetadata | undefined
  /** Observer hook for tests, telemetry, or rollout reports. Never blocks fallback. */
  onAttempt?: ((attempt: EmitLocalSubstrateCommitAttempt) => void | Promise<void>) | undefined
  /** Warning hook for mismatch or observer failures. Never affects emit. */
  onWarning?: ((message: string, detail?: unknown) => void) | undefined
}

export interface ResolveEmitLocalSubstrateShadowFromEnvOptions {
  env?: NodeJS.ProcessEnv | undefined
  producer?: string | undefined
  harnessClass?: LocalSubstrateHarnessClass | undefined
  transport?: string | undefined
  waitForAttempt?: boolean | undefined
  fetch?: typeof fetch | undefined
}

export interface ResolveEmitLocalSubstrateCommitFromEnvOptions {
  env?: NodeJS.ProcessEnv | undefined
  producer?: string | undefined
  harnessClass?: LocalSubstrateHarnessClass | undefined
  transport?: string | undefined
  fetch?: typeof fetch | undefined
}

const DEFAULT_LOCAL_SUBSTRATE_DEGRADATION: LocalSubstrateDegradationPolicy = {
  if_unavailable: 'sign locally in producer and continue without coordinator receipt',
  primary_path_blocking: false,
}

const DEFAULT_LOCAL_SUBSTRATE_WATCHER_DEGRADATION: LocalSubstrateDegradationPolicy = {
  if_unavailable: 'sign locally in producer and write the WAL receipt through the existing drain',
  primary_path_blocking: false,
}

const DEFAULT_LOCAL_SUBSTRATE_COMMIT_DEGRADATION: LocalSubstrateDegradationPolicy = {
  if_unavailable: 'sign locally in producer and continue without coordinator receipt',
  primary_path_blocking: false,
}

export interface AtribEmitServer {
  /** Underlying McpServer; expose for testing or composition. */
  mcp: McpServer
  /** Drain pending submissions (for tests/shutdown). */
  flush(): Promise<void>
}

/** The write-verb server handle. Same shape as the legacy handle. */
export type AtribAttestServer = AtribEmitServer

export interface CreateAtribEmitServerOptions {
  /** Override the resolved key (primarily for testing). */
  key?: ResolvedKey | null | undefined
  /** Override the log endpoint (defaults to env or @atrib/mcp default). */
  logEndpoint?: string | undefined
  /** Override informed_by record lookup, primarily for tests and embedded hosts. */
  recordReferenceResolver?: RecordReferenceResolver | undefined
  /**
   * Optional long-lived-agent local substrate shadow probe. `undefined` reads
   * opt-in env config; `false` disables env config for this server.
   */
  localSubstrate?: EmitLocalSubstrateShadowOptions | false | undefined
  /**
   * Optional long-lived-agent coordinator commit. `undefined` reads
   * ATRIB_LOCAL_SUBSTRATE_MODE=commit from env unless localSubstrate was set
   * explicitly; `false` disables env commit mode for this server.
   */
  localSubstrateCommit?: EmitLocalSubstrateCommitOptions | false | undefined
}

/** The write-verb options. Same shape as the legacy options. */
export type CreateAtribAttestServerOptions = CreateAtribEmitServerOptions

/**
 * Shared per-server wiring for the write tools: one key resolver + one
 * submission queue per server process, whichever tool names are mounted.
 */
export interface WriteToolDeps {
  resolveServerKey: () => Promise<ResolvedKey | null>
  queue: SubmissionQueue
  logEndpoint: string | undefined
  options: CreateAtribAttestServerOptions
}

function buildWriteToolDeps(options: CreateAtribAttestServerOptions): WriteToolDeps {
  const logEndpoint = options.logEndpoint ?? process.env['ATRIB_LOG_ENDPOINT']
  return {
    resolveServerKey: createServerKeyResolver(options),
    queue: createSubmissionQueue(logEndpoint),
    logEndpoint,
    options,
  }
}

/** Register the legacy `emit` tool (polymorphic event_type surface). */
export function registerEmitTool(mcp: McpServer, deps: WriteToolDeps): void {
  mcp.registerTool(
    'emit',
    {
      description:
        'Sign and submit an explicit cognitive event (observation, annotation, revision, etc.) under your atrib identity. Emits a record that chains with your wrapper-signed tool calls when context_id is shared. Legacy alias: new callers should prefer the `attest` tool; records are byte-identical either way.',
      inputSchema: EmitInput.shape,
    },
    async (rawInput) => {
      const input = EmitInput.parse(rawInput)
      const result = await handleEmit({
        input,
        key: await deps.resolveServerKey(),
        queue: deps.queue,
        logEndpoint: deps.logEndpoint,
        recordReferenceResolver: deps.options.recordReferenceResolver,
        localSubstrate: resolveLocalSubstrateOption(deps.options.localSubstrate, {
          producer: 'atrib-emit',
          transport: 'stdio-mcp-server',
          waitForAttempt: false,
        }),
        localSubstrateCommit: resolveLocalSubstrateCommitOption(
          deps.options.localSubstrateCommit !== undefined
            ? deps.options.localSubstrateCommit
            : deps.options.localSubstrate !== undefined
              ? false
              : undefined,
          {
            producer: 'atrib-emit',
            transport: 'stdio-mcp-server',
          },
        ),
      })
      if (!result.signed) {
        return emitRefusalToolResult(result)
      }
      return emitSuccessToolResult(result)
    },
  )
}

/**
 * Register the `attest` tool: the two-verb surface's write half. Maps the
 * declared relationship (`ref`) onto the legacy EmitInput shape and
 * delegates to the same handleEmit funnel, so attest-signed records are
 * byte-identical in canonical form to legacy-name-signed records.
 */
export function registerAttestTool(mcp: McpServer, deps: WriteToolDeps): void {
  mcp.registerTool(
    'attest',
    {
      description:
        'Make a signed statement now: atrib\'s write verb. Signs an observation by default; ' +
        'declare ref: { kind: "annotates", target } to mark a past record\'s importance, or ' +
        'ref: { kind: "revises", target, reason } to supersede a prior position. One handler ' +
        'behind the legacy emit / atrib-annotate / atrib-revise names; records are ' +
        'byte-identical in canonical form regardless of which name signed them.',
      inputSchema: AttestInput.shape,
    },
    async (rawInput) => {
      const input = AttestInput.parse(rawInput) as AttestInputT
      const mapped = mapAttestInput(input)
      if (isAttestMappingRefusal(mapped)) {
        return {
          isError: true as const,
          content: [{ type: 'text' as const, text: mapped.refusals.join('\n') }],
        }
      }
      const producer = input.producer ?? 'atrib-attest'
      const result = await handleEmit({
        input: mapped.emitInput as z.infer<typeof EmitInput>,
        key: await deps.resolveServerKey(),
        queue: deps.queue,
        producer,
        logEndpoint: deps.logEndpoint,
        recordReferenceResolver: deps.options.recordReferenceResolver,
        localSubstrate: resolveLocalSubstrateOption(deps.options.localSubstrate, {
          producer,
          transport: 'stdio-mcp-server',
          waitForAttempt: false,
        }),
        localSubstrateCommit: resolveLocalSubstrateCommitOption(
          deps.options.localSubstrateCommit !== undefined
            ? deps.options.localSubstrateCommit
            : deps.options.localSubstrate !== undefined
              ? false
              : undefined,
          {
            producer,
            transport: 'stdio-mcp-server',
          },
        ),
      })
      if (!result.signed) {
        return emitRefusalToolResult(result)
      }
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ ...result, event_type: mapped.event_type }, null, 2),
          },
        ],
      }
    },
  )
}

/**
 * Wire up the write-verb union server: `attest` plus the three legacy
 * write names, all dispatching to one handleEmit funnel over one shared
 * key resolver + submission queue. This is what the `atrib-attest` binary
 * serves and what the primitive runtime / daemon mount for writes.
 */
export async function createAtribAttestServer(
  options: CreateAtribAttestServerOptions = {},
): Promise<AtribAttestServer> {
  const deps = buildWriteToolDeps(options)
  const mcp = new McpServer({ name: 'atrib-attest', version: '0.1.0' })
  registerAttestTool(mcp, deps)
  registerEmitTool(mcp, deps)
  registerAnnotateTool(mcp, deps)
  registerReviseTool(mcp, deps)
  return {
    mcp,
    flush: () => deps.queue.flush(),
  }
}

/**
 * Wire up the legacy atrib-emit MCP server. Mounts `emit` plus `attest`
 * (alias-window rule W1: every existing server also serves the new verb).
 * Returns an AtribEmitServer handle whose `.mcp` is ready to attach to a
 * transport (StdioServerTransport for the standalone binary; in-process
 * transport for tests).
 */
export async function createAtribEmitServer(
  options: CreateAtribEmitServerOptions = {},
): Promise<AtribEmitServer> {
  const deps = buildWriteToolDeps(options)
  const mcp = new McpServer({ name: 'atrib-emit', version: '0.1.0' })
  registerEmitTool(mcp, deps)
  registerAttestTool(mcp, deps)
  return {
    mcp,
    flush: () => deps.queue.flush(),
  }
}

function createServerKeyResolver(
  options: CreateAtribEmitServerOptions,
): () => Promise<ResolvedKey | null> {
  if (Object.prototype.hasOwnProperty.call(options, 'key')) {
    const fixed = options.key ?? null
    return async () => fixed
  }
  let resolved: ResolvedKey | null = null
  let inFlight: Promise<ResolvedKey | null> | null = null
  let lastMissAt = 0
  return async () => {
    if (resolved) return resolved

    const now = Date.now()
    if (lastMissAt > 0 && now - lastMissAt < keyResolveRetryMs()) return null

    inFlight ??= resolveKey()
      .then((key) => {
        if (key) {
          resolved = key
        } else {
          lastMissAt = Date.now()
        }
        return key
      })
      .finally(() => {
        inFlight = null
      })

    return inFlight
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
  logEndpoint?: string | undefined
  recordReferenceResolver?: RecordReferenceResolver | undefined
  localSubstrate?: EmitLocalSubstrateShadowOptions | undefined
  localSubstrateCommit?: EmitLocalSubstrateCommitOptions | undefined
}

/**
 * Build, sign, submit, mirror. Refused writes return `signed: false`;
 * signed degradations stay `signed: true` and surface in `warnings`.
 */
async function handleEmit({
  input,
  key,
  queue,
  producer,
  logEndpoint,
  recordReferenceResolver,
  localSubstrate,
  localSubstrateCommit,
}: HandleEmitInput): Promise<EmitOutput> {
  const warnings: string[] = []
  const eventType = normalizeEventType(input.event_type)

  if (!isValidEventTypeUri(eventType)) {
    return refusalOutput(input.context_id ?? randomContextId(), [
      `event_type is not a valid absolute URI per §1.4.5: ${input.event_type}`,
    ])
  }

  if (!key) {
    return refusalOutput(input.context_id ?? randomContextId(), [
      'no signing key resolved (set ATRIB_PRIVATE_KEY, ATRIB_KEY_FILE, or store seed in macOS Keychain as service "atrib-creator")',
    ])
  }

  // chain_root without context_id is malformed: chain_root is meaningless
  // outside the context it chains within. Refuse instead of synthesizing one
  // of the two halves.
  if (input.chain_root && !input.context_id) {
    return refusalOutput(input.context_id ?? randomContextId(), [
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
      return refusalOutput(input.context_id, [
        'provenance_token is genesis-record-only per §1.2.6; ' +
          'chain_root must equal genesisChainRoot(context_id) when provenance_token is supplied',
      ])
    }
  }

  // annotates require/forbid invariant per spec §1.2.7 / D058. Validators MUST
  // reject violations; we surface a signed:false refusal so callers see why
  // we refused to sign rather than getting back a malformed record. Use the
  // @atrib/mcp normative constant so the URI string lives in one place.
  if (eventType === EVENT_TYPE_ANNOTATION_URI && !input.annotates) {
    return refusalOutput(input.context_id ?? randomContextId(), [
      'annotation event_type requires annotates per §1.2.7 (D058); ' +
        'omitted records would fail validator admission',
    ])
  }
  if (input.annotates && eventType !== EVENT_TYPE_ANNOTATION_URI) {
    return refusalOutput(input.context_id ?? randomContextId(), [
      'annotates is FORBIDDEN on non-annotation event_types per §1.2.7 (D058); ' +
        `received event_type=${input.event_type}`,
    ])
  }

  // revises require/forbid invariant per spec §1.2.9 / D059. Same shape as
  // the annotates invariant above. Validators MUST reject violations; we
  // surface a signed:false refusal so callers see why we refused to sign
  // rather than getting back a malformed record.
  if (eventType === EVENT_TYPE_REVISION_URI && !input.revises) {
    return refusalOutput(input.context_id ?? randomContextId(), [
      'revision event_type requires revises per §1.2.9 (D059); ' +
        'omitted records would fail validator admission',
    ])
  }
  if (input.revises && eventType !== EVENT_TYPE_REVISION_URI) {
    return refusalOutput(input.context_id ?? randomContextId(), [
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
  if (!callerContextId && requiresExplicitContextId()) {
    return refusalOutput(input.context_id ?? randomContextId(), [
      'context_id is required by ATRIB_REQUIRE_EXPLICIT_CONTEXT_ID; no record signed',
    ])
  }

  // Multi-producer chain composition per spec §1.2.3 / D067. Single source
  // of truth in @atrib/mcp's inheritChainContext: caller-supplied verbatim
  // when both fields are supplied, else cascade through env-tail
  // (cross-producer handoff) and mirror-file inheritance filtered to the same
  // context_id, falling back to genesis. When caller omits context_id entirely,
  // D072 synthesizes a fresh orphan context instead of inheriting another
  // session from the mirror tail. The cognitive-extractor hook spawning
  // atrib-emit with ATRIB_CHAIN_TAIL_<context_id> plus the agent's context_id
  // is the primary case that needs preserving; pre-fix this produced isolated
  // genesis records because atrib-emit's local resolver short-circuited on
  // caller context.
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

  // ATRIB_PARENT_RECORD_HASH env-var seeding (D104/D115/D116, producer-side
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
  const resolvedInputInformedBy = await filterResolvableInformedBy(input.informed_by, {
    allowUnresolved: input.allow_unresolved_informed_by,
    resolver: recordReferenceResolver,
    logEndpoint,
    warnings,
  })
  const effectiveInformedBy = validParentHash
    ? Array.from(new Set([validParentHash, ...(resolvedInputInformedBy ?? [])]))
    : resolvedInputInformedBy

  let record
  try {
    record = await buildAndSignEmitRecord({
      privateKey: key.privateKey,
      eventType,
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
    return refusalOutput(contextId, [`signing failed: ${e instanceof Error ? e.message : String(e)}`])
  }

  const recordHash = hashRecord(record)
  const unsignedRecordBody = unsignedRecordBodyFromSigned(record)
  let localSubstrateShadow: Promise<void> | undefined
  let localSubstrateCommitted = false
  let localSubstrateReceiptId: string | undefined

  if (localSubstrate) {
    localSubstrateShadow = dispatchEmitLocalSubstrateShadow({
      localSubstrate,
      recordBody: unsignedRecordBody,
      expectedRecordHash: recordHash,
      contextId,
      chainRoot,
      parentRecordHash: validParentHash,
      producerLabel: producer ?? 'atrib-emit',
    })
  }

  if (localSubstrateCommit) {
    const commit = await dispatchEmitLocalSubstrateCommit({
      localSubstrate: localSubstrateCommit,
      recordBody: unsignedRecordBody,
      expectedRecordHash: recordHash,
      contextId,
      chainRoot,
      parentRecordHash: validParentHash,
      producerLabel: producer ?? 'atrib-emit',
    })
    warnings.push(...commit.warnings)
    if (commit.accepted) {
      localSubstrateCommitted = true
      localSubstrateReceiptId = commit.receiptId
    }
  }

  // Submit asynchronously; the queue handles retry + degradation per §5.8.
  // Cognitive events default to normal priority, annotations/observations
  // never need to block the agent.
  if (!localSubstrateCommitted) {
    queue.submit(record, 'normal')
  }

  // Best-effort mirror; mirrorRecord internally swallows errors per §5.8.
  // Persist the pre-sign `content` payload as a `_local` sidecar so
  // consumers (recall, trace, summarize) can surface semantic context
  // alongside the cryptographic evidence. The sidecar lives at the
  // envelope level, the signed record bytes are unchanged.
  await mirrorRecord(record, getProofFor(queue, recordHash) ?? null, {
    content: input.content,
    producer: producer ?? 'atrib-emit',
  })

  // Try to read a proof if the queue submitted synchronously and the log
  // returned one within the same tick. Most submissions return null here
  // and the proof shows up on a later poll via getProof.
  const proof = getProofFor(queue, recordHash) ?? null

  if (!proof && localSubstrateCommitted) {
    warnings.push(
      'submission delegated to local substrate coordinator; proof not available in this process',
    )
  } else if (!proof) {
    warnings.push('submission queued; proof not yet available (poll the log later if needed)')
  }

  if (localSubstrate?.waitForAttempt && localSubstrateShadow) {
    await localSubstrateShadow
  }

  return {
    signed: true,
    record_hash: recordHash,
    log_index: proof?.log_index ?? null,
    inclusion_proof: proof?.inclusion_proof ?? null,
    context_id: contextId,
    ...(localSubstrateReceiptId !== undefined ? { receipt_id: localSubstrateReceiptId } : {}),
    warnings,
  }
}

function refusalOutput(contextId: string, refusals: string[]): EmitRefusalOutput {
  return {
    signed: false,
    context_id: contextId,
    refusals,
  }
}

function contextIdFromRawInput(rawInput: unknown): string {
  if (rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput)) {
    const contextId = (rawInput as Record<string, unknown>)['context_id']
    if (typeof contextId === 'string' && HEX_32_PATTERN.test(contextId)) {
      return contextId
    }
  }
  return randomContextId()
}

function zodRefusals(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length ? `${issue.path.join('.')}: ` : ''
    return `${path}${issue.message}`
  })
}

function emitRefusalToolResult(result: EmitRefusalOutput): {
  isError: true
  content: Array<{ type: 'text'; text: string }>
} {
  return {
    isError: true,
    content: [{ type: 'text', text: result.refusals.join('\n') }],
  }
}

function emitSuccessToolResult(result: EmitSignedOutput): {
  content: Array<{ type: 'text'; text: string }>
} {
  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
  }
}

function randomContextId(): string {
  // 16 random bytes → 32 hex chars; matches the spec's context_id format.
  return randomBytes(16).toString('hex')
}

function hashRecord(record: AtribRecord): string {
  return `sha256:${hexEncode(sha256(canonicalRecord(record)))}`
}

function unsignedRecordBodyFromSigned(record: AtribRecord): UnsignedAtribRecord {
  const { signature: _signature, ...body } = record
  return body as UnsignedAtribRecord
}

function localSubstrateProducer(
  producerLabel: string,
  options?: {
    harnessClass?: LocalSubstrateHarnessClass | undefined
    transport?: string | undefined
  },
): LocalSubstrateProducer {
  return {
    name: producerLabel,
    harness_class: options?.harnessClass ?? 'long-lived-agent',
    pid: process.pid,
    transport: options?.transport ?? 'emit-in-process',
    creator_key_policy: 'explicit-single-creator',
  }
}

function watcherWalLocalSubstrateProducer(
  producerLabel: string,
  options?: {
    transport?: string | undefined
  },
): LocalSubstrateProducer {
  return {
    name: producerLabel,
    harness_class: 'watcher-wal',
    pid: process.pid,
    transport: options?.transport ?? 'emit-in-process-wal',
    creator_key_policy: 'explicit-watcher-creator',
  }
}

function parsePositiveInt(value: string | undefined): number | undefined {
  if (value === undefined || value.trim().length === 0) return undefined
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined
}

export function resolveEmitLocalSubstrateShadowFromEnv(
  options: ResolveEmitLocalSubstrateShadowFromEnvOptions = {},
): EmitLocalSubstrateShadowOptions | undefined {
  const env = options.env ?? process.env
  const endpoint = env['ATRIB_LOCAL_SUBSTRATE_ENDPOINT']
  if (!endpoint) return undefined

  const mode = env['ATRIB_LOCAL_SUBSTRATE_MODE'] ?? 'shadow'
  if (mode === 'off' || mode === 'disabled' || mode === 'false') return undefined
  if (mode !== 'shadow') return undefined

  const timeoutMs = parsePositiveInt(env['ATRIB_LOCAL_SUBSTRATE_TIMEOUT_MS'])
  return {
    transport: createHttpLocalSubstrateTransport(endpoint, {
      ...(options.fetch !== undefined ? { fetch: options.fetch } : {}),
    }),
    producer: localSubstrateProducer(options.producer ?? 'atrib-emit', {
      harnessClass: options.harnessClass,
      transport: options.transport,
    }),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(options.waitForAttempt !== undefined ? { waitForAttempt: options.waitForAttempt } : {}),
  }
}

export function resolveEmitLocalSubstrateCommitFromEnv(
  options: ResolveEmitLocalSubstrateCommitFromEnvOptions = {},
): EmitLocalSubstrateCommitOptions | undefined {
  const env = options.env ?? process.env
  const endpoint = env['ATRIB_LOCAL_SUBSTRATE_ENDPOINT']
  if (!endpoint) return undefined

  const mode = env['ATRIB_LOCAL_SUBSTRATE_MODE']
  if (mode !== 'commit') return undefined

  const timeoutMs = parsePositiveInt(env['ATRIB_LOCAL_SUBSTRATE_TIMEOUT_MS'])
  return {
    transport: createHttpLocalSubstrateTransport(endpoint, {
      ...(options.fetch !== undefined ? { fetch: options.fetch } : {}),
    }),
    producer: localSubstrateProducer(options.producer ?? 'atrib-emit', {
      harnessClass: options.harnessClass,
      transport: options.transport,
    }),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  }
}

function resolveLocalSubstrateOption(
  option: EmitLocalSubstrateShadowOptions | false | undefined,
  defaults: {
    producer: string
    transport: string
    harnessClass?: LocalSubstrateHarnessClass | undefined
    waitForAttempt?: boolean | undefined
  },
): EmitLocalSubstrateShadowOptions | undefined {
  if (option === false) return undefined
  if (option) {
    return {
      ...option,
      waitForAttempt: option.waitForAttempt ?? defaults.waitForAttempt,
      producer:
        option.producer ??
        localSubstrateProducer(defaults.producer, {
          transport: defaults.transport,
          harnessClass: defaults.harnessClass,
        }),
    }
  }
  return resolveEmitLocalSubstrateShadowFromEnv(defaults)
}

function resolveLocalSubstrateCommitOption(
  option: EmitLocalSubstrateCommitOptions | false | undefined,
  defaults: {
    producer: string
    transport: string
    harnessClass?: LocalSubstrateHarnessClass | undefined
  },
): EmitLocalSubstrateCommitOptions | undefined {
  if (option === false) return undefined
  if (option) {
    return {
      ...option,
      producer:
        option.producer ??
        (option.wal
          ? watcherWalLocalSubstrateProducer(defaults.producer, {
              transport: defaults.transport,
            })
          : localSubstrateProducer(defaults.producer, {
              transport: defaults.transport,
              harnessClass: defaults.harnessClass,
            })),
    }
  }
  return resolveEmitLocalSubstrateCommitFromEnv(defaults)
}

function dispatchEmitLocalSubstrateShadow(input: {
  localSubstrate: EmitLocalSubstrateShadowOptions
  recordBody: UnsignedAtribRecord
  expectedRecordHash: string
  contextId: string
  chainRoot: string
  parentRecordHash?: string | undefined
  producerLabel: string
}): Promise<void> {
  const producer =
    input.localSubstrate.producer ??
    localSubstrateProducer(input.producerLabel, { transport: 'emit-in-process' })
  const request: LocalSubstrateCoordinatorRequest = {
    schema: LOCAL_SUBSTRATE_REQUEST_SCHEMA,
    operation: 'sign_record',
    mode: 'shadow_probe',
    producer,
    context: {
      source: '@atrib/emit',
      context_id: input.contextId,
      chain_tail: input.chainRoot,
      ...(input.parentRecordHash !== undefined
        ? { parent_record_hash: input.parentRecordHash }
        : {}),
    },
    record_body: input.recordBody,
    degradation: input.localSubstrate.fallback ?? DEFAULT_LOCAL_SUBSTRATE_DEGRADATION,
  }

  return tryLocalSubstrateCoordinator(request, {
    transport: input.localSubstrate.transport,
    timeoutMs: input.localSubstrate.timeoutMs ?? LOCAL_SUBSTRATE_DEFAULT_TIMEOUT_MS,
    expectedHarnessClass: producer.harness_class,
    directRecordBody: input.recordBody,
  })
    .then((result) => {
      const responseRecordHash =
        result.ok || result.status === 'rejected' ? result.response?.record_hash : undefined
      const recordHashMatches = responseRecordHash === input.expectedRecordHash
      if (result.ok && !recordHashMatches) {
        notifyLocalSubstrateWarning(
          input.localSubstrate,
          'local substrate shadow record_hash mismatch',
          {
            expected_record_hash: input.expectedRecordHash,
            response_record_hash: responseRecordHash ?? null,
          },
        )
      }
      if (input.localSubstrate.onAttempt) {
        try {
          const observed = input.localSubstrate.onAttempt({
            result,
            expectedRecordHash: input.expectedRecordHash,
            ...(responseRecordHash !== undefined ? { responseRecordHash } : {}),
            recordHashMatches,
          })
          void Promise.resolve(observed).catch((error) => {
            notifyLocalSubstrateWarning(
              input.localSubstrate,
              'local substrate shadow observer rejected',
              error,
            )
          })
        } catch (error) {
          notifyLocalSubstrateWarning(
            input.localSubstrate,
            'local substrate shadow observer threw',
            error,
          )
        }
      }
    })
    .catch((error) => {
      notifyLocalSubstrateWarning(
        input.localSubstrate,
        'local substrate shadow probe failed unexpectedly',
        error,
      )
    })
}

async function dispatchEmitLocalSubstrateCommit(input: {
  localSubstrate: EmitLocalSubstrateCommitOptions
  recordBody: UnsignedAtribRecord
  expectedRecordHash: string
  contextId: string
  chainRoot: string
  parentRecordHash?: string | undefined
  producerLabel: string
}): Promise<{ accepted: boolean; receiptId?: string; warnings: string[] }> {
  const warnings: string[] = []
  const wal = input.localSubstrate.wal
  const producer =
    input.localSubstrate.producer ??
    (wal
      ? watcherWalLocalSubstrateProducer(input.producerLabel, { transport: 'emit-in-process-wal' })
      : localSubstrateProducer(input.producerLabel, { transport: 'emit-in-process' }))
  const request: LocalSubstrateCoordinatorRequest = {
    schema: LOCAL_SUBSTRATE_REQUEST_SCHEMA,
    operation: wal ? 'enqueue_record_and_join_receipt' : 'sign_record',
    mode: wal ? undefined : 'commit',
    producer,
    context: {
      source: '@atrib/emit',
      context_id: input.contextId,
      chain_tail: input.chainRoot,
      ...(input.parentRecordHash !== undefined
        ? { parent_record_hash: input.parentRecordHash }
        : {}),
      ...(wal ? { join_back_target: wal.join_back_target } : {}),
    },
    record_body: input.recordBody,
    ...(wal
      ? {
          wal: {
            entry_id: wal.entry_id,
            source_path: wal.source_path,
            receipt_join_field: wal.receipt_join_field,
          },
        }
      : {}),
    degradation:
      input.localSubstrate.fallback ??
      (wal
        ? DEFAULT_LOCAL_SUBSTRATE_WATCHER_DEGRADATION
        : DEFAULT_LOCAL_SUBSTRATE_COMMIT_DEGRADATION),
  }

  const result = await tryLocalSubstrateCoordinator(request, {
    transport: input.localSubstrate.transport,
    timeoutMs: input.localSubstrate.timeoutMs ?? LOCAL_SUBSTRATE_DEFAULT_TIMEOUT_MS,
    expectedHarnessClass: producer.harness_class,
    directRecordBody: input.recordBody,
  })

  const responseRecordHash =
    result.ok || result.status === 'rejected' ? result.response?.record_hash : undefined
  const recordHashMatches = responseRecordHash === input.expectedRecordHash

  if (input.localSubstrate.onAttempt) {
    try {
      const observed = input.localSubstrate.onAttempt({
        result,
        expectedRecordHash: input.expectedRecordHash,
        ...(responseRecordHash !== undefined ? { responseRecordHash } : {}),
        recordHashMatches,
      })
      await Promise.resolve(observed)
    } catch (error) {
      notifyLocalSubstrateCommitWarning(
        input.localSubstrate,
        'local substrate commit observer threw',
        error,
      )
    }
  }

  if (!result.ok) {
    const reason =
      result.status === 'rejected'
        ? (result.reason ?? 'rejected')
        : result.status === 'unavailable'
          ? result.reason
          : result.issues.map((issue) => `${issue.path} ${issue.message}`).join('; ')
    warnings.push(
      `local substrate ${wal ? 'watcher-WAL' : 'emit'} commit failed (${result.status}: ${reason}); signed locally`,
    )
    return { accepted: false, warnings }
  }

  if (!recordHashMatches) {
    notifyLocalSubstrateCommitWarning(
      input.localSubstrate,
      'local substrate commit record_hash mismatch',
      {
        expected_record_hash: input.expectedRecordHash,
        response_record_hash: responseRecordHash ?? null,
      },
    )
    warnings.push(
      `local substrate ${wal ? 'watcher-WAL' : 'emit'} commit record_hash mismatch; signed locally`,
    )
    return { accepted: false, warnings }
  }

  return {
    accepted: true,
    ...(result.response.receipt_id !== undefined ? { receiptId: result.response.receipt_id } : {}),
    warnings,
  }
}

function notifyLocalSubstrateCommitWarning(
  localSubstrate: EmitLocalSubstrateCommitOptions,
  message: string,
  detail?: unknown,
): void {
  if (!localSubstrate.onWarning) return
  try {
    localSubstrate.onWarning(`atrib-emit: ${message}`, detail)
  } catch {
    // Warning observers must not affect the signed emit path.
  }
}

function notifyLocalSubstrateWarning(
  localSubstrate: EmitLocalSubstrateShadowOptions,
  message: string,
  detail?: unknown,
): void {
  if (!localSubstrate.onWarning) return
  try {
    localSubstrate.onWarning(`atrib-emit: ${message}`, detail)
  } catch {
    // Warning observers must not affect the signed emit path.
  }
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
  /** Override informed_by record lookup, primarily for tests and embedded hosts. */
  recordReferenceResolver?: RecordReferenceResolver | undefined
  /**
   * Optional long-lived-agent local substrate shadow probe. `undefined` reads
   * opt-in env config; `false` disables env config for this call.
   */
  localSubstrate?: EmitLocalSubstrateShadowOptions | false | undefined
  /**
   * Optional coordinator commit. Without WAL metadata this sends a
   * long-lived-agent `sign_record` commit. With WAL metadata it sends the
   * watcher-WAL receipt join request. When accepted, emitInProcess mirrors the
   * local sidecar but skips its own log submission queue because the
   * coordinator owns that side effect. On rejection or timeout, the existing
   * local queue path remains the fallback.
   */
  localSubstrateCommit?: EmitLocalSubstrateCommitOptions | false | undefined
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
 * documents: resolve key, build a submission queue, call handleEmit,
 * and additionally flushes the queue before returning, because a hook
 * process exits immediately afterward and a still-pending submission
 * would be lost with it.
 *
 * Records are byte-identical to MCP-server-signed and wrapper-signed
 * records: this routes through the same handleEmit path createAtribEmitServer
 * uses. Refused writes return `signed: false`; signed-but-degraded
 * submissions surface in EmitOutput.warnings.
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
  const parsed = EmitInput.safeParse(rawInput)
  if (!parsed.success) {
    return refusalOutput(contextIdFromRawInput(rawInput), zodRefusals(parsed.error))
  }
  const input = parsed.data
  const key = options.key ?? (await resolveKey())
  const logEndpoint = options.logEndpoint ?? process.env['ATRIB_LOG_ENDPOINT']
  const flushDeadlineMs = options.flushDeadlineMs ?? DEFAULT_FLUSH_DEADLINE_MS
  const queue: SubmissionQueue = createSubmissionQueue(logEndpoint)
  const result = await handleEmit({
    input,
    key,
    queue,
    producer: options.producer,
    logEndpoint,
    recordReferenceResolver: options.recordReferenceResolver,
    localSubstrate: resolveLocalSubstrateOption(options.localSubstrate, {
      producer: options.producer ?? 'atrib-emit',
      transport: 'emit-in-process',
      waitForAttempt: true,
    }),
    localSubstrateCommit: resolveLocalSubstrateCommitOption(
      options.localSubstrateCommit !== undefined
        ? options.localSubstrateCommit
        : options.localSubstrate !== undefined
          ? false
          : undefined,
      {
        producer: options.producer ?? 'atrib-emit',
        transport: 'emit-in-process',
      },
    ),
  })
  if (!result.signed) {
    return result
  }
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

// ---- the attest write verb: programmatic surface ----

/** Signed attest output: the emit-family fields plus the mapped event_type. */
export type AttestOutput =
  | (EmitSignedOutput & { event_type: string })
  | EmitRefusalOutput

export interface HandleAttestInput {
  input: AttestInputT
  key: ResolvedKey | null
  queue: SubmissionQueue
  /** Sidecar label; defaults to 'atrib-attest'. input.producer wins. */
  producer?: string
  logEndpoint?: string | undefined
  recordReferenceResolver?: RecordReferenceResolver | undefined
  localSubstrate?: EmitLocalSubstrateShadowOptions | undefined
  localSubstrateCommit?: EmitLocalSubstrateCommitOptions | undefined
}

/**
 * The attest handler: map the declared relationship onto the legacy
 * EmitInput shape, then delegate to handleEmit. Byte-identity with the
 * legacy write names holds by construction (one funnel, one signer).
 */
export async function handleAttest(args: HandleAttestInput): Promise<AttestOutput> {
  const mapped = mapAttestInput(args.input)
  if (isAttestMappingRefusal(mapped)) {
    return refusalOutput(args.input.context_id ?? randomContextId(), mapped.refusals)
  }
  const result = await handleEmit({
    input: mapped.emitInput as z.infer<typeof EmitInput>,
    key: args.key,
    queue: args.queue,
    producer: args.input.producer ?? args.producer ?? 'atrib-attest',
    logEndpoint: args.logEndpoint,
    recordReferenceResolver: args.recordReferenceResolver,
    localSubstrate: args.localSubstrate,
    localSubstrateCommit: args.localSubstrateCommit,
  })
  if (!result.signed) return result
  return { ...result, event_type: mapped.event_type }
}

/**
 * Attest one cognitive event in-process, without an MCP transport. The
 * write-verb sibling of emitInProcess: same flush deadline, same
 * degradation posture, same mirror conventions. Default sidecar producer
 * label is 'atrib-attest' ('atrib-attest-cli' when spawned via the CLI
 * binary); the input-level `producer` override wins per §5.9.3.
 */
export async function attestInProcess(
  rawInput: unknown,
  options: EmitInProcessOptions = {},
): Promise<AttestOutput> {
  const parsed = AttestInput.safeParse(rawInput)
  if (!parsed.success) {
    return refusalOutput(contextIdFromRawInput(rawInput), zodRefusals(parsed.error))
  }
  const mapped = mapAttestInput(parsed.data)
  if (isAttestMappingRefusal(mapped)) {
    return refusalOutput(
      parsed.data.context_id ?? randomContextId(),
      mapped.refusals,
    )
  }
  const result = await emitInProcess(mapped.emitInput, {
    ...options,
    producer: parsed.data.producer ?? options.producer ?? 'atrib-attest',
  })
  if (!result.signed) return result
  return { ...result, event_type: mapped.event_type }
}

// Test-only export of handleEmit. Mirrors the `__test_only__` pattern
// used in sign.ts; lets unit tests assert on the validation paths
// without going through the McpServer transport surface.
export const __test_only__ = { createServerKeyResolver, handleEmit, keyResolveRetryMs }

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

// Session-checkpoint emission (§1.2.10 / D139): reads the ordered record
// hashes for a context from the local mirror per §5.9 and emits the
// checkpoint through the existing emit pipeline (no new signing path).
// §5.8: failures are silent and atrib:-logged; a missed checkpoint just
// widens the next interval.
export { emitSessionCheckpoint } from './session-checkpoint.js'
export type {
  EmitSessionCheckpointOptions,
  EmitSessionCheckpointResult,
} from './session-checkpoint.js'

// The attest input surface (write verb).
export { AttestInput, AttestRef, mapAttestInput, isAttestMappingRefusal } from './attest.js'
export type { AttestInputT, MappedAttestInput, AttestMappingRefusal } from './attest.js'

// Legacy specialized writers, kept as permanent aliases over the attest
// funnel. The @atrib/annotate and @atrib/revise packages re-export these.
export {
  AnnotateInput,
  Importance,
  createAtribAnnotateServer,
  registerAnnotateTool,
} from './annotate.js'
export type { AtribAnnotateServer, CreateAtribAnnotateServerOptions } from './annotate.js'
export {
  ReviseInput,
  createAtribReviseServer,
  registerReviseTool,
} from './revise.js'
export type { AtribReviseServer, CreateAtribReviseServerOptions } from './revise.js'
