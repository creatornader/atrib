// SPDX-License-Identifier: Apache-2.0

import { AtribVerifier } from './verifier.js'
import type { AtribVerifierOptions, VerifyRecommendationOptions } from './verifier.js'
import type { RecommendationDocument, VerificationResult } from './types.js'

/** Verify a settlement recommendation without constructing a long-lived verifier. */
export async function verifySettlementRecommendation(
  document: RecommendationDocument,
  options: VerifyRecommendationOptions = {},
  verifierOptions: AtribVerifierOptions = {},
): Promise<VerificationResult> {
  return new AtribVerifier(verifierOptions).verify(document, options)
}

export { calculate, DEFAULT_POLICY, isValidPolicy } from './calculate.js'
export {
  evaluateAp2ViConstraints,
  verifyAp2ViEvidence,
  verifyAp2ViEvidenceAsync,
} from './ap2-vi-evidence.js'
export type {
  AtribVerifierOptions,
  CalculateOptions,
  VerifyRecommendationOptions,
} from './verifier.js'
export type * from './ap2-vi-evidence.js'
