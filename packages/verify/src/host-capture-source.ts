// SPDX-License-Identifier: Apache-2.0
import canonicalize from 'canonicalize'
import {
  HOST_CAPTURE_METHOD,
  EVIDENCE_TYPES,
  commitEvidenceBody,
  sha256,
  hexEncode,
  verifyRecord,
} from '@atrib/mcp'
import type { AtribRecord } from '@atrib/mcp'
import {
  validEvidenceCarrier,
  type EvidenceSourceVerifier,
  type EvidenceSourceResult,
} from './evidence-statements.js'

type ObjectValue = Record<string, unknown>
const object = (value: unknown): ObjectValue => {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error('invalid_capture')
  return value as ObjectValue
}
const digest = (bytes: Uint8Array) => `sha256:${hexEncode(sha256(bytes))}`

/** Authenticates a host account of interception. It does not prove remote state or independent control. */
export const createHostCaptureSourceVerifier = (
  method = HOST_CAPTURE_METHOD,
): EvidenceSourceVerifier => ({
  async verify({
    record,
    body,
    artifacts,
    sourceKeys,
    evaluatedAt,
  }): Promise<EvidenceSourceResult> {
    const reasonUri = (reason: string) =>
      `https://atrib.dev/evidence/v1/reason/${reason.replaceAll('_', '-')}`
    const rejected = (reason: string): EvidenceSourceResult => ({
      state: 'rejected',
      reasons: [reasonUri(reason)],
      basis: [],
    })
    try {
      const source = object(body.source)
      if (source.method !== method || source.kind !== 'boundary')
        return rejected('host_capture_method_mismatch')
      if (
        record.event_type !== EVIDENCE_TYPES.observation ||
        !sourceKeys.includes(String(record.creator_key))
      )
        return rejected('host_capture_key_untrusted')
      if (record.timestamp !== source.observed_at) return rejected('host_capture_time_mismatch')
      if (!(await verifyRecord(record as AtribRecord, { nowMs: evaluatedAt })))
        return rejected('host_capture_signature_invalid')
      if (!validEvidenceCarrier(record)) return rejected('host_capture_schema_invalid')
      if (commitEvidenceBody('observation', body) !== record.args_hash)
        return rejected('host_capture_opening_invalid')
      const sourceRefs = (body.basis as ObjectValue[]).filter(
        (ref) => ref.kind === 'artifact' && ref.relation === 'source',
      )
      if (sourceRefs.length !== 1) return rejected('host_capture_source_ambiguous')
      const hash = String(sourceRefs[0]!.hash)
      const bytes = artifacts.get(hash)
      if (!bytes)
        return { state: 'unresolved', reasons: [reasonUri('host_capture_missing')], basis: [] }
      if (bytes.length > 1_048_576 || digest(bytes) !== hash)
        return rejected('host_capture_hash_mismatch')
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      const frame = object(JSON.parse(text))
      if (!Object.keys(frame).length || canonicalize(frame) !== text)
        return rejected('host_capture_schema_invalid')
      const assertion = object(body.assertion)
      if (
        method === HOST_CAPTURE_METHOD &&
        (frame.phase !== assertion.phase ||
          frame.observed_at !== source.observed_at ||
          frame.request_record_hash !== object(body.target).record_hash ||
          canonicalize(frame.descriptor) !== canonicalize(assertion.descriptor))
      )
        return rejected('host_capture_claim_mismatch')
      const { nonce: _nonce, basis: _basis, ...claim } = body
      const authority = (body.basis as ObjectValue[])
        .filter((ref) => ref.relation === 'authority' && ref.kind === 'record')
        .map((ref) => ref.hash)
        .sort()
      return {
        state: 'supported',
        reasons: [],
        basis: [hash],
        facts: { claim, authority: authority as string[] },
      }
    } catch {
      return rejected('host_capture_schema_invalid')
    }
  },
})

export const hostCaptureSourceVerifier = createHostCaptureSourceVerifier()
