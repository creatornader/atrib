// SPDX-License-Identifier: Apache-2.0

/**
 * atrib-verify MCP server.
 *
 * Exposes the seventh atrib cognitive primitive: verify counterparty handoff
 * evidence before the receiving agent signs a follow-up that cites it through
 * informed_by. The server is deliberately thin. @atrib/verify owns the actual
 * cryptographic checks, packet extraction, and rejection reasons.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import {
  extractRecordHashesFromMcpResult,
  logReadPrimitiveCall,
  SHA256_REF_PATTERN,
} from '@atrib/mcp'
import {
  handoffClaimsFromEvidencePacket,
  verifyHandoffClaims,
  type HandoffClaimVerification,
  type HandoffEvidenceEntry,
  type HandoffEvidencePacket,
  type HandoffVerificationResult,
} from '@atrib/verify'

const HEX_32_PATTERN = /^[0-9a-f]{32}$/

const VerifyInput = z.object({
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

export async function handleAtribVerify(input: AtribVerifyInput): Promise<AtribVerifyOutput> {
  const packet = packetFromInput(input)
  const claims = handoffClaimsFromEvidencePacket(packet, {
    required_record_hashes: input.required_record_hashes,
    trusted_creator_keys: input.trusted_creator_keys,
    allowed_context_ids: input.allowed_context_ids,
    max_age_ms: input.max_age_ms,
  })
  const result = await verifyHandoffClaims(claims, {
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

export async function createAtribVerifyServer(): Promise<AtribVerifyServer> {
  const mcp = new McpServer({ name: 'atrib-verify', version: '0.1.0' })

  mcp.registerTool(
    'atrib-verify',
    {
      description:
        'Verify counterparty handoff evidence before linking follow-up work through informed_by.',
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

  return { mcp }
}
