// SPDX-License-Identifier: Apache-2.0

/**
 * Worker-safe @atrib/mcp entrypoint.
 *
 * The package root exports Node-only helpers such as stdio proxying, local
 * mirror readers, and host-side instrumentation. Cloudflare Workers should
 * import this subpath so bundlers see only modules that can run in the Worker
 * runtime.
 */

export { atrib } from './middleware.js'
export type {
  AtribOptions,
  AtribServer,
  OnRecordSidecar,
  PreCallTransform,
  PreCallTransformContext,
} from './middleware.js'

export type { AtribRecord, UnsignedAtribRecord, DecodedToken, SignerEntry } from './types.js'
export {
  EVENT_TYPE_TOOL_CALL_URI,
  EVENT_TYPE_TRANSACTION_URI,
  EVENT_TYPE_OBSERVATION_URI,
  EVENT_TYPE_DIRECTORY_ANCHOR_URI,
  EVENT_TYPE_ANNOTATION_URI,
  EVENT_TYPE_REVISION_URI,
  NORMATIVE_EVENT_TYPE_URIS,
  isValidEventTypeUri,
  isNormativeEventTypeUri,
} from './types.js'

export { base64urlEncode, base64urlDecode } from './base64url.js'
export { canonicalSigningInput, canonicalRecord, canonicalCrossAttestationInput } from './canon.js'
export { chainRoot, genesisChainRoot, resolveChainRoot } from './chain-root.js'
export { computeContentId, normalizeServerUrl } from './content-id.js'
export {
  readInboundContext,
  writeOutboundContext,
  parseTracestateAtrib,
  parseBaggageAtribSession,
  extractTraceId,
  mergeTracestate,
  mergeBaggageAtribSession,
} from './context.js'
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
export { sha256, hexEncode, hexDecode } from './hash.js'
export {
  leafHash,
  nodeHash,
  computeRoot,
  computeInclusionProof,
  verifyInclusion,
} from './merkle.js'
export { formatProofBundle, parseProofBundle } from './proof-text.js'
export { SHA256_REF_PATTERN, SHA256_REF_GLOBAL_PATTERN, extractRecordHashes } from './refs.js'
export {
  getPublicKey,
  signRecord,
  signTransactionAttestation,
  signTransactionRecord,
  verifyRecord,
} from './signing.js'
export { createSubmissionQueue } from './submission.js'
export type { SubmissionQueue, ProofBundle } from './submission.js'
export { encodeToken, decodeToken } from './token.js'
export { validateSubmission, type ValidationResult } from './validation.js'
export { zeroize } from './zeroize.js'
