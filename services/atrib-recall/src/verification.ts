// SPDX-License-Identifier: Apache-2.0

/**
 * The legacy `atrib-verify` tool and the `recall` verb's `verification`
 * parameter: verify counterparty handoff evidence before the receiving
 * agent signs a follow-up that cites it through informed_by. The surface
 * is deliberately thin. @atrib/verify owns the actual cryptographic
 * checks, packet extraction, and rejection reasons.
 *
 * Moved here from @atrib/verify-mcp per the attest/recall rename;
 * @atrib/verify-mcp re-exports this module so existing imports keep
 * working.
 *
 * Dependency posture: @atrib/verify is an OPTIONAL PEER of @atrib/recall,
 * loaded lazily on first use. Its module closure transitively reaches the
 * D090/D091 JOSE/SD-JWT evidence stack, which most reads never need;
 * pulling it into every recall install would contradict the primitive's
 * narrow framing. When the peer is unresolvable, the read itself still
 * succeeds and verification degrades to a typed `verifier_unavailable`
 * result per the §5.8 degradation contract. The daemon / primitives
 * runtime and the @atrib/verify-mcp shim always bundle the verifier, so
 * their behavior is unchanged.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import {
  extractRecordHashesFromMcpResult,
  logReadPrimitiveCall,
  SHA256_REF_PATTERN,
} from '@atrib/mcp'
import type {
  HandoffClaimVerification,
  HandoffEvidenceEntry,
  HandoffEvidencePacket,
  HandoffVerificationResult,
} from '@atrib/verify'

const HEX_32_PATTERN = /^[0-9a-f]{32}$/

type VerifyModule = typeof import('@atrib/verify')

let verifyModulePromise: Promise<VerifyModule | null> | null = null

/**
 * Resolve the optional @atrib/verify peer once per process. Unresolvable
 * peers log one `atrib:`-prefixed diagnostic and degrade; they never throw
 * into a read path.
 */
export function loadVerifyModule(): Promise<VerifyModule | null> {
  verifyModulePromise ??= import('@atrib/verify').then(
    (mod) => mod,
    (error: unknown) => {
      try {
        console.error(
          'atrib: optional peer @atrib/verify is not installed; verification degrades to verifier_unavailable',
          error instanceof Error ? error.message : String(error),
        )
      } catch {
        // Diagnostics must never affect the read path.
      }
      return null
    },
  )
  return verifyModulePromise
}

/** Test hook: reset the memoized peer resolution. */
export function __resetVerifyModuleForTests(loader?: () => Promise<VerifyModule | null>): void {
  verifyModulePromise = loader ? loader() : null
}

export const VerifyInput = z.object({
  packet: z
    .unknown()
    .optional()
    .describe(
      'Private continuation or handoff packet carrying records, proof bundles, local mirror sidecars, and optional trust policy.',
    ),
  records: z
    .array(z.unknown())
    .optional()
    .describe(
      'Evidence entries, usually parsed D062 local mirror envelopes or packet records. Used when packet is omitted.',
    ),
  claims: z
    .array(z.unknown())
    .optional()
    .describe(
      'Alias for records. Each entry can be a bare AtribRecord or an envelope with record, proof, and _local sidecar.',
    ),
  required_record_hashes: z
    .array(z.string().regex(SHA256_REF_PATTERN))
    .optional()
    .describe(
      'Record hashes the receiving agent expected. Missing entries are preserved as verifier rejections.',
    ),
  trusted_creator_keys: z
    .array(z.string().min(1))
    .optional()
    .describe(
      'Allowed creator_key values for upstream records. When set, records from other signers are rejected.',
    ),
  allowed_context_ids: z
    .array(z.string().regex(HEX_32_PATTERN))
    .optional()
    .describe(
      'Allowed upstream context_id values. When set, records from other contexts are rejected.',
    ),
  require_body: z
    .boolean()
    .optional()
    .describe('Require private body material from body, args/result, or D062 _local content.'),
  require_body_commitment: z
    .boolean()
    .optional()
    .describe(
      'Require args_hash or result_hash on the signed record so private body material can be checked.',
    ),
  require_log_inclusion: z
    .boolean()
    .optional()
    .describe(
      'Require a supplied proof bundle whose inclusion path verifies against the checkpoint root.',
    ),
  log_public_key_b64: z
    .string()
    .optional()
    .describe(
      'Optional trusted log Ed25519 public key, base64 or base64url encoded. When supplied, checkpoint signatures are verified.',
    ),
  now_ms: z
    .number()
    .optional()
    .describe('Verifier wall-clock override in milliseconds. Mostly for deterministic tests.'),
  max_age_ms: z
    .number()
    .optional()
    .describe(
      'Freshness window. Records older than this, or dated in the future, are rejected as stale.',
    ),
})

export type AtribVerifyInput = z.infer<typeof VerifyInput>

export interface AtribVerifyServer {
  mcp: McpServer
}

export interface AtribVerifyOutput {
  primitive: 'atrib-verify'
  all_accepted: boolean
  accepted_record_hashes: string[]
  accepted: CompactHandoffClaim[]
  rejected: CompactHandoffClaim[]
}

/**
 * The `verification` block attached to `recall` verb responses. Degraded
 * verification never blocks a read: when the optional @atrib/verify peer
 * is unresolvable the block carries status verifier_unavailable and the
 * read result is unchanged.
 */
export type RecallVerificationBlock =
  | { status: 'ok'; result: AtribVerifyOutput }
  | { status: 'verifier_unavailable'; reason: string }

interface CompactHandoffClaim {
  record_hash: string
  accepted: boolean
  rejection_reasons: string[]
  warnings: string[]
  signature_ok: boolean | null
  computed_record_hash: string | null
  signer_trusted: boolean | null
  context_allowed: boolean | null
  record_context_id?: string
  record_creator_key?: string
  record_timestamp?: number
  body?: HandoffClaimVerification['body']
  proof?: HandoffClaimVerification['proof']
}

function decodeLogPublicKey(value: string | undefined): Uint8Array | undefined {
  if (!value) return undefined
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  const decoded = new Uint8Array(Buffer.from(padded, 'base64'))
  if (decoded.length !== 32) {
    throw new Error(`log_public_key_b64 must decode to 32 bytes, got ${decoded.length}`)
  }
  return decoded
}

function packetFromInput(input: AtribVerifyInput): HandoffEvidencePacket | HandoffEvidenceEntry[] {
  if (input.packet !== undefined) return input.packet as HandoffEvidencePacket
  return {
    records: (input.records ?? input.claims ?? []) as HandoffEvidenceEntry[],
    required_record_hashes: input.required_record_hashes,
    trusted_creator_keys: input.trusted_creator_keys,
    allowed_context_ids: input.allowed_context_ids,
    max_age_ms: input.max_age_ms,
  }
}

function compactClaim(claim: HandoffClaimVerification): CompactHandoffClaim {
  const out: CompactHandoffClaim = {
    record_hash: claim.record_hash,
    accepted: claim.accepted,
    rejection_reasons: claim.rejection_reasons,
    warnings: claim.warnings,
    signature_ok: claim.signature_ok,
    computed_record_hash: claim.computed_record_hash,
    signer_trusted: claim.signer_trusted,
    context_allowed: claim.context_allowed,
  }
  if (claim.record) {
    out.record_context_id = claim.record.context_id
    out.record_creator_key = claim.record.creator_key
    out.record_timestamp = claim.record.timestamp
  }
  if (claim.body) out.body = claim.body
  if (claim.proof) out.proof = claim.proof
  return out
}

function compactResult(result: HandoffVerificationResult): AtribVerifyOutput {
  return {
    primitive: 'atrib-verify',
    all_accepted: result.all_accepted,
    accepted_record_hashes: result.accepted_record_hashes,
    accepted: result.accepted.map(compactClaim),
    rejected: result.rejected.map(compactClaim),
  }
}

/**
 * Run the Pattern 3 handoff-claim acceptance checks. Throws when the
 * optional @atrib/verify peer is unresolvable (the @atrib/verify-mcp shim
 * and the daemon topology always bundle it, so their behavior is
 * unchanged); callers that must not fail use tryHandleAtribVerify.
 */
export async function handleAtribVerify(input: AtribVerifyInput): Promise<AtribVerifyOutput> {
  const verify = await loadVerifyModule()
  if (!verify) {
    throw new Error(
      'atrib: @atrib/verify is not installed; install it (optional peer of @atrib/recall) to run handoff verification',
    )
  }
  const packet = packetFromInput(input)
  const claims = verify.handoffClaimsFromEvidencePacket(packet, {
    required_record_hashes: input.required_record_hashes,
    trusted_creator_keys: input.trusted_creator_keys,
    allowed_context_ids: input.allowed_context_ids,
    max_age_ms: input.max_age_ms,
  })
  const result = await verify.verifyHandoffClaims(claims, {
    trusted_creator_keys: input.trusted_creator_keys,
    allowed_context_ids: input.allowed_context_ids,
    require_body: input.require_body === true,
    require_body_commitment: input.require_body_commitment === true,
    require_log_inclusion: input.require_log_inclusion === true,
    log_public_key: decodeLogPublicKey(input.log_public_key_b64),
    now_ms: input.now_ms,
    max_age_ms: input.max_age_ms,
  })
  return compactResult(result)
}

/**
 * Degradation-safe wrapper for the `recall` verb's `verification`
 * parameter: unresolvable peer -> typed verifier_unavailable block, never
 * a thrown error into the read path.
 */
export async function tryHandleAtribVerify(
  input: AtribVerifyInput,
): Promise<RecallVerificationBlock> {
  const verify = await loadVerifyModule()
  if (!verify) {
    return {
      status: 'verifier_unavailable',
      reason:
        '@atrib/verify (optional peer of @atrib/recall) is not installed; the read result is unaffected',
    }
  }
  return { status: 'ok', result: await handleAtribVerify(input) }
}

/** Register the legacy `atrib-verify` tool on a server. */
export function registerVerifyTool(mcp: McpServer): void {
  mcp.registerTool(
    'atrib-verify',
    {
      description:
        'Verify counterparty handoff evidence before linking follow-up work through informed_by. ' +
        "Legacy alias: new callers should prefer the `recall` tool's `verification` parameter.",
      inputSchema: VerifyInput.shape,
    },
    async (rawInput) =>
      logReadPrimitiveCall(
        'atrib-verify',
        rawInput,
        async () => {
          const input = VerifyInput.parse(rawInput)
          const result = await handleAtribVerify(input)
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          }
        },
        extractRecordHashesFromMcpResult,
      ),
  )
}

/**
 * Wire up the legacy atrib-verify MCP server. Mounts `atrib-verify` plus
 * the `recall` verb (alias-window rule W1). The @atrib/verify-mcp package
 * re-exports this factory.
 */
export async function createAtribVerifyServer(): Promise<AtribVerifyServer> {
  const mcp = new McpServer({ name: 'atrib-verify', version: '0.1.0' })
  registerVerifyTool(mcp)
  const { registerRecallVerbTool } = await import('./recall-verb.js')
  registerRecallVerbTool(mcp)
  return { mcp }
}
