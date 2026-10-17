// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod'

export const EVIDENCE_PREFIX = 'https://atrib.dev/evidence/v1/'
export const DECLARED_METHOD = `${EVIDENCE_PREFIX}method/declared`
const uri = z
  .string()
  .min(1)
  .refine((value) => /^[a-z][a-z0-9+.-]*:/i.test(value))
const text = z.string().min(1)
export function isEvidenceLocator(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false
  if (/\bbearer\s+/i.test(value)) return false
  let decoded = value
  try {
    decoded = decodeURIComponent(value)
  } catch {
    // Recognize ASCII bearer forms even beside malformed or non-UTF-8 escapes.
    decoded = value.replace(/%([0-7][0-9a-f])/gi, (_, hex: string) =>
      String.fromCharCode(parseInt(hex, 16)),
    )
  }
  if (/\bbearer\s+/i.test(decoded)) return false
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
    return false
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
  .refine((value) => value.kind !== 'declared' || !('observed_at' in value))
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
      const bytes = Buffer.from(value, 'base64url')
      return bytes.length >= 16 && bytes.toString('base64url') === value
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
