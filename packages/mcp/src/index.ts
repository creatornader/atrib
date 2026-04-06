// @atrib/mcp — Public API

// Middleware (primary export)
export { atrib } from './middleware.js'
export type { AtribOptions, AtribServer } from './middleware.js'

// Proxy: in-process McpServer that forwards to an upstream MCP server with
// attribution applied at the proxy layer. Use for hosts that accept an
// in-process McpServer instance (Claude Agent SDK, Cloudflare Agents).
export { createAtribProxy } from './proxy.js'
export type { AtribProxy, AtribProxyOptions, UpstreamTransport } from './proxy.js'

// Types
export type { AtribRecord, UnsignedAtribRecord, DecodedToken } from './types.js'
export { VALID_EVENT_TYPES } from './types.js'

// Core primitives
export { base64urlEncode, base64urlDecode } from './base64url.js'
export { sha256, hexEncode, hexDecode } from './hash.js'
export { canonicalSigningInput, canonicalRecord } from './canon.js'
export { getPublicKey, signRecord, verifyRecord } from './signing.js'
export { computeContentId, normalizeServerUrl } from './content-id.js'
export { genesisChainRoot, chainRoot } from './chain-root.js'
export { encodeToken, decodeToken } from './token.js'

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
export type { SubmissionQueue, ProofBundle } from './submission.js'
