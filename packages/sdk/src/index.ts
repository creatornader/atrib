// SPDX-License-Identifier: Apache-2.0

/**
 * @atrib/sdk — the consolidated atrib client SDK.
 *
 * Two verbs over the substrate: attest() (write) and recall() (read),
 * daemon-first with in-process fallback, plus the complete §1 record
 * layer re-exported from @atrib/mcp so application code needs exactly one
 * import. This package adds NO new canonicalization, hashing, or signing
 * implementation — every cryptographic path is the existing @atrib/mcp
 * one, and every write terminates in @atrib/emit's handleEmit pipeline.
 */

// ── The two verbs ────────────────────────────────────────────────────────
export { createAtribClient, type AtribClient } from './client.js'
export {
  buildEmitArgs,
  type AttestInput,
  type AttestRef,
  type AttestResult,
} from './attest.js'
export {
  SHAPE_TO_TOOL,
  type AnnotationsQuery,
  type ByContentQuery,
  type BySignerQuery,
  type HistoryQuery,
  type OrphansQuery,
  type RecallOutcome,
  type RecallQuery,
  type RecallShape,
  type RevisionsQuery,
  type SessionChainQuery,
  type TraceQuery,
  type VerifyQuery,
  type WalkQuery,
} from './recall.js'
export {
  DEFAULT_DAEMON_ENDPOINT,
  DEFAULT_PRODUCER,
  resolveDaemonEndpoint,
  type AtribClientConfig,
  type DaemonConfig,
  type DaemonMode,
} from './config.js'
export { DaemonClient, type DaemonCallOutcome } from './daemon.js'

// ── SDK hash helpers (compositions of @atrib/mcp primitives) ────────────
export { deriveProvenanceToken, recordHashHex, recordHashRef } from './hashes.js'

// ── Record layer (§1), re-exported from @atrib/mcp ───────────────────────
export {
  // types + event vocabulary
  EVENT_TYPE_ANNOTATION_URI,
  EVENT_TYPE_DIRECTORY_ANCHOR_URI,
  EVENT_TYPE_OBSERVATION_URI,
  EVENT_TYPE_REVISION_URI,
  EVENT_TYPE_TOOL_CALL_URI,
  EVENT_TYPE_TRANSACTION_URI,
  EVENT_TYPE_SHORT_NAMES,
  EVENT_TYPE_SHORT_TO_URI,
  isNormativeEventTypeUri,
  isValidEventTypeUri,
  normalizeEventType,
  // canonicalization (§1.3)
  canonicalCrossAttestationInput,
  canonicalRecord,
  canonicalSigningInput,
  // signing + verification (§1.4)
  getPublicKey,
  signRecord,
  signTransactionAttestation,
  signTransactionRecord,
  verifyRecord,
  // hashing + encoding
  base64urlDecode,
  base64urlEncode,
  hexDecode,
  hexEncode,
  sha256,
  // chain composition (§1.2.3 / §1.2.3.1)
  chainRoot,
  genesisChainRoot,
  resolveChainRoot,
  // propagation (§1.5)
  decodeToken,
  encodeToken,
  extractTraceId,
  mergeBaggageAtribSession,
  mergeTracestate,
  parseBaggageAtribSession,
  parseTracestateAtrib,
  readInboundContext,
  writeOutboundContext,
  // content identity (§1.2.2)
  computeContentId,
  normalizeServerUrl,
  // log entry serialization (§2.3.1)
  eventTypeUriToByte,
  serializeEntry,
  // submission-side validation (§2.6.1 client parity)
  validateSubmission,
  // mirror conventions (§5.9)
  inheritChainContext,
  readMirrorTail,
  recordHashExistsInMirror,
  // context identity (D078/D083)
  resolveEnvContextId,
  // submission queue (§5.3.5)
  createSubmissionQueue,
} from '@atrib/mcp'
export type {
  AtribRecord,
  ChainContext,
  DecodedToken,
  EntryInput,
  ProofBundle,
  SignerEntry,
  SubmissionQueue,
  UnsignedAtribRecord,
  ValidationResult,
} from '@atrib/mcp'

// ── Key handling (§5.6), re-exported from @atrib/emit ────────────────────
export { emitInProcess, resolveKey } from '@atrib/emit'
export type { EmitOutput, ResolvedKey } from '@atrib/emit'
