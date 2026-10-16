// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod'
import { base64urlDecode, base64urlEncode } from './base64url.js'
import { createJsonCommitment } from './commitment.js'

export const EVIDENCE_PREFIX = 'https://atrib.dev/evidence/v1/'
export const DECLARED_METHOD = `${EVIDENCE_PREFIX}method/declared`
export const HOST_CAPTURE_METHOD = `${EVIDENCE_PREFIX}method/host-capture/1`
const uri = z
  .string()
  .min(1)
  .refine((value) => /^[a-z][a-z0-9+.-]*:/i.test(value))
const text = z.string().min(1)
export function isEvidenceLocator(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false
  if (/\bbearer\s+/i.test(value)) return false
  try {
    const parsed = new URL(value, 'https://atrib.invalid/')
    return (
      !parsed.username &&
      !parsed.password &&
      ![...parsed.searchParams.keys(), ...new URLSearchParams(parsed.hash.slice(1)).keys()].some(
        (key) =>
          /token|signature|credential|secret|password|authorization|api[_-]?key|^sig$|^key$/i.test(
            key,
          ),
      )
    )
  } catch {
    return true
  }
}
const locator = text.refine(isEvidenceLocator)
const time = z.number().int().nonnegative().safe()
export const hashSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/)
const key = z.string().regex(/^[A-Za-z0-9_-]{43}$/)
export const scopedIdSchema = z.strictObject({ namespace: uri, id: text })
export const descriptorSchema = z.strictObject({
  service: uri,
  operation: text,
  resource: scopedIdSchema,
  parameters: z.json(),
  version: text.optional(),
})
const source = z
  .strictObject({
    kind: z.enum(['declared', 'boundary', 'query', 'receipt', 'manifest']),
    identity: scopedIdSchema,
    method: uri,
    observed_at: time.optional(),
    locator: locator.optional(),
  })
  .refine((value) => value.kind !== 'declared' || value.observed_at === undefined)
const basis = z.array(
  z.strictObject({
    relation: z.enum(['authority', 'source', 'binding', 'expected', 'captured']),
    kind: z.enum(['record', 'artifact']),
    hash: hashSchema,
    media_type: text.optional(),
    locator: locator.optional(),
  }),
)
const kernel = {
  nonce: z
    .string()
    .regex(/^[A-Za-z0-9_-]{22,}$/)
    .refine((value) => {
      if (value.length % 4 === 1) return false
      const bytes = base64urlDecode(value)
      return bytes.length >= 16 && base64urlEncode(bytes) === value
    }),
  subject: scopedIdSchema,
  source,
  basis,
}
const target = z.strictObject({ record_hash: hashSchema })
const request = z.strictObject({ descriptor: descriptorSchema, execution: scopedIdSchema })
const authorization = z
  .strictObject({
    decision: z.enum(['allow', 'deny', 'escalate']),
    authority_version: text,
    not_before: time,
    expires_at: time,
  })
  .refine((value) => value.not_before < value.expires_at)
const execution = z
  .strictObject({
    phase: z.enum(['dispatch', 'response', 'failure']),
    descriptor: descriptorSchema,
    execution: scopedIdSchema,
    native_invocation: scopedIdSchema,
    delivery: scopedIdSchema,
    destination_request: scopedIdSchema.optional(),
    outcome: z.enum(['pending', 'success', 'error', 'unknown']),
  })
  .refine((value) =>
    value.phase === 'dispatch'
      ? value.outcome === 'pending'
      : value.phase === 'response'
        ? ['success', 'error'].includes(value.outcome)
        : ['error', 'unknown'].includes(value.outcome),
  )
const capture = z.strictObject({
  phase: z.literal('capture'),
  occurrence: scopedIdSchema,
  artifact_hash: hashSchema,
})
const report = z.strictObject({ status: z.enum(['success', 'failure', 'unknown']), text })
const effect = z.strictObject({
  object: scopedIdSchema,
  payload_hash: hashSchema,
  version: z.strictObject({ kind: z.enum(['native', 'snapshot']), value: text }),
  state: z.json(),
  binding: z
    .strictObject({ observation_record: hashSchema, destination_request: scopedIdSchema })
    .optional(),
})
const coverage = z
  .strictObject({
    surface: scopedIdSchema,
    start: text,
    end: text,
    expected: z.array(scopedIdSchema),
    captured: z.array(scopedIdSchema),
    gaps: z.array(z.strictObject({ id: scopedIdSchema.optional(), reason: text })),
  })
  .refine((value) =>
    [value.expected, value.captured].every(
      (ids) => new Set(ids.map((id) => JSON.stringify([id.namespace, id.id]))).size === ids.length,
    ),
  )
export const evidenceBodySchemas = {
  request: z
    .strictObject({ ...kernel, assertion: request })
    .refine((value) => ['declared', 'boundary'].includes(value.source.kind)),
  authorization: z
    .strictObject({ ...kernel, assertion: authorization, target })
    .refine(
      (value) =>
        value.source.kind === 'declared' && value.basis.some((ref) => ref.relation === 'authority'),
    ),
  observation: z.union([
    z
      .strictObject({ ...kernel, assertion: execution, target })
      .refine(
        (value) =>
          value.source.kind === 'boundary' &&
          value.source.observed_at !== undefined &&
          value.basis.some((ref) => ref.relation === 'source'),
      ),
    z
      .strictObject({ ...kernel, assertion: capture })
      .refine(
        (value) =>
          value.source.kind === 'boundary' &&
          value.source.observed_at !== undefined &&
          value.subject.namespace === value.assertion.occurrence.namespace &&
          value.subject.id === value.assertion.occurrence.id &&
          value.basis.some(
            (ref) =>
              ref.kind === 'artifact' &&
              ref.relation === 'source' &&
              ref.hash === value.assertion.artifact_hash,
          ),
      ),
  ]),
  report: z
    .strictObject({ ...kernel, assertion: report, target })
    .refine((value) => value.source.kind === 'declared'),
  effect: z
    .strictObject({ ...kernel, assertion: effect, target })
    .refine(
      (value) =>
        ['query', 'receipt'].includes(value.source.kind) &&
        value.source.observed_at !== undefined &&
        value.basis.some(
          (ref) =>
            ref.relation === 'source' &&
            ref.kind === 'artifact' &&
            ref.hash === value.assertion.payload_hash,
        ),
    ),
  coverage: z
    .strictObject({ ...kernel, assertion: coverage })
    .refine(
      (value) =>
        value.source.kind === 'manifest' &&
        value.source.observed_at !== undefined &&
        value.basis.some((ref) => ref.relation === 'source') &&
        value.subject.namespace === value.assertion.surface.namespace &&
        value.subject.id === value.assertion.surface.id,
    ),
}
export const authoritySnapshotSchema = z
  .strictObject({ version: text, revoked: z.boolean(), not_before: time, expires_at: time })
  .refine((value) => value.not_before < value.expires_at)
export type EvidenceKind = keyof typeof evidenceBodySchemas
export type EvidenceBody = z.infer<(typeof evidenceBodySchemas)[EvidenceKind]>
export const policySchema = z
  .strictObject({
    id: text,
    rules: z.array(
      z.strictObject({
        type: uri,
        signer_keys: z.array(key),
        source_keys: z.array(key),
        source: scopedIdSchema,
        methods: z.array(uri),
        subject_namespace: uri,
        max_age_ms: time,
        authority_versions: z.array(text),
        authorized_descriptors: z.array(descriptorSchema),
        authority_basis: z.array(hashSchema),
      }),
    ),
    required: z.array(z.enum(['source', 'binding', 'authority', 'effect', 'coverage'])),
  })
  .refine((value) => new Set(value.required).size === value.required.length)
  .refine(
    (value) =>
      !value.rules.some((a, i) =>
        value.rules
          .slice(i + 1)
          .some(
            (b) =>
              a.type === b.type &&
              a.source.namespace === b.source.namespace &&
              a.source.id === b.source.id &&
              a.subject_namespace === b.subject_namespace &&
              a.signer_keys.some((key) => b.signer_keys.includes(key)) &&
              a.methods.some((method) => b.methods.includes(method)),
          ),
      ),
  )
export type EvidencePolicy = z.infer<typeof policySchema>
export const evaluationSchema = z.union([
  z.strictObject({ purpose: z.literal('current'), evaluated_at: time }),
  z.strictObject({
    purpose: z.literal('historical'),
    evaluated_at: time,
    dispatch_record: hashSchema,
  }),
])

export type EvidenceEvaluation = z.infer<typeof evaluationSchema>
export type EvidenceDescriptor = z.infer<typeof descriptorSchema>
export type EvidenceScopedId = z.infer<typeof scopedIdSchema>
export const EVIDENCE_TYPES = Object.freeze(
  Object.fromEntries(
    Object.keys(evidenceBodySchemas).map((kind) => [kind, EVIDENCE_PREFIX + kind]),
  ),
) as Readonly<Record<EvidenceKind, string>>

export function createEvidenceNonce(): string {
  return base64urlEncode(crypto.getRandomValues(new Uint8Array(16)))
}

export function commitEvidenceBody(kind: EvidenceKind, body: unknown): string {
  let nodes = 0
  function json(value: unknown, depth: number): void {
    if (++nodes > 100_000 || depth > 64) throw new Error('resource_limit')
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value))
    )
      return
    if (Array.isArray(value)) {
      for (const child of value) json(child, depth + 1)
      return
    }
    if (
      value &&
      typeof value === 'object' &&
      [Object.prototype, null].includes(Object.getPrototypeOf(value))
    ) {
      for (const child of Object.values(value)) json(child, depth + 1)
      return
    }
    throw new TypeError('atrib: evidence body must be JSON without undefined properties')
  }
  json(body, 0)
  const parsed = evidenceBodySchemas[kind].parse(body)
  return createJsonCommitment(parsed, 'plain-sha256').hash
}
