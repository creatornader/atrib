// SPDX-License-Identifier: Apache-2.0
import {
  verifyAnchorProofElement,
  type AnchorProofBundle,
  type AnchorProofElement,
  type AnchorTrustConfig,
} from './anchor-plurality.js'
import type { EvidenceDimension } from './evidence-statements.js'

export interface EvidencePublicationInput {
  proofs: ReadonlyMap<string, AnchorProofBundle>
  trust: AnchorTrustConfig
}

/** Verify only RFC 6962 log inclusion with receiver-pinned checkpoint keys. */
export async function verifyEvidencePublication(
  recordHash: string,
  input?: EvidencePublicationInput,
): Promise<EvidenceDimension> {
  const invalid: EvidenceDimension = {
    state: 'rejected',
    basis: [recordHash],
    reasons: ['dependency_invalid'],
  }
  if (!input?.proofs.has(recordHash))
    return { state: 'unresolved', basis: [], reasons: ['not_submitted'] }
  try {
    const value: unknown = input.proofs.get(recordHash)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid
    const proof = value as Record<string, unknown>
    if (
      proof.record_hash !== recordHash ||
      !Array.isArray(proof.log_proofs) ||
      !proof.log_proofs.length
    )
      return invalid
    let failed = false
    for (const element of proof.log_proofs) {
      const result = await verifyAnchorProofElement(
        element as AnchorProofElement,
        recordHash,
        input.trust,
      )
      if (result.status === 'malformed' || result.status === 'invalid') failed = true
      if (result.anchorType === 'atrib-log' && result.status === 'verified')
        return { state: 'supported', basis: [recordHash], reasons: [] }
    }
    if (failed) return invalid
    return {
      state: 'unresolved',
      basis: [recordHash],
      reasons: ['https://atrib.dev/evidence/v1/reason/publication-anchor-unsupported'],
    }
  } catch {
    return invalid
  }
}
