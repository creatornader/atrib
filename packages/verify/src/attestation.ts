// SPDX-License-Identifier: Apache-2.0

/**
 * Attestation corroboration (D136, extension-first).
 *
 * Cross-attestation (§1.7.6 / D052 / D135) is corroboration via CO-SIGNATURE of
 * shared transaction bytes: two parties sign the SAME record. Attestation is the
 * general form: corroboration via independent REFERENCE to any target record. A
 * signer Z who is NOT the target's producer emits a separate signed record that
 * vouches for target X's reliability. The verifier aggregates distinct trusted
 * attestors into a corroboration verdict, reusing the D135 trust-set model.
 *
 * Extension-first per D036 / D080: an attestation is an extension-URI record
 * (`https://atrib.dev/v1/extensions/attestation`), NOT a new normative
 * event_type byte, whose content `{ attests: 'reliable', target, reason? }` is
 * committed via `args_hash` (D099) so it is tamper-evident. Promotion to a
 * normative byte + dedicated edge type happens only if real use justifies it.
 *
 * Distinct from annotation (D058 / §1.2.7): annotation is commentary /
 * importance and atrib explicitly does NOT certify it characterizes its target;
 * attestation carries the reserved `attests` marker and means "I vouch this is
 * reliable". The verifier counts ONLY attestation-marked records and NEVER
 * annotation records, so recall-tagging cannot masquerade as corroboration.
 *
 * Signal not block, like §1.7.6 / §6.7: the verdict never flips a record's
 * validity. The fail-closed "require N corroborators" gate lives in
 * `@atrib/action-gate` (`requireCorroborated`), not here.
 */

import canonicalize from 'canonicalize'
import { sha256, hexEncode, type AtribRecord } from '@atrib/mcp'
import { verifyRecord } from './verify-record.js'

/** Extension event_type URI for attestation records (D136, extension-first). */
export const EVENT_TYPE_ATTESTATION_EXT_URI =
  'https://atrib.dev/v1/extensions/attestation'

/** Reserved content contract of an attestation record. */
export interface AttestationContent {
  /** Reserved marker. Only `'reliable'` is counted as a trust vouch. */
  attests: 'reliable'
  /** `'sha256:<64-hex>'` record_hash of the corroborated target record. */
  target: string
  /** Optional free-text rationale (local sidecar; committed via args_hash). */
  reason?: string
}

/** One caller-supplied attestation: the signed record plus its committed content. */
export interface AttestationInput {
  record: AtribRecord
  content: AttestationContent
}

export interface AttestationCorroborationOptions {
  /** `'sha256:<64-hex>'` record_hash of the record being corroborated. */
  targetRecordHash: string
  /**
   * creator_key of the target record. When supplied, an attestation whose
   * signer equals it is rejected as self-attestation (a producer cannot
   * corroborate itself). Strongly recommended.
   */
  targetCreatorKey?: string
  /** Attestation records claiming to vouch for the target. */
  attestations: AttestationInput[]
  /**
   * Base64url Ed25519 keys the verifier trusts as independent attesting
   * principals (§1.7.6 / D135 trust vocabulary). When supplied, the verdict
   * adds `attestors_trusted` / `under_corroborated`. Omitted: trust-blind.
   */
  trustedCreatorKeys?: string[]
  /** Corroboration minimum. Default 2 (matching the cross-attestation minimum). */
  minCorroborators?: number
}

export interface AttestationCorroborationResult {
  target: string
  /** Attestation records supplied for this target (regardless of validity). */
  attestors_count: number
  /**
   * Distinct verified attestor keys: signature verifies, event_type is the
   * attestation URI, content commitment (args_hash) matches, `attests` is
   * `'reliable'`, `target` matches, and the signer is not the target producer.
   * Trust-blind, like cross_attestation.signers_valid.
   */
  attestors_valid: number
  /** `true` iff `attestors_valid < minCorroborators` (trust-blind minimum). */
  missing: boolean
  /**
   * Always present. `false` is a loud signal that no trust set was supplied and
   * only the trust-blind count was computed; a consumer gating an action MUST
   * NOT read `attestors_valid >= N` as trusted corroboration without a trust set.
   */
  trust_evaluated: boolean
  /** Distinct verified attestor keys also in the trust set. Present iff `trust_evaluated`. */
  attestors_trusted?: number
  /**
   * `true` iff `attestors_valid >= minCorroborators` but `attestors_trusted <
   * minCorroborators`: corroborated by count but not by trusted principals (the
   * Sybil analog of `sybil_suspected`). Present iff `trust_evaluated`.
   */
  under_corroborated?: boolean
  /** Per-rejected-attestation reasons (signal; does not invalidate anything). */
  rejected: Array<{ attestor_key?: string; reasons: string[] }>
}

function commitmentMatches(record: AtribRecord, content: AttestationContent): boolean {
  const argsHash = record.args_hash
  if (typeof argsHash !== 'string') return false
  const canonical = canonicalize(content)
  if (typeof canonical !== 'string') return false
  const digest = 'sha256:' + hexEncode(sha256(new TextEncoder().encode(canonical)))
  return digest === argsHash
}

/**
 * Aggregate independent attestation records into a corroboration verdict for a
 * target record. Reuses the D135 trust-set intersection: `attestors_valid`
 * stays trust-blind; when a trust set is supplied, `attestors_trusted` and
 * `under_corroborated` are added. Never flips any record's validity.
 */
export async function resolveAttestationCorroboration(
  opts: AttestationCorroborationOptions,
): Promise<AttestationCorroborationResult> {
  const rejected: Array<{ attestor_key?: string; reasons: string[] }> = []
  const validAttestorKeys = new Set<string>()

  for (const item of opts.attestations) {
    const reasons: string[] = []
    const record = item.record
    const content = item.content

    if (record.event_type !== EVENT_TYPE_ATTESTATION_EXT_URI) reasons.push('not_attestation')
    if (content?.attests !== 'reliable') reasons.push('not_reliable_marker')
    if (content?.target !== opts.targetRecordHash) reasons.push('wrong_target')
    if (opts.targetCreatorKey && record.creator_key === opts.targetCreatorKey) {
      reasons.push('self_attestation')
    }
    if (!commitmentMatches(record, content)) reasons.push('uncommitted_content')

    if (reasons.length === 0) {
      const result = await verifyRecord(record)
      if (result.signatureOk) validAttestorKeys.add(record.creator_key)
      else reasons.push('signature_invalid')
    }

    if (reasons.length > 0) {
      rejected.push({ attestor_key: record.creator_key, reasons })
    }
  }

  const min = opts.minCorroborators ?? 2
  const attestors_valid = validAttestorKeys.size
  const base: AttestationCorroborationResult = {
    target: opts.targetRecordHash,
    attestors_count: opts.attestations.length,
    attestors_valid,
    missing: attestors_valid < min,
    trust_evaluated: opts.trustedCreatorKeys !== undefined,
    rejected,
  }
  if (opts.trustedCreatorKeys === undefined) return base

  const trustSet = new Set(opts.trustedCreatorKeys)
  let attestors_trusted = 0
  for (const key of validAttestorKeys) if (trustSet.has(key)) attestors_trusted++
  return {
    ...base,
    attestors_trusted,
    under_corroborated: attestors_valid >= min && attestors_trusted < min,
  }
}

/**
 * Non-malleable corroboration predicate. Returns `true` iff at least
 * `min` (default 2) distinct verified attestor keys are in the trust set. This
 * is the guarded gate a consumer requiring trusted corroboration MUST use, in
 * place of the footgun `attestors_valid >= N` (which untrusted attestors also
 * satisfy). Returns `false` when trust was not evaluated.
 */
export function isCorroborated(
  result: AttestationCorroborationResult | undefined,
  min = 2,
): boolean {
  return (result?.attestors_trusted ?? 0) >= min
}
