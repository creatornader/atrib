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
  ResolvedCapabilityFacts,
  CrossAttestationAnnotation,
} from './verify-record.js'

// Generic external authorization evidence checks. Off the atrib record-validity path.
export {
  verifyAuthorizationEvidence,
  verifyOAuthAuthorizationEvidence,
} from './authorization-evidence.js'
export type {
  AuthorizationEvidenceInput,
  EvidenceCheckStatus,
  EvidenceConstraintCheck,
  EvidenceVerificationBlock,
  OAuthAccessTokenClaims,
  OAuthAuthorizationDetailConstraint,
  OAuthAuthorizationEvidenceInput,
  OAuthAuthorizationEvidenceVerification,
  OAuthDpopCheck,
  OAuthDpopProofInput,
  OAuthEvidenceProtocol,
  OAuthProtectedResourceMetadata,
  OAuthSignaturePolicy,
  OAuthTokenIntrospectionResponse,
  OAuthTokenCheck,
} from './authorization-evidence.js'

export {
  decodeX401HeaderObject,
  encodeX401HeaderObject,
  verifyX401AuthorizationEvidence,
} from './x401-evidence.js'
export type {
  X401AuthorizationEvidenceDetails,
  X401AuthorizationEvidenceInput,
  X401AuthorizationEvidenceVerification,
  X401EvidenceProtocol,
  X401HeaderSet,
  X401HeaderSource,
  X401HeaderValue,
  X401ProofGateStatus,
  X401ResponseKind,
  X401VerificationPolicy,
} from './x401-evidence.js'

export { verifyAAuthAuthorizationEvidence } from './aauth-evidence.js'
export type {
  AAuthAccessMode,
  AAuthActClaim,
  AAuthAuthorizationEvidenceInput,
  AAuthAuthorizationEvidenceVerification,
  AAuthEvidenceProtocol,
  AAuthHttpSignatureCheck,
  AAuthHttpSignatureEvidence,
  AAuthMissionClaim,
  AAuthR3Check,
  AAuthR3Evidence,
  AAuthResourceMetadataEvidence,
  AAuthSignaturePolicy,
  AAuthTokenCheck,
  AAuthTokenClaims,
  AAuthTokenKind,
} from './aauth-evidence.js'

export {
  FetchDpopReplayCache,
  MemoryDpopReplayCache,
  createFetchDpopReplayCache,
  dpopReplayCacheKeyId,
} from './dpop-replay-cache.js'
export type {
  DpopReplayCache,
  DpopReplayCacheKey,
  FetchDpopReplayCacheOptions,
  MemoryDpopReplayCacheOptions,
} from './dpop-replay-cache.js'

export {
  introspectOAuthToken,
  oauthEvidenceFromIntrospectionResult,
} from './oauth-introspection.js'
export type {
  OAuthIntrospectionClientAuthentication,
  OAuthIntrospectionOptions,
  OAuthIntrospectionResult,
} from './oauth-introspection.js'

// Cross-agent handoff claim verification. Used when one agent receives a
// record_hash claim plus private body material from another agent and must
// decide whether to link its next record through informed_by.
export { handoffClaimsFromEvidencePacket, verifyHandoffClaims } from './handoff.js'
export type {
  HandoffBodyVerification,
  HandoffClaimsFromEvidenceOptions,
  HandoffClaimInput,
  HandoffClaimVerification,
  HandoffEvidenceEntry,
  HandoffEvidencePacket,
  HandoffProofVerification,
  HandoffRejectionReason,
  HandoffVerificationResult,
  VerifyHandoffClaimsOptions,
} from './handoff.js'

// Verifier-side authority policy over informed_by lineage.
export { evaluateAuthority, minAuthority } from './authority.js'
export type {
  AuthorityLevel,
  AuthorityPolicy,
  AuthorityRecord,
  AuthorityResult,
} from './authority.js'

// Universal evidence envelope (§5.5.7, D137). Verifier-layer attachment model;
// never touches signed bytes or verifyRecord().valid. The legacy §5.5.6
// EvidenceVerificationBlock shape stays the mapped compatibility view.
export {
  ATRIB_PROFILE_BASE,
  ATRIB_PROFILE_REGISTRY,
  ATRIB_PROFILE_URIS,
  EVIDENCE_CONSTRAINT_STATUSES,
  EVIDENCE_REF_KINDS,
  EVIDENCE_TIERS,
  FROZEN_LEGACY_PROTOCOLS,
  LEGACY_PROTOCOL_TO_PROFILE,
  SHA256_REF_PATTERN,
  assessReproducibility,
  atribProfileUri,
  classifyProfile,
  envelopeFromEvidenceBlock,
  envelopeIdentityKey,
  fromLegacyEvidenceBlock,
  isRelayIdentitySwap,
  isValidEnvelope,
  jcsSha256,
  mapLegacyEvidenceBlock,
  orderEnvelopeInstances,
  rawSha256,
  renderEnvelopeOpaque,
  tierRank,
  validateEnvelope,
} from './evidence-envelope.js'
export type {
  AtribProfileName,
  EnvelopeReproducibility,
  EnvelopeValidation,
  EvidenceEnvelope,
  EvidenceEnvelopePayload,
  EvidenceEnvelopeRef,
  EvidenceEnvelopeResult,
  EvidenceEnvelopeVerifier,
  EvidenceConstraintStatus,
  EvidenceRefKind,
  EvidenceTier,
  FrozenLegacyProtocol,
  LegacyEvidenceBlock,
  OpaqueEnvelopeRender,
  ProfileClassification,
} from './evidence-envelope.js'

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

// Delegation-certificate evaluation (§1.11 / D140): the §1.11.4 verifier
// walk and §1.9.2 rule-3 revoker authorization. Signals only (§6.7.3);
// never affects record validity.
export {
  checkDelegationScope,
  delegationCertErrors,
  delegationCertHash,
  delegationCertSignatureVerifies,
  delegationCertSigningInput,
  evaluateDelegation,
  evaluateRevokerAuthorization,
} from './delegation.js'
export type {
  DelegatedRecord,
  DelegationCandidate,
  DelegationCertificate,
  DelegationOutcome,
  DelegationScope,
  DelegationScopeCheck,
  EvaluateDelegationOptions,
  KeyRevocationRecordLike,
  RevokerAuthorization,
} from './delegation.js'

// Anchor plurality (D138, §2.11.7-§2.11.13): anchor_plurality annotation over
// §2.11.3 log_proofs plus the unchanged §2.11.4 hard conditions.
export {
  ANCHOR_CLAIM_PREFIX, REGISTERED_NON_LOG_ANCHOR_TYPES,
  anchorOperatorGroup, verifyAnchorPlurality, verifyAnchorProofElement,
} from './anchor-plurality.js'
export type {
  AnchorDisagreeingPair, AnchorElementResult, AnchorElementStatus, AnchorNotFoundResponse,
  AnchorOperatorGroup, AnchorPluralityAnnotation, AnchorPluralityVerdict, AnchorProofBundle,
  AnchorProofElement, AnchorTrustConfig, AnchorTrustEntry,
} from './anchor-plurality.js'

// Session-checkpoint verification (§1.2.10 / D139): structural validation,
// root recomputation, inclusion/consistency proofs, freshness tiering, and
// equivocation detection. Signals only; never affects record validity.
export {
  DEFAULT_SESSION_CHECKPOINT_STALENESS_BOUND_MS,
  SESSION_CHECKPOINT_EVENT_TYPE_URI,
  checkConsecutiveSessionCheckpoints,
  detectSessionCheckpointEquivocation,
  recomputeSessionRoot,
  recomputeSessionRootFromLeafBytes,
  sessionCheckpointArgsHash,
  sessionCheckpointFreshness,
  sessionCheckpointRecordHash,
  sessionLeafBytes,
  validateSessionCheckpointStructural,
  verifySessionCheckpointRecord,
  verifySessionConsistencyProof,
  verifySessionInclusionProof,
} from './session-checkpoint.js'
export type {
  CheckConsecutiveSessionCheckpointsOptions,
  ConsecutiveSessionCheckpointCheck,
  SessionCheckpointBody,
  SessionCheckpointEquivocationEvidence,
  SessionCheckpointFreshness,
  SessionCheckpointRecord,
  SessionCheckpointVerification,
  VerifySessionCheckpointRecordOptions,
  VerifySessionConsistencyProofOptions,
  VerifySessionInclusionProofOptions,
} from './session-checkpoint.js'
