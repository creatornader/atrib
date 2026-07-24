// SPDX-License-Identifier: Apache-2.0

import { verifyJsonCommitment, type AtribRecord } from '@atrib/mcp'

export type ResultClaimStatus =
  | 'uncommitted'
  | 'committed_only'
  | 'evidence_inconsistent'
  | 'body_consistent_uncorroborated'
  | 'corroborated'

export interface ResultCorroboration {
  signer_key: string
  result_hash: string
  verified: boolean
}

export interface EvaluateResultClaimOptions {
  result?: unknown
  corroborations?: readonly ResultCorroboration[]
  trusted_signer_keys?: ReadonlySet<string>
  min_corroborations?: number
}

export interface ResultClaimEvaluation {
  status: ResultClaimStatus
  commitment_present: boolean
  body_supplied: boolean
  body_consistent: boolean | null
  corroborating_signers: string[]
  corroboration_threshold: number
  corroboration_met: boolean
  /** Hashing and corroboration never establish arbitrary real-world truth. */
  truth_established: false
}

/**
 * Classify what a result claim's evidence establishes.
 *
 * A signed hash proves a commitment. Matching body material proves
 * consistency with that commitment. Independent verified signers can
 * corroborate the same bytes. None of those facts proves arbitrary truth.
 */
export function evaluateResultClaim(
  record: AtribRecord,
  options: EvaluateResultClaimOptions = {},
): ResultClaimEvaluation {
  const threshold = Math.max(1, options.min_corroborations ?? 1)
  const bodySupplied = Object.prototype.hasOwnProperty.call(options, 'result')
  if (!record.result_hash) {
    return {
      status: 'uncommitted',
      commitment_present: false,
      body_supplied: bodySupplied,
      body_consistent: null,
      corroborating_signers: [],
      corroboration_threshold: threshold,
      corroboration_met: false,
      truth_established: false,
    }
  }

  const bodyConsistent = bodySupplied
    ? verifyJsonCommitment(options.result, {
        hash: record.result_hash,
        ...(record.result_salt ? { salt: record.result_salt } : {}),
      })
    : null
  const corroboratingSigners = [
    ...new Set(
      (options.corroborations ?? [])
        .filter(
          (entry) =>
            entry.verified &&
            entry.signer_key !== record.creator_key &&
            entry.result_hash === record.result_hash &&
            (options.trusted_signer_keys === undefined ||
              options.trusted_signer_keys.has(entry.signer_key)),
        )
        .map((entry) => entry.signer_key),
    ),
  ].sort()
  const corroborationMet = corroboratingSigners.length >= threshold
  const status: ResultClaimStatus =
    bodyConsistent === false
      ? 'evidence_inconsistent'
      : bodyConsistent === null
        ? 'committed_only'
        : corroborationMet
          ? 'corroborated'
          : 'body_consistent_uncorroborated'

  return {
    status,
    commitment_present: true,
    body_supplied: bodySupplied,
    body_consistent: bodyConsistent,
    corroborating_signers: corroboratingSigners,
    corroboration_threshold: threshold,
    corroboration_met: corroborationMet,
    truth_established: false,
  }
}
