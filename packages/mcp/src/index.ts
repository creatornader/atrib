// SPDX-License-Identifier: Apache-2.0

// @atrib/mcp. Public API

// Middleware (primary export)
export { atrib } from './middleware.js'
export type {
  AtribOptions,
  AtribServer,
  LocalSubstrateShadowAttempt,
  LocalSubstrateShadowOptions,
  OnRecordSidecar,
  PreCallTransform,
  PreCallTransformContext,
  RecordReferenceCandidate,
  RecordReferenceResolver,
  RecordReferenceSource,
} from './middleware.js'

// Proxy: in-process McpServer that forwards to an upstream MCP server with
// attribution applied at the proxy layer. Use for hosts that accept an
// in-process McpServer instance (Claude Agent SDK, Cloudflare Agents).
export { createAtribProxy } from './proxy.js'
export type { AtribProxy, AtribProxyOptions, UpstreamTransport } from './proxy.js'

// HTTP handler for well-known endpoints (§5.3.5, §5.3.6)
export { createAtribHttpHandler, handleAtribRequest } from './http.js'
export type { AtribHttpResult } from './http.js'

// Types
export type { AtribRecord, UnsignedAtribRecord, DecodedToken, SignerEntry } from './types.js'
export {
  EVENT_TYPE_TOOL_CALL_URI,
  EVENT_TYPE_TRANSACTION_URI,
  EVENT_TYPE_OBSERVATION_URI,
  EVENT_TYPE_DIRECTORY_ANCHOR_URI,
  EVENT_TYPE_ANNOTATION_URI,
  EVENT_TYPE_REVISION_URI,
  EVENT_TYPE_SHORT_NAMES,
  EVENT_TYPE_SHORT_TO_URI,
  EVENT_TYPE_ALIAS_TO_URI,
  NORMATIVE_EVENT_TYPE_URIS,
  normalizeEventType,
  isValidEventTypeUri,
  isNormativeEventTypeUri,
} from './types.js'
export type { EventTypeShortName } from './types.js'

// Core primitives
export { base64urlEncode, base64urlDecode } from './base64url.js'
export { sha256, hexEncode, hexDecode } from './hash.js'
export { canonicalSigningInput, canonicalRecord, canonicalCrossAttestationInput } from './canon.js'
export {
  getPublicKey,
  signRecord,
  signTransactionAttestation,
  signTransactionRecord,
  verifyRecord,
} from './signing.js'
export { computeContentId, normalizeServerUrl } from './content-id.js'
export {
  ATRIB_PARENT_RECORD_HASH_ENV,
  SHA256_REF_PATTERN,
  SHA256_REF_GLOBAL_PATTERN,
  extractRecordHashes,
  extractRecordReferenceCandidates,
  parentRecordHashFromEnv,
} from './refs.js'
export { ATRIB_CONTEXT_ID_ENV, buildSubagentProducerEnv, chainTailEnvName } from './subagent.js'
export type { BuildSubagentProducerEnvOptions } from './subagent.js'
export { genesisChainRoot, chainRoot, resolveChainRoot } from './chain-root.js'
export { readMirrorTail, inheritChainContext, recordHashExistsInMirror } from './mirror.js'
export type { ChainContext } from './mirror.js'
export {
  clearRecordReferenceResolverCacheForTests,
  defaultRecordReferenceResolver,
} from './record-reference.js'
export type {
  DefaultRecordReferenceResolverOptions,
  LocalRecordReferenceResolver,
  RecordReferenceResolution,
} from './record-reference.js'
export { encodeToken, decodeToken } from './token.js'

// Harness session-id discovery (D083)
export { resolveEnvContextId, KNOWN_HARNESS_DISCOVERIES } from './harness-context.js'
export type { HarnessDiscovery } from './harness-context.js'

// Read-primitive instrumentation (Surface 6 of 4th-pillar broadening). Used
// by atrib-recall, atrib-trace, atrib-summarize to log each invocation to
// ~/.atrib/state/read-primitives/calls.jsonl for unified-analyzer correlation.
export { logReadPrimitiveCall, extractRecordHashesFromMcpResult } from './read-instrumentation.js'
export type { ReadPrimitiveCallLogEntry } from './read-instrumentation.js'

// Normative content-shape contracts for indexable-text extraction.
// Codifies per-event_type shape definitions + the dispatch function used
// by recall (BM25 corpus build), legibility (display synthesis), and
// future consumers (audit tools, embedding pipelines, third-party clients).
// Per-shape extractors are exported individually for callers that know
// their event_type at compile time.
export {
  extractIndexableText,
  extractObservationText,
  extractAnnotationText,
  extractRevisionText,
  extractToolCallText,
  extractTransactionText,
  extractDirectoryAnchorText,
  DEFAULT_FIELD_CAP,
} from './content-shapes.js'
export type {
  ExtractIndexableTextOptions,
  ObservationContent,
  AnnotationContent,
  RevisionContent,
  ToolCallContent,
  TransactionContent,
  DirectoryAnchorContent,
} from './content-shapes.js'

// Local-mirror sidecar normalization for consumers that need recall-readable
// content from legacy `_local.toolName` / `_local.args` / `_local.result`
// fields or OpenInference callback sidecars that predate `_local.content`.
export {
  deriveLocalContentFromSidecar,
  withDerivedLocalContent,
  isLocalSidecarLike,
} from './local-sidecar.js'
export type { LocalSidecarLike } from './local-sidecar.js'

// P042 local substrate coordinator contract. This is a typed adapter boundary,
// not a daemon or a new event surface.
export {
  LOCAL_SUBSTRATE_CREATOR_KEY_POLICIES,
  LOCAL_SUBSTRATE_HARNESS_CLASSES,
  LOCAL_SUBSTRATE_HEALTH_SCHEMA,
  LOCAL_SUBSTRATE_HTTP_DEFAULT_HEALTH_PATH,
  LOCAL_SUBSTRATE_HTTP_DEFAULT_PATH,
  LOCAL_SUBSTRATE_OPERATIONS,
  LOCAL_SUBSTRATE_REQUEST_MODES,
  LOCAL_SUBSTRATE_RESPONSE_SCHEMA,
  LOCAL_SUBSTRATE_RESPONSE_STATUSES,
  LOCAL_SUBSTRATE_REQUEST_SCHEMA,
  buildLocalSubstrateHealthReport,
  createInProcessLocalSubstrateCoordinator,
  createLocalSubstrateCoordinatorHttpHandler,
  canonicalLocalSubstrateRecordBody,
  createHttpLocalSubstrateTransport,
  hashLocalSubstrateRecordBody,
  handleLocalSubstrateCoordinatorHttpRequest,
  localSubstrateRecordBodiesEqual,
  probeLocalSubstrateHealth,
  tryLocalSubstrateCoordinator,
  validateLocalSubstrateFixture,
  validateLocalSubstrateHealthReport,
  validateLocalSubstrateRequest,
  validateLocalSubstrateResponse,
} from './local-substrate.js'
export type {
  BuildLocalSubstrateHealthReportInput,
  CreateHttpLocalSubstrateTransportOptions,
  CreateInProcessLocalSubstrateCoordinatorOptions,
  InProcessLocalSubstrateCoordinator,
  InProcessLocalSubstrateCoordinatorHealthOptions,
  LocalSubstrateContext,
  LocalSubstrateCoordinatorHttpOptions,
  LocalSubstrateCoordinatorHttpResult,
  LocalSubstrateCoordinatorRecordContext,
  LocalSubstrateCoordinatorRecordObserver,
  LocalSubstrateCoordinatorRequest,
  LocalSubstrateCoordinatorResponse,
  LocalSubstrateCoordinatorService,
  LocalSubstrateCoordinatorTransport,
  LocalSubstrateCreatorKeyPolicy,
  LocalSubstrateDegradationPolicy,
  LocalSubstrateFixture,
  LocalSubstrateHarnessClass,
  LocalSubstrateHealthValue,
  LocalSubstrateHealthProbeResult,
  LocalSubstrateHealthReport,
  LocalSubstrateOperation,
  LocalSubstrateProducer,
  LocalSubstrateRequestMode,
  LocalSubstrateResponseStatus,
  LocalSubstrateTransportOptions,
  LocalSubstrateValidationIssue,
  LocalSubstrateValidationResult,
  LocalSubstrateWalJoin,
  TryLocalSubstrateCoordinatorOptions,
  TryLocalSubstrateCoordinatorResult,
  ValidateLocalSubstrateFixtureOptions,
  ValidateLocalSubstrateRequestOptions,
  ValidateLocalSubstrateResponseOptions,
} from './local-substrate.js'

// MCP/OAuth sidecar evidence capture. Producer-side helper for local mirrors.
export { buildMcpOAuthEvidenceFromExtra } from './oauth-evidence.js'
export type {
  CapturedDpopProofEvidence,
  CapturedMcpOAuthEvidence,
  CapturedOAuthAccessTokenClaims,
  CapturedOAuthAuthorizationDetailConstraint,
  CapturedOAuthProtectedResourceMetadata,
  McpOAuthEvidenceCaptureOptions,
  McpOAuthEvidenceCaptureContext,
  McpRequestExtraLike,
} from './oauth-evidence.js'

// Context (for advanced usage)
export {
  readInboundContext,
  writeOutboundContext,
  parseTracestateAtrib,
  parseBaggageAtribSession,
  extractTraceId,
  mergeTracestate,
  mergeBaggageAtribSession,
} from './context.js'
export type { InboundContext, OutboundContextOptions } from './context.js'

// Submission queue (for @atrib/agent and advanced usage)
export { createSubmissionQueue } from './submission.js'
export type {
  ArchiveSubmissionOptions,
  ProofBundle,
  SubmissionQueue,
  SubmissionSidecar,
} from './submission.js'

// RFC 6962 Merkle tree (for log service and @atrib/verify)
export {
  leafHash,
  nodeHash,
  computeRoot,
  computeInclusionProof,
  verifyInclusion,
} from './merkle.js'

// §2.6.1 submission validation (shared between log-dev and log-node)
export { validateSubmission, type ValidationResult } from './validation.js'

// §2.8 Proof bundle text format (c2sp.org/tlog-proof)
export { formatProofBundle, parseProofBundle } from './proof-text.js'

// §5.6.3 Memory zeroing for key material
export { zeroize } from './zeroize.js'

// §2.3.1 log entry serialization (shared between log-dev and log-node)
export {
  serializeEntry,
  eventTypeUriToByte,
  ENTRY_VERSION,
  ENTRY_SIZE,
  EVENT_TYPE_TOOL_CALL,
  EVENT_TYPE_TRANSACTION,
  EVENT_TYPE_OBSERVATION,
  EVENT_TYPE_EXTENSION,
} from './entry.js'
export type { EntryInput } from './entry.js'
