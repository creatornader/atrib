// @atrib/agent, Public API

// Middleware (primary export)
export { atrib } from './middleware.js'
export type { AgentAtribOptions, ToolCallInterceptor } from './middleware.js'

// Session state (for advanced usage)
export { createSession, buildOutboundMeta, accumulateInboundContext } from './session.js'
export type { SessionState, LatestContext } from './session.js'

// Transaction detection
export { detectTransaction } from './transaction.js'
export type { TransactionDetection } from './transaction.js'

// Policy negotiation
export { initializeSessionPolicy } from './policy.js'
export type { SessionPolicyRecord, PolicyDocument, CreatorPolicyEntry } from './policy.js'

// Framework adapters
export { wrapMcpClient } from './adapters/mcp-client.js'
export type {
  MinimalMcpClient,
  WrapMcpClientOptions,
} from './adapters/mcp-client.js'
