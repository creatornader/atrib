// @atrib/verify, Merchant verification library

// Verifier (primary export)
export { AtribVerifier } from './verifier.js'
export type { AtribVerifierOptions, CalculateOptions } from './verifier.js'

// Calculation algorithm (§4.6), pure function, exported for direct use
export { calculate, DEFAULT_POLICY, isValidPolicy } from './calculate.js'

// Recommendation document signing/verification (§4.7)
export {
  signRecommendation,
  verifyRecommendationSignature,
  recommendationSigningInput,
  distributionsMatch,
} from './recommendation.js'

// Graph fetch (advanced usage)
export { fetchGraph, fetchSessionPolicyRecord, fetchPolicyDocument } from './graph-fetch.js'

// Types
export type {
  GraphNode,
  GraphEdge,
  GraphResponse,
  EventType,
  EdgeType,
  VerificationState,
  PolicyDocument,
  PolicyConstraints,
  EdgeWeights,
  Modifier,
  DistributionMethod,
  SessionPolicyRecord,
  Distribution,
  RecommendationDocument,
  VerificationResult,
} from './types.js'
