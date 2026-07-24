// SPDX-License-Identifier: Apache-2.0

// The `attest` tool: atrib's write verb. One handler signs observations,
// annotations, and revisions; the declared relationship moves from the
// tool-name axis to the `ref` argument. Every call delegates to handleEmit,
// so attest-signed records are byte-identical in canonical form to records
// signed through the legacy emit / atrib-annotate / atrib-revise names.
//
// Exact ref -> record mapping (exhaustive; anything else is a typed refusal
// and nothing is signed):
//
//   ref absent                                -> observation (0x03), no relationship field
//   { kind: 'annotates', target }             -> annotation (0x05), signed annotates = target
//   { kind: 'revises', target, reason }       -> revision   (0x06), signed revises = target
//
// The relationship target is also composed into the local content body
// (matching what atrib-annotate / atrib-revise compose today), so the
// D099 default args_hash commitment is byte-identical across both names.

import { z } from 'zod'
import { EVENT_TYPE_ANNOTATION_URI, EVENT_TYPE_REVISION_URI, SHA256_REF_PATTERN } from '@atrib/mcp'

const HEX_32_PATTERN = /^[0-9a-f]{32}$/
// 16 bytes encoded as base64url with no padding = 22 chars per spec §1.2.6.
const PROVENANCE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/

const OBSERVATION_URI = 'https://atrib.dev/v1/types/observation'

export const AttestRef = z.object({
  kind: z
    .enum(['annotates', 'revises'])
    .describe(
      "Declared-relationship kind. 'annotates' marks a past record's importance " +
        "and meaning (spec §1.2.7 / D058); 'revises' supersedes a prior position " +
        'with a stated reason (spec §1.2.9 / D059). Omit `ref` entirely for a ' +
        'plain observation.',
    ),
  target: z
    .string()
    .regex(SHA256_REF_PATTERN)
    .describe(
      "'sha256:<64-hex>' record_hash the relationship points at. The target can " +
        "be any prior record (yours or another agent's).",
    ),
  reason: z
    .string()
    .min(1)
    .max(4096)
    .optional()
    .describe(
      "Why the position changed. REQUIRED when kind is 'revises'; composed into " +
        'the content body exactly as atrib-revise composes it today.',
    ),
})

export const AttestInput = z.object({
  content: z
    .record(z.string(), z.unknown())
    .describe(
      'Semantic content of the cognitive event. For a plain observation: ' +
        '{ what: string, why_noted?: string, topics?: string[] }. ' +
        "For ref.kind='annotates': { importance: 'critical'|'high'|'medium'|'low'|'noise', summary: string, topics?: string[] }. " +
        "For ref.kind='revises': { prior_position: string, new_position: string }. " +
        'The relationship target (and reason, for revises) is composed in from `ref`; ' +
        'do not duplicate it here unless it matches `ref` exactly.',
    ),
  ref: AttestRef.optional().describe(
    'Optional declared relationship. Absent -> observation. ' +
      "{ kind: 'annotates', target } -> annotation. " +
      "{ kind: 'revises', target, reason } -> revision. " +
      'The event_type vocabulary, required args, and graph effects (ANNOTATES / ' +
      'REVISES edges per spec §3.2.4) are unchanged from the legacy tool names.',
  ),
  context_id: z
    .string()
    .regex(HEX_32_PATTERN)
    .optional()
    .describe(
      '32-hex context_id. If omitted, resolution follows the same D078/D083 ladder ' +
        'as the legacy write names; a fresh genesis context_id is the final fallback.',
    ),
  informed_by: z
    .array(z.string().regex(SHA256_REF_PATTERN))
    .optional()
    .describe(
      "Array of 'sha256:<64-hex>' record_hashes that informed this event. Composes " +
        'freely with any `ref` and keeps D113 omit-unvalidated defaults. Sorted ' +
        'lexicographically before signing per §1.2.5.',
    ),
  allow_unresolved_informed_by: z
    .boolean()
    .optional()
    .describe(
      'Set true only when the caller deliberately wants to sign dangling informed_by refs.',
    ),
  chain_root: z
    .string()
    .regex(SHA256_REF_PATTERN)
    .optional()
    .describe(
      'Caller-managed chain_root of the immediately preceding record in this context_id. ' +
        'Same semantics as the legacy emit tool; requires context_id.',
    ),
  provenance_token: z
    .string()
    .regex(PROVENANCE_TOKEN_PATTERN)
    .optional()
    .describe(
      '22-char base64url cross-session causal anchor per spec §1.2.6 / D044. ' +
        'Genesis-record-only; refused otherwise.',
    ),
  tool_name: z
    .string()
    .min(1)
    .max(64)
    .optional()
    .describe('Optional §8.2 tool_name disclosure, unchanged from the legacy emit tool.'),
  args_hash: z
    .string()
    .regex(SHA256_REF_PATTERN)
    .optional()
    .describe(
      'Optional §8.3 args_hash commitment override. When omitted, attest signs ' +
        'sha256(JCS(content)) per D099, identical to the legacy write names.',
    ),
  args_salt: z
    .string()
    .regex(/^[A-Za-z0-9_-]{22}$/)
    .optional()
    .describe('Optional base64url 16-byte salt paired with args_hash per §8.3.'),
  result_hash: z
    .string()
    .regex(SHA256_REF_PATTERN)
    .optional()
    .describe('Optional §8.3 result_hash commitment, unchanged from the legacy emit tool.'),
  result_salt: z
    .string()
    .regex(/^[A-Za-z0-9_-]{22}$/)
    .optional()
    .describe('Optional base64url 16-byte salt paired with result_hash per §8.3.'),
  producer: z
    .string()
    .min(1)
    .max(128)
    .optional()
    .describe(
      "Optional sidecar label override routed to `_local.producer`. Defaults to 'atrib-attest'. " +
        'Sidecar metadata only; the signed record bytes are unchanged (§5.9.3).',
    ),
})

export type AttestInputT = z.infer<typeof AttestInput>

/**
 * The EmitInput-shaped object handleEmit accepts, plus the resolved
 * event_type so callers can surface it in the attest result.
 */
export interface MappedAttestInput {
  event_type: string
  emitInput: {
    event_type: string
    content: Record<string, unknown>
    context_id?: string
    informed_by?: string[]
    allow_unresolved_informed_by?: boolean
    chain_root?: string
    provenance_token?: string
    annotates?: string
    revises?: string
    tool_name?: string
    args_hash?: string
    args_salt?: string
    result_hash?: string
    result_salt?: string
  }
}

export interface AttestMappingRefusal {
  refusals: string[]
}

/**
 * Map an AttestInput onto the legacy EmitInput shape. Pure; no signing.
 * Returns refusals instead of throwing so the tool surface can return the
 * same isError shape the legacy write names use (§5.8: refuse loudly,
 * never sign a malformed record).
 *
 * Content composition matches the legacy specialized writers exactly so
 * the D099 default args_hash is byte-identical:
 *   annotates: content := { annotates: target, ...content }
 *   revises:   content := { revises: target, ...content, reason }
 * A caller-supplied content.annotates / content.revises / content.reason
 * that contradicts `ref` is a refusal, not a silent overwrite.
 */
export function mapAttestInput(input: AttestInputT): MappedAttestInput | AttestMappingRefusal {
  const base = {
    ...(input.context_id ? { context_id: input.context_id } : {}),
    ...(input.informed_by ? { informed_by: input.informed_by } : {}),
    ...(input.allow_unresolved_informed_by !== undefined
      ? { allow_unresolved_informed_by: input.allow_unresolved_informed_by }
      : {}),
    ...(input.chain_root ? { chain_root: input.chain_root } : {}),
    ...(input.provenance_token ? { provenance_token: input.provenance_token } : {}),
    ...(input.tool_name ? { tool_name: input.tool_name } : {}),
    ...(input.args_hash ? { args_hash: input.args_hash } : {}),
    ...(input.args_salt ? { args_salt: input.args_salt } : {}),
    ...(input.result_hash ? { result_hash: input.result_hash } : {}),
    ...(input.result_salt ? { result_salt: input.result_salt } : {}),
  }

  if (!input.ref) {
    const conflict = contentRefConflicts(input.content, undefined)
    if (conflict) return { refusals: [conflict] }
    return {
      event_type: OBSERVATION_URI,
      emitInput: { event_type: OBSERVATION_URI, content: input.content, ...base },
    }
  }

  if (input.ref.kind === 'annotates') {
    const conflict = contentRefConflicts(input.content, input.ref)
    if (conflict) return { refusals: [conflict] }
    const content = { annotates: input.ref.target, ...input.content }
    return {
      event_type: EVENT_TYPE_ANNOTATION_URI,
      emitInput: {
        event_type: EVENT_TYPE_ANNOTATION_URI,
        content,
        annotates: input.ref.target,
        ...base,
      },
    }
  }

  // input.ref.kind === 'revises'
  if (!input.ref.reason) {
    return {
      refusals: [
        "ref.reason is required when ref.kind is 'revises' (the reason lives in content, as atrib-revise composes it today)",
      ],
    }
  }
  const conflict = contentRefConflicts(input.content, input.ref)
  if (conflict) return { refusals: [conflict] }
  const content = { revises: input.ref.target, ...input.content, reason: input.ref.reason }
  return {
    event_type: EVENT_TYPE_REVISION_URI,
    emitInput: {
      event_type: EVENT_TYPE_REVISION_URI,
      content,
      revises: input.ref.target,
      ...base,
    },
  }
}

export function isAttestMappingRefusal(
  mapped: MappedAttestInput | AttestMappingRefusal,
): mapped is AttestMappingRefusal {
  return 'refusals' in mapped
}

/**
 * Detect contradictions between caller-supplied content fields and the
 * declared `ref`. Duplicates that MATCH the ref are tolerated (the caller
 * pre-composed the legacy content shape); contradictions refuse.
 */
function contentRefConflicts(
  content: Record<string, unknown>,
  ref: z.infer<typeof AttestRef> | undefined,
): string | null {
  const contentAnnotates = content['annotates']
  const contentRevises = content['revises']
  const contentReason = content['reason']

  if (!ref) {
    if (contentAnnotates !== undefined || contentRevises !== undefined) {
      return (
        'content carries a relationship field (annotates/revises) but no ref was declared; ' +
        'declare ref: { kind, target } instead of embedding the relationship in content'
      )
    }
    return null
  }

  if (ref.kind === 'annotates') {
    if (contentRevises !== undefined) {
      return "content.revises is FORBIDDEN when ref.kind is 'annotates'"
    }
    if (contentAnnotates !== undefined && contentAnnotates !== ref.target) {
      return `content.annotates (${String(contentAnnotates)}) contradicts ref.target (${ref.target})`
    }
    return null
  }

  // revises
  if (contentAnnotates !== undefined) {
    return "content.annotates is FORBIDDEN when ref.kind is 'revises'"
  }
  if (contentRevises !== undefined && contentRevises !== ref.target) {
    return `content.revises (${String(contentRevises)}) contradicts ref.target (${ref.target})`
  }
  if (contentReason !== undefined && ref.reason !== undefined && contentReason !== ref.reason) {
    return 'content.reason contradicts ref.reason'
  }
  return null
}
