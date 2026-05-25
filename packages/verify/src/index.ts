// SPDX-License-Identifier: Apache-2.0

// @atrib/verify. Merchant verification library

// Verifier (primary export)
export { AtribVerifier } from './verifier.js'
export type { AtribVerifierOptions, CalculateOptions } from './verifier.js'

// Per-record verification (single AtribRecord; surfaces D044 provenance
// annotations). Distinct from AtribVerifier.verify which operates on a
// settlement RecommendationDocument. Other per-record annotations the
// README mentions (informed_by_resolution, capability_check, etc.) are
// pending; see DECISIONS.md for the planned reconciliation.
export { verifyRecord } from './verify-record.js'
export type {
  RecordVerificationResult,
  ProvenanceAnnotation,
  VerifyRecordOptions,
} from './verify-record.js'

// Calculation algorithm (§4.6). pure function, exported for direct use
export { calculate, DEFAULT_POLICY, isValidPolicy } from './calculate.js'

// Recommendation document signing/verification (§4.7)
export {
  signRecommendation,
  verifyRecommendationSignature,
  recommendationSigningInput,
  distributionsMatch,
} from './recommendation.js'

// Policy builder (compose policies from templates)
export { buildPolicy, policyFrom } from './policy-builder.js'

// Graph fetch (advanced usage)
export { fetchGraph, fetchSessionPolicyRecord, fetchPolicyDocument } from './graph-fetch.js'

// Revocation registry (§1.9)
export { buildRevocationRegistry, applyRevocation } from './revocations.js'
export type { RevocationEntry, RevocationReason, MinimalRecord } from './revocations.js'

// Identity resolution (§6.3 9-step verifier consultation)
export { resolveIdentity } from './resolve-identity.js'
export type {
  IdentityResolution,
  IdentityResolutionMethod,
  KeyRevocationStatus,
  ResolveIdentityOptions,
  IdentityClaim,
  CapabilityEnvelope,
} from './resolve-identity.js'

// Types
export type {
  GraphNode,
  GraphEdge,
  GraphResponse,
  EventType,
  EdgeType,
  GapNode,
  VerificationState,
  ReferenceStatus,
  PolicyDocument,
  PolicyConstraints,
  EdgeWeights,
  Modifier,
  DistributionMethod,
  CreatorPolicySnapshot,
  CreatorPolicyEntry,
  SessionPolicyRecord,
  Distribution,
  RecommendationDocument,
  VerificationResult,
} from './types.js'
export { graphLabelFromEventTypeUri } from './types.js'
