/**
 * Generate the dev.atrib/attribution MCP-extension conformance corpus
 * (P049 / §1.5.4 / docs/extensions/dev.atrib-attribution/v0.1.md).
 *
 * Run with: pnpm --filter @atrib/log-dev exec tsx scripts/generate-conformance-mcp-extension.ts
 *
 * Output: spec/conformance/mcp-extension/cases/<family>--<name>.json + manifest.json
 *
 * The dev.atrib/attribution extension (SEP-2133 unofficial extension,
 * identifier frozen at v0.1) standardizes atrib's MCP carriage upward from
 * the unprefixed convention. No signed byte changes: the extension gates
 * only discovery and carriage. The corpus pins six contract families:
 *
 *   1. capability/   Server/client settings-object validity: `version` is
 *                    the only required field, unknown fields ignored,
 *                    reserved-prefix rule for identifiers.
 *   2. gating/       Receipts appear in result._meta ONLY when the client
 *                    declared the extension on that request; undeclared and
 *                    malformed declarations degrade to byte-identical
 *                    pre-extension legacy output.
 *   3. token/        Ladder 1 (inbound propagation token):
 *                    extension key > _meta.atrib > tracestate atrib= >
 *                    X-Atrib-Chain; conflicts resolve to the extension key
 *                    with a warning; malformed carriers fall through; all
 *                    carriers stripped continues per D067 / §1.2.3.1.
 *   4. context/      Ladder 2 (context identity): explicit tool argument >
 *                    extension context_id > traceparent trace-id >
 *                    D078/D083 env-file registry > undefined; non-32-hex
 *                    extension values fall through; unknown block fields
 *                    (incl. session_token / provenance_token) are ignored
 *                    with no record-field effect.
 *   5. receipt/      Receipt integrity against REAL signed records: token
 *                    equals encodeToken(record), record_hash recomputes
 *                    from canonical bytes, creator_key matches the signer,
 *                    log_submission is a queue status, never awaited
 *                    (§5.3.5).
 *   6. degradation/  §5.8: forced signing failure and forced
 *                    capability-read failure both leave the tool result
 *                    byte-identical to passthrough; a request with no
 *                    _meta at all never blocks the call.
 *
 * Seeds and timestamps are hardcoded so successive regenerations produce
 * byte-identical files. Re-run when:
 *   - the extension request-block or receipt schema changes (requires a
 *     new settings version in the extension spec first)
 *   - either canonical inbound ladder changes (requires revising §1.5.4)
 *   - canonical record format (§1.2 / §1.3) changes
 *   - a new test case is added
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import {
  EVENT_TYPE_OBSERVATION_URI,
  EVENT_TYPE_TOOL_CALL_URI,
  base64urlEncode,
  canonicalRecord,
  encodeToken,
  genesisChainRoot,
  getPublicKey,
  signRecord,
  writeOutboundContext,
  type AtribRecord,
} from '@atrib/mcp'
import { sha256 } from '@noble/hashes/sha2.js'

// ─── Extension constants (mirror docs/extensions/dev.atrib-attribution/v0.1.md) ───

const EXT_ID = 'dev.atrib/attribution'
const EXT_VERSION = '0.1'
const CLIENT_CAPABILITIES_META_KEY = 'io.modelcontextprotocol/clientCapabilities'
const LOG_SUBMISSION_STATUSES = ['queued', 'submitted', 'disabled', 'failed'] as const

// ─── Deterministic inputs ──────────────────────────────────────────────

const SERVER_SEED = new Uint8Array(32).fill(0x51)
const UPSTREAM_A_SEED = new Uint8Array(32).fill(0x61)
const UPSTREAM_B_SEED = new Uint8Array(32).fill(0x62)
const UPSTREAM_C_SEED = new Uint8Array(32).fill(0x63)
const UPSTREAM_D_SEED = new Uint8Array(32).fill(0x64)
const REFERENCE_TIME_MS = Date.UTC(2026, 6, 6, 0, 0, 0) // 2026-07-06T00:00:00Z

const CTX_SERVER = '5e'.repeat(16)
const CTX_A = 'a1'.repeat(16)
const CTX_B = 'b2'.repeat(16)
const CTX_C = 'c3'.repeat(16)
const CTX_D = 'd4'.repeat(16)
const CTX_ARGUMENT = '11'.repeat(16)
const CTX_EXTENSION = '22'.repeat(16)
const CTX_TRACEPARENT = '33'.repeat(16)
const TRACEPARENT = `00-${CTX_TRACEPARENT}-00f067aa0ba902b7-01`

const HERE = dirname(fileURLToPath(import.meta.url))
const CORPUS_ROOT = resolve(HERE, '../../../spec/conformance/mcp-extension')
const CASES_DIR = join(CORPUS_ROOT, 'cases')

mkdirSync(CASES_DIR, { recursive: true })

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex')
}

/** JCS bytes of any JSON value, via the same RFC 8785 impl records use. */
function jcsBytes(value: unknown): Uint8Array {
  return canonicalRecord(value as AtribRecord)
}

function recordHashHex(record: AtribRecord): string {
  return hex(sha256(canonicalRecord(record)))
}

function jcsSha256Hex(value: unknown): string {
  return hex(sha256(jcsBytes(value)))
}

const caseFiles: { file: string; name: string; family: string }[] = []

function writeCase(family: string, name: string, body: Record<string, unknown>): void {
  const fileName = `${family}--${name}.json`
  writeFileSync(join(CASES_DIR, fileName), JSON.stringify(body, null, 2) + '\n')
  caseFiles.push({ file: `cases/${fileName}`, name: `${family}--${name}`, family })
}

async function signObservation(
  seed: Uint8Array,
  contextId: string,
  contentByte: string,
  timestampOffsetMs: number,
): Promise<AtribRecord> {
  const pub = await getPublicKey(seed)
  const unsigned = {
    spec_version: 'atrib/1.0' as const,
    content_id: 'sha256:' + contentByte.repeat(32),
    creator_key: base64urlEncode(pub),
    chain_root: genesisChainRoot(contextId),
    event_type: EVENT_TYPE_OBSERVATION_URI,
    context_id: contextId,
    timestamp: REFERENCE_TIME_MS + timestampOffsetMs,
    signature: '',
  }
  return signRecord(unsigned as AtribRecord, seed)
}

/** Build the gated extension result block for a signed record. */
function extensionResultBlock(
  record: AtribRecord,
  includeRecord: boolean,
): Record<string, unknown> {
  const block: Record<string, unknown> = {
    token: encodeToken(record),
    receipt: {
      record_hash: 'sha256:' + recordHashHex(record),
      creator_key: record.creator_key,
      context_id: record.context_id,
      event_type: 'tool_call',
      chain_root: record.chain_root,
      log_submission: 'queued',
    },
  }
  if (includeRecord) block.record = record
  return block
}

async function main(): Promise<void> {
  const serverKey = base64urlEncode(await getPublicKey(SERVER_SEED))

  // Upstream records A-D: four distinct real signed records so each inbound
  // carrier can carry a token that decodes to a DIFFERENT record hash.
  const recordA = await signObservation(UPSTREAM_A_SEED, CTX_A, 'aa', 1000)
  const recordB = await signObservation(UPSTREAM_B_SEED, CTX_B, 'bb', 2000)
  const recordC = await signObservation(UPSTREAM_C_SEED, CTX_C, 'cc', 3000)
  const recordD = await signObservation(UPSTREAM_D_SEED, CTX_D, 'dd', 4000)
  const tokenA = encodeToken(recordA)
  const tokenB = encodeToken(recordB)
  const tokenC = encodeToken(recordC)
  const tokenD = encodeToken(recordD)

  // Server tool_call record: the record the receipts attest to. args_hash is
  // a REAL commitment to real args bytes per §8.3 plain-sha256.
  const toolArgs = { query: 'verifiable agent actions' }
  const argsHash = 'sha256:' + jcsSha256Hex(toolArgs)
  const toolCallUnsigned = {
    spec_version: 'atrib/1.0' as const,
    content_id: 'sha256:' + 'e1'.repeat(32),
    creator_key: serverKey,
    chain_root: genesisChainRoot(CTX_SERVER),
    event_type: EVENT_TYPE_TOOL_CALL_URI,
    context_id: CTX_SERVER,
    timestamp: REFERENCE_TIME_MS + 5000,
    args_hash: argsHash,
    signature: '',
  }
  const toolCallRecord = await signRecord(toolCallUnsigned as AtribRecord, SERVER_SEED)
  const toolCallToken = encodeToken(toolCallRecord)

  // A second, distinct server record for the receipt-mismatch case.
  const otherToolCallUnsigned = {
    spec_version: 'atrib/1.0' as const,
    content_id: 'sha256:' + 'e2'.repeat(32),
    creator_key: serverKey,
    chain_root: 'sha256:' + recordHashHex(toolCallRecord),
    event_type: EVENT_TYPE_TOOL_CALL_URI,
    context_id: CTX_SERVER,
    timestamp: REFERENCE_TIME_MS + 6000,
    signature: '',
  }
  const otherToolCallRecord = await signRecord(otherToolCallUnsigned as AtribRecord, SERVER_SEED)

  const declaredClientCapabilities = {
    extensions: {
      [EXT_ID]: { version: EXT_VERSION, accept: ['token', 'record'] },
    },
  }
  const declaredTokenOnlyClientCapabilities = {
    extensions: {
      [EXT_ID]: { version: EXT_VERSION, accept: ['token'] },
    },
  }

  // ══ Family 1: capability ═════════════════════════════════════════════

  writeCase('capability', 'server-declaration-valid', {
    name: 'capability--server-declaration-valid',
    spec_section: '1.5.4',
    extension: EXT_ID,
    description:
      'A full server capability settings object per extension spec §4.1. `version` is the only REQUIRED field; every other field is OPTIONAL and advisory. Implementations MUST accept and treat the peer as having declared the extension.',
    input: {
      settings: {
        version: EXT_VERSION,
        signs: ['tool_call'],
        receipts: ['token', 'record'],
        disclosure: { args: 'plain-sha256', result: 'omit' },
        creator_key: serverKey,
        logs: ['https://log.atrib.dev/v1'],
        directory: 'https://directory.atrib.dev/v1',
      },
    },
    expected: {
      valid: true,
      declared: true,
      negotiated_version: EXT_VERSION,
      advisory_fields_are_untrusted: true,
    },
  })

  writeCase('capability', 'client-declaration-valid', {
    name: 'capability--client-declaration-valid',
    spec_section: '1.5.4',
    extension: EXT_ID,
    description:
      'A client capability settings object per extension spec §4.2, declared per-request under io.modelcontextprotocol/clientCapabilities. `accept: ["token","record"]` requests full record bodies in receipts.',
    input: {
      settings: { version: EXT_VERSION, accept: ['token', 'record'] },
    },
    expected: {
      valid: true,
      declared: true,
      negotiated_version: EXT_VERSION,
      effective_accept: ['token', 'record'],
      accept_record: true,
    },
  })

  writeCase('capability', 'unknown-settings-fields-ignored', {
    name: 'capability--unknown-settings-fields-ignored',
    spec_section: '1.5.4',
    extension: EXT_ID,
    description:
      'Forward compatibility: unknown settings fields MUST be ignored, and unknown `accept` values MUST be ignored. An unrecognized settings `version` under the same identifier is still a valid declaration (the identifier, not the version string, is the compatibility unit; breaking changes require a new identifier per SEP-2133).',
    input: {
      settings: {
        version: '0.2',
        accept: ['token', 'proof-bundle'],
        future_hint: true,
      },
    },
    expected: {
      valid: true,
      declared: true,
      negotiated_version: '0.2',
      effective_accept: ['token'],
      ignored_settings_fields: ['future_hint'],
      ignored_accept_values: ['proof-bundle'],
    },
  })

  writeCase('capability', 'missing-version-rejected', {
    name: 'capability--missing-version-rejected',
    spec_section: '1.5.4',
    extension: EXT_ID,
    description:
      'A settings object missing `version` (or whose version is not a non-empty string) is malformed. The peer MUST be treated as NOT having declared the extension; this MUST NOT produce a protocol error (extension spec §4.1).',
    input: {
      settings: { signs: ['tool_call'] },
    },
    expected: {
      valid: false,
      declared: false,
      error_raised: false,
      reason: 'version is the only REQUIRED settings field and it is absent',
    },
  })

  writeCase('capability', 'reserved-prefix-rejected', {
    name: 'capability--reserved-prefix-rejected',
    spec_section: '1.5.4',
    extension: EXT_ID,
    description:
      'SEP-2133 identifier grammar: {reverse-dns-prefix}/{extension-name}. No DNS label of a third-party vendor prefix may be `mcp` or `modelcontextprotocol` (reserved for official extensions), and a bare name with no prefix is not a valid identifier. dev.atrib/attribution itself is legal.',
    input: {
      identifiers: [
        'dev.atrib/attribution',
        'io.modelcontextprotocol/attribution',
        'mcp.example/attribution',
        'attribution',
        'dev.atrib/attribution/v2',
      ],
    },
    expected: {
      results: [
        { identifier: 'dev.atrib/attribution', valid: true },
        {
          identifier: 'io.modelcontextprotocol/attribution',
          valid: false,
          reason: 'prefix label "modelcontextprotocol" is reserved',
        },
        { identifier: 'mcp.example/attribution', valid: false, reason: 'prefix label "mcp" is reserved' },
        { identifier: 'attribution', valid: false, reason: 'missing reverse-DNS vendor prefix' },
        { identifier: 'dev.atrib/attribution/v2', valid: false, reason: 'exactly one "/" separator' },
      ],
    },
  })

  // ══ Family 2: gating ═════════════════════════════════════════════════
  //
  // The legacy result _meta is produced by the SAME writeOutboundContext
  // implementation that pre-extension servers use, so the "byte-identical
  // to pre-extension behavior" assertion is pinned against real output.

  const legacyOnlyResult: Record<string, unknown> = { content: [{ type: 'text', text: 'ok' }] }
  writeOutboundContext(legacyOnlyResult, toolCallRecord)
  const legacyMeta = legacyOnlyResult._meta as Record<string, unknown>

  const declaredResultMeta: Record<string, unknown> = {
    ...legacyMeta,
    [EXT_ID]: extensionResultBlock(toolCallRecord, true),
  }
  const declaredTokenOnlyResultMeta: Record<string, unknown> = {
    ...legacyMeta,
    [EXT_ID]: extensionResultBlock(toolCallRecord, false),
  }

  writeCase('gating', 'declared-receipt-present', {
    name: 'gating--declared-receipt-present',
    spec_section: '1.5.4',
    extension: EXT_ID,
    description:
      'The client declared dev.atrib/attribution on this request with accept ["token","record"]. The server MUST write the prefixed result block (token + receipt + full signed record) ALONGSIDE the legacy keys, which stay byte-identical to pre-extension output.',
    input: {
      request_meta: { [CLIENT_CAPABILITIES_META_KEY]: declaredClientCapabilities },
      signed_record: toolCallRecord,
    },
    expected: {
      extension_block_present: true,
      result_meta: declaredResultMeta,
      legacy_keys: { atrib: toolCallToken, tracestate: `atrib=${toolCallToken}`, 'X-Atrib-Chain': toolCallToken },
    },
  })

  writeCase('gating', 'declared-token-only', {
    name: 'gating--declared-token-only',
    spec_section: '1.5.4',
    extension: EXT_ID,
    description:
      'The client declared the extension with accept ["token"]. The receipt block MUST be present and the full record body MUST be omitted (extension spec §6.4).',
    input: {
      request_meta: { [CLIENT_CAPABILITIES_META_KEY]: declaredTokenOnlyClientCapabilities },
      signed_record: toolCallRecord,
    },
    expected: {
      extension_block_present: true,
      record_body_present: false,
      result_meta: declaredTokenOnlyResultMeta,
    },
  })

  writeCase('gating', 'legacy-initialize-declaration', {
    name: 'gating--legacy-initialize-declaration',
    spec_section: '1.5.4',
    extension: EXT_ID,
    description:
      'A legacy MCP session declared dev.atrib/attribution in initialize.capabilities rather than request _meta. The declaration applies to later requests and emits the same prefixed receipt alongside unchanged legacy keys.',
    input: {
      request_meta: {},
      initialize_capabilities: declaredClientCapabilities,
      signed_record: toolCallRecord,
    },
    expected: {
      extension_block_present: true,
      result_meta: declaredResultMeta,
      legacy_initialize_gating: true,
    },
  })

  writeCase('gating', 'undeclared-legacy-only', {
    name: 'gating--undeclared-legacy-only',
    spec_section: '1.5.4',
    extension: EXT_ID,
    description:
      'The client did not declare the extension. The prefixed result block MUST be absent and the result _meta MUST be byte-identical to pre-extension writeOutboundContext output (legacy atrib / tracestate / X-Atrib-Chain keys only).',
    input: {
      request_meta: {},
      signed_record: toolCallRecord,
    },
    expected: {
      extension_block_present: false,
      result_meta: legacyMeta,
      result_meta_jcs_sha256_hex: jcsSha256Hex(legacyMeta),
    },
  })

  writeCase('gating', 'malformed-clientcapabilities-undeclared', {
    name: 'gating--malformed-clientcapabilities-undeclared',
    spec_section: '1.5.4',
    extension: EXT_ID,
    description:
      'io.modelcontextprotocol/clientCapabilities is present but malformed (extensions is an array; the settings value is a string elsewhere). Malformed declarations MUST be treated as undeclared: no receipt, no error injected into the tool path, legacy keys unchanged.',
    input: {
      request_meta: { [CLIENT_CAPABILITIES_META_KEY]: { extensions: [EXT_ID] } },
      signed_record: toolCallRecord,
    },
    expected: {
      extension_block_present: false,
      error_raised: false,
      result_meta: legacyMeta,
    },
  })

  // ══ Family 3: token (Ladder 1) ═══════════════════════════════════════

  writeCase('token', 'extension-key-wins', {
    name: 'token--extension-key-wins',
    spec_section: '1.5.4',
    extension: EXT_ID,
    description:
      'All four inbound carriers are present and decode to four DIFFERENT real record hashes. Ladder 1: the extension key wins; the conflict with legacy carriers is a SHOULD-log warning, never an error.',
    input: {
      request_meta: {
        [EXT_ID]: { token: tokenA, context_id: CTX_A },
        atrib: tokenB,
        tracestate: `atrib=${tokenC}`,
        'X-Atrib-Chain': tokenD,
      },
    },
    expected: {
      resolved_source: 'extension',
      resolved_record_hash_hex: recordHashHex(recordA),
      resolved_creator_key: recordA.creator_key,
      conflict_warning: true,
      error_raised: false,
    },
  })

  writeCase('token', 'malformed-extension-falls-through', {
    name: 'token--malformed-extension-falls-through',
    spec_section: '1.5.4',
    extension: EXT_ID,
    description:
      'The extension block token is malformed (no separator / undecodable). Lenient parse: resolution falls through to _meta.atrib. Malformation is never an error (same posture as D018).',
    input: {
      request_meta: {
        [EXT_ID]: { token: 'this-is-not-a-propagation-token' },
        atrib: tokenB,
        tracestate: `atrib=${tokenC}`,
      },
    },
    expected: {
      resolved_source: 'meta-atrib',
      resolved_record_hash_hex: recordHashHex(recordB),
      resolved_creator_key: recordB.creator_key,
      error_raised: false,
    },
  })

  writeCase('token', 'meta-atrib-over-tracestate', {
    name: 'token--meta-atrib-over-tracestate',
    spec_section: '1.5.4',
    extension: EXT_ID,
    description:
      'No extension block. The pre-extension ladder is unchanged underneath: _meta.atrib beats the tracestate atrib= entry.',
    input: {
      request_meta: {
        atrib: tokenB,
        tracestate: `atrib=${tokenC}`,
      },
    },
    expected: {
      resolved_source: 'meta-atrib',
      resolved_record_hash_hex: recordHashHex(recordB),
    },
  })

  writeCase('token', 'tracestate-over-x-atrib-chain', {
    name: 'token--tracestate-over-x-atrib-chain',
    spec_section: '1.5.4',
    extension: EXT_ID,
    description:
      'No extension block, no _meta.atrib. The tracestate atrib= entry beats the X-Atrib-Chain fallback (§1.5.3: implementations MUST prefer tracestate when both are present).',
    input: {
      request_meta: {
        tracestate: `vendorx=keep,atrib=${tokenC}`,
        'X-Atrib-Chain': tokenD,
      },
    },
    expected: {
      resolved_source: 'tracestate',
      resolved_record_hash_hex: recordHashHex(recordC),
    },
  })

  writeCase('token', 'x-atrib-chain-fallback', {
    name: 'token--x-atrib-chain-fallback',
    spec_section: '1.5.4',
    extension: EXT_ID,
    description: 'Only the X-Atrib-Chain fallback carrier is present. It resolves last (rung 4).',
    input: {
      request_meta: { 'X-Atrib-Chain': tokenD },
    },
    expected: {
      resolved_source: 'x-atrib-chain',
      resolved_record_hash_hex: recordHashHex(recordD),
    },
  })

  writeCase('token', 'all-carriers-stripped', {
    name: 'token--all-carriers-stripped',
    spec_section: '1.5.4',
    extension: EXT_ID,
    description:
      'Every inbound carrier stripped (the documented real-world _meta-loss failure mode). The inbound-token rung resolves to nothing and chain-root resolution continues down the D067 / §1.2.3.1 ladder (autoChain tail > env > mirror inheritance > synthetic genesis). These vectors compose with spec/conformance/1.2.3/multi-producer/. The genesis chain_root for a fresh context is pinned here.',
    input: {
      request_meta: { traceparent: TRACEPARENT },
    },
    expected: {
      resolved_source: null,
      inbound_token_resolved: false,
      chain_resolution_continues_per: 'D067 / §1.2.3.1',
      synthetic_genesis_chain_root_for_traceparent_context: genesisChainRoot(CTX_TRACEPARENT),
      error_raised: false,
    },
  })

  // ══ Family 4: context (Ladder 2) ═════════════════════════════════════

  writeCase('context', 'explicit-argument-wins', {
    name: 'context--explicit-argument-wins',
    spec_section: '1.5.4',
    extension: EXT_ID,
    description:
      'An explicit context_id tool argument beats the extension block (application intent beats transport metadata; D135 posture). On mismatch the argument is used and a warning SHOULD be logged.',
    input: {
      explicit_context_id_argument: CTX_ARGUMENT,
      request_meta: {
        [EXT_ID]: { token: tokenA, context_id: CTX_EXTENSION },
        traceparent: TRACEPARENT,
      },
    },
    expected: {
      resolved_context_id: CTX_ARGUMENT,
      resolved_source: 'argument',
      mismatch_warning: true,
      error_raised: false,
    },
  })

  writeCase('context', 'extension-over-traceparent', {
    name: 'context--extension-over-traceparent',
    spec_section: '1.5.4',
    extension: EXT_ID,
    description:
      'No explicit argument. The extension block context_id beats the traceparent trace-id; the disagreement is a warning. The trace-id rung remains for callers with no extension block.',
    input: {
      request_meta: {
        [EXT_ID]: { context_id: CTX_EXTENSION },
        traceparent: TRACEPARENT,
      },
    },
    expected: {
      resolved_context_id: CTX_EXTENSION,
      resolved_source: 'extension',
      mismatch_warning: true,
      error_raised: false,
    },
  })

  writeCase('context', 'invalid-extension-hex-falls-through', {
    name: 'context--invalid-extension-hex-falls-through',
    spec_section: '1.5.4',
    extension: EXT_ID,
    description:
      'The extension block context_id is not exactly 32 lowercase hex characters. It MUST be ignored (falls through to the traceparent trace-id), never an error.',
    input: {
      request_meta: {
        [EXT_ID]: { context_id: 'NOT-32-LOWERCASE-HEX' },
        traceparent: TRACEPARENT,
      },
    },
    expected: {
      resolved_context_id: CTX_TRACEPARENT,
      resolved_source: 'traceparent',
      error_raised: false,
    },
  })

  writeCase('context', 'no-carrier-env-fallthrough', {
    name: 'context--no-carrier-env-fallthrough',
    spec_section: '1.5.4',
    extension: EXT_ID,
    description:
      'No explicit argument, no extension block, no (valid) traceparent. Per-request transport resolution yields nothing; producers then apply the D078/D083 env-and-file registry, whose internal ordering is defined by those decisions, not by the extension. At the transport layer the resolved context is undefined.',
    input: {
      request_meta: { traceparent: `00-${'0'.repeat(32)}-00f067aa0ba902b7-01` },
    },
    expected: {
      resolved_context_id: null,
      resolved_source: 'env-registry-fallthrough',
      producer_side_resolution_per: 'D078/D083',
      error_raised: false,
    },
  })

  writeCase('context', 'unknown-fields-ignored', {
    name: 'context--unknown-fields-ignored',
    spec_section: '1.5.4',
    extension: EXT_ID,
    description:
      'The v0.1 block carries EXACTLY two defined fields. Unknown extra fields — including session_token and provenance_token sent by a future or nonconforming peer — MUST be ignored and MUST NOT set any field of any signed record. Both defined fields still resolve normally.',
    input: {
      request_meta: {
        [EXT_ID]: {
          token: tokenA,
          context_id: CTX_EXTENSION,
          session_token: 'sess-token-from-nonconforming-peer',
          provenance_token: 'AAAAAAAAAAAAAAAAAAAAAA',
          future_field: 42,
        },
      },
    },
    expected: {
      resolved_context_id: CTX_EXTENSION,
      resolved_source: 'extension',
      resolved_record_hash_hex: recordHashHex(recordA),
      ignored_fields: ['future_field', 'provenance_token', 'session_token'],
      record_field_effects: ['context_id'],
      error_raised: false,
    },
  })

  // ══ Family 5: receipt ════════════════════════════════════════════════

  writeCase('receipt', 'consistent', {
    name: 'receipt--consistent',
    spec_section: '1.5.4',
    extension: EXT_ID,
    description:
      'A well-formed receipt over a REAL Ed25519-signed tool_call record. receipt.token equals encodeToken(record); record_hash recomputes from sha256(JCS(record)); creator_key matches the signer; context_id and chain_root match the record; the record signature verifies independently (Tier-3).',
    input: {
      result_block: extensionResultBlock(toolCallRecord, true),
      signer_seed_hex: hex(SERVER_SEED),
      tool_args: toolArgs,
    },
    expected: {
      receipt_valid: true,
      token: toolCallToken,
      record_hash: 'sha256:' + recordHashHex(toolCallRecord),
      creator_key: serverKey,
      context_id: CTX_SERVER,
      chain_root: genesisChainRoot(CTX_SERVER),
      args_hash_recomputes_from_tool_args: true,
      record_signature_verifies: true,
    },
  })

  const mismatchedBlock = extensionResultBlock(toolCallRecord, true)
  ;(mismatchedBlock.receipt as Record<string, unknown>).record_hash =
    'sha256:' + recordHashHex(otherToolCallRecord)
  writeCase('receipt', 'hash-mismatch-flagged', {
    name: 'receipt--hash-mismatch-flagged',
    spec_section: '1.5.4',
    extension: EXT_ID,
    description:
      "The receipt's record_hash names a DIFFERENT (also real, also signed) record than the attached record body and token. Consumers MUST treat the receipt as invalid and discard it; receipt invalidity never invalidates the tool result itself.",
    input: {
      result_block: mismatchedBlock,
    },
    expected: {
      receipt_valid: false,
      mismatched_fields: ['record_hash'],
      attached_record_hash: 'sha256:' + recordHashHex(toolCallRecord),
      claimed_record_hash: 'sha256:' + recordHashHex(otherToolCallRecord),
      tool_result_invalidated: false,
    },
  })

  writeCase('receipt', 'log-submission-nonblocking', {
    name: 'receipt--log-submission-nonblocking',
    spec_section: '1.5.4',
    extension: EXT_ID,
    description:
      'log_submission is a queue status, never an awaited proof (§5.3.5, critical invariant 4). A receipt with status "queued" is valid BEFORE any submission settles; no inclusion proof is required to accept the receipt. The closed status enum is pinned.',
    input: {
      result_block: extensionResultBlock(toolCallRecord, false),
    },
    expected: {
      receipt_valid: true,
      log_submission: 'queued',
      allowed_statuses: [...LOG_SUBMISSION_STATUSES],
      proof_bundle_required: false,
      awaiting_submission_forbidden: true,
    },
  })

  // ══ Family 6: degradation ════════════════════════════════════════════

  const passthroughResult = { content: [{ type: 'text', text: 'primary tool result' }] }

  writeCase('degradation', 'signing-failure-passthrough', {
    name: 'degradation--signing-failure-passthrough',
    spec_section: '1.5.4',
    extension: EXT_ID,
    description:
      'Forced signing failure (§5.8): the tool result MUST be returned byte-identical to passthrough — no extension block, no legacy keys added by the failed attempt, no thrown error. The passthrough result is pinned by its JCS sha256.',
    input: {
      request_meta: { [CLIENT_CAPABILITIES_META_KEY]: declaredClientCapabilities },
      tool_result: passthroughResult,
      forced_failure: 'signing',
    },
    expected: {
      result_jcs_sha256_hex: jcsSha256Hex(passthroughResult),
      extension_block_present: false,
      error_raised: false,
    },
  })

  writeCase('degradation', 'capability-read-failure-passthrough', {
    name: 'degradation--capability-read-failure-passthrough',
    spec_section: '1.5.4',
    extension: EXT_ID,
    description:
      'Forced capability-read failure (§5.8): reading/parsing the client declaration throws. The peer is treated as undeclared and the tool result is returned byte-identical to passthrough with no error.',
    input: {
      tool_result: passthroughResult,
      forced_failure: 'capability-read',
    },
    expected: {
      result_jcs_sha256_hex: jcsSha256Hex(passthroughResult),
      extension_block_present: false,
      error_raised: false,
    },
  })

  writeCase('degradation', 'missing-meta-never-blocks', {
    name: 'degradation--missing-meta-never-blocks',
    spec_section: '1.5.4',
    extension: EXT_ID,
    description:
      'A request with no _meta at all (total _meta loss at an intermediary). The tool call MUST proceed; both ladders resolve to nothing; the next record is a genesis record per §1.2.3. Missing _meta never blocks, delays, or alters the call.',
    input: {
      request_params: { name: 'search_web', arguments: { query: 'no meta here' } },
    },
    expected: {
      inbound_token_resolved: false,
      resolved_context_id: null,
      tool_call_proceeds: true,
      error_raised: false,
    },
  })

  // ── Manifest ───────────────────────────────────────────────────────
  const manifest = {
    spec_section: '1.5.4',
    spec_title: 'MCP Transport: params._meta — dev.atrib/attribution extension carriage',
    extension_identifier: EXT_ID,
    extension_version: EXT_VERSION,
    extension_spec: 'docs/extensions/dev.atrib-attribution/v0.1.md',
    decision_link: 'P049 (mcp-extension ADR)',
    generated_at: REFERENCE_TIME_MS,
    generator: 'packages/log-dev/scripts/generate-conformance-mcp-extension.ts',
    ladder_1_token: [
      '_meta["dev.atrib/attribution"].token',
      '_meta.atrib',
      '_meta.tracestate atrib= entry',
      '_meta["X-Atrib-Chain"]',
    ],
    ladder_2_context_identity: [
      'explicit context_id tool argument',
      '_meta["dev.atrib/attribution"].context_id',
      '_meta.traceparent trace-id',
      'D078/D083 env-file registry',
      'undefined',
    ],
    log_submission_statuses: [...LOG_SUBMISSION_STATUSES],
    cases: caseFiles.map(({ file, name }) => ({ file, name })),
    keys: { server_pubkey: serverKey },
    note:
      'The six families collectively pin the extension contract: settings validity and the reserved-prefix rule (capability), receipt opt-in gating with byte-identical legacy fallback (gating), Ladder 1 inbound token precedence composing with the D067 chain ladder (token), Ladder 2 context-identity precedence above the D078/D083 registry (context), receipt consistency against real signed records with non-blocking log submission (receipt), and §5.8 silent passthrough under forced failures (degradation). No signed byte changes anywhere in this corpus.',
  }

  writeFileSync(join(CORPUS_ROOT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')

  console.log(`generated ${caseFiles.length} cases at ${CORPUS_ROOT}`)
}

main().catch((e: unknown) => {
  console.error(e)
  process.exit(1)
})
