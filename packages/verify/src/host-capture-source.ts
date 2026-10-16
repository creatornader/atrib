// SPDX-License-Identifier: Apache-2.0
import canonicalize from 'canonicalize'
import { HOST_CAPTURE_METHOD, HOST_CAPTURE_TYPE, sha256, hexEncode, verifyRecord } from '@atrib/mcp'
import type { AtribRecord } from '@atrib/mcp'
import type { EvidenceSourceVerifier, EvidenceSourceResult } from './evidence-statements.js'

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
    const source = object(body.source)
    if (source.method !== method || source.kind !== 'boundary')
      return rejected('host_capture_method_mismatch')
    const sourceRefs = (body.basis as ObjectValue[]).filter(
      (ref) => ref.kind === 'artifact' && ref.relation === 'source',
    )
    if (sourceRefs.length !== 1) return rejected('host_capture_source_ambiguous')
    const hash = String(sourceRefs[0]!.hash)
    const bytes = artifacts.get(hash)
    if (!bytes)
      return { state: 'unresolved', reasons: [reasonUri('host_capture_missing')], basis: [] }
    try {
      if (bytes.length > 1_048_576 || digest(bytes) !== hash)
        return rejected('host_capture_hash_mismatch')
      const wrapper = object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)))
      if (Object.keys(wrapper).sort().join(',') !== 'payload,record')
        return rejected('host_capture_schema_invalid')
      const captured = object(wrapper.payload)
      if (
        Object.keys(captured).some(
          (key) => !['nonce', 'claim', 'authority', 'payload'].includes(key),
        ) ||
        typeof captured.nonce !== 'string' ||
        !/^[A-Za-z0-9_-]{22,}$/.test(captured.nonce) ||
        !Array.isArray(captured.authority) ||
        captured.authority.some(
          (hash) => typeof hash !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(hash),
        )
      ) {
        return rejected('host_capture_schema_invalid')
      }
      const signed = object(wrapper.record)
      const fields = [
        'spec_version',
        'creator_key',
        'chain_root',
        'event_type',
        'context_id',
        'timestamp',
        'args_hash',
        'signature',
      ]
      if (Object.keys(signed).sort().join(',') !== fields.sort().join(','))
        return rejected('host_capture_schema_invalid')
      if (
        signed.event_type !== HOST_CAPTURE_TYPE ||
        !sourceKeys.includes(String(signed.creator_key))
      )
        return rejected('host_capture_key_untrusted')
      if (
        !Number.isSafeInteger(evaluatedAt) ||
        evaluatedAt < 0 ||
        typeof signed.timestamp !== 'number' ||
        signed.timestamp > evaluatedAt + 300_000
      )
        return rejected('host_capture_time_mismatch')
      if (!(await verifyRecord(signed as AtribRecord, { nowMs: evaluatedAt })))
        return rejected('host_capture_signature_invalid')
      if (signed.args_hash !== digest(new TextEncoder().encode(canonicalize(captured)!)))
        return rejected('host_capture_opening_invalid')
      const { nonce: _nonce, basis: _basis, ...claim } = body
      if (
        canonicalize(captured.claim) !== canonicalize(claim) ||
        signed.timestamp !== source.observed_at ||
        signed.context_id !== record.context_id
      )
        return rejected('host_capture_claim_mismatch')
      const authority = (body.basis as ObjectValue[])
        .filter((ref) => ref.relation === 'authority' && ref.kind === 'record')
        .map((ref) => ref.hash)
        .sort()
      if (canonicalize(captured.authority) !== canonicalize(authority))
        return rejected('host_capture_authority_mismatch')
      return {
        state: 'supported',
        reasons: [],
        basis: [hash],
        facts: { claim, authority: captured.authority as string[] },
      }
    } catch {
      return rejected('host_capture_schema_invalid')
    }
  },
})

export const hostCaptureSourceVerifier = createHostCaptureSourceVerifier()
