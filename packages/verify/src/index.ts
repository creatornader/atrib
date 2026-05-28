// SPDX-License-Identifier: Apache-2.0

// @atrib/verify. Merchant verification library

// Verifier (primary export)
export { AtribVerifier } from './verifier.js'
export type {
  AtribVerifierOptions,
  CalculateOptions,
  VerifyRecommendationOptions,
} from './verifier.js'

// Per-record verification (single AtribRecord). Distinct from
// AtribVerifier.verify which operates on a settlement RecommendationDocument.
// Surfaces the implemented D044, D041, D045, D051, D052, and D094 annotations.
export { verifyRecord } from './verify-record.js'
export type {
  RecordVerificationResult,
  ProvenanceAnnotation,
  VerifyRecordOptions,
  CrossAttestationAnnotation,
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

// AP2 / Verifiable Intent evidence checks. Off the settlement critical path.
export {
  evaluateAp2ViConstraints,
  verifyAp2ViEvidence,
  verifyAp2ViEvidenceAsync,
} from './ap2-vi-evidence.js'
export type {
  Ap2ConstraintCheckStatus,
  Ap2ConstraintDomain,
  Ap2ConstraintEvaluationStatus,
  Ap2ConstraintPolicy,
  Ap2EvidenceCheck,
  Ap2EvidenceInput,
  Ap2MandateConstraintCheck,
  Ap2MandateConstraintEvaluation,
  Ap2MandateConstraintInput,
  Ap2ReceiptJwtCheck,
  Ap2ReceiptJwtIssuer,
  Ap2ReceiptCheck,
  Ap2ViEvidenceBundle,
  Ap2ViEvidenceVerification,
  SdJwtConformanceCheck,
  SdJwtConformancePolicy,
  SdJwtConformanceProfile,
  SdJwtVcConformanceOptions,
  SignatureCheck,
  VerifyAp2ViEvidenceOptions,
  ViCredentialCheck,
  ViCredentialInput,
  ViCredentialLayer,
  ViEvidenceCheck,
  ViMode,
} from './ap2-vi-evidence.js'

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
