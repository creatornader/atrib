// SPDX-License-Identifier: Apache-2.0

// @atrib/agent — Public API

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
export type { MinimalMcpClient, WrapMcpClientOptions } from './adapters/mcp-client.js'

// Cloudflare Agents adapter — wraps MCP connections on a Cloudflare `Agent`
// (or `AIChatAgent`) after `addMcpServer` so subsequent tool calls flow
// through Atrib's interceptor lifecycle.
export { attributeCloudflareAgentMcp } from './adapters/cloudflare-agent.js'
export type {
  CloudflareAgentLike,
  AttributeCloudflareAgentMcpOptions,
} from './adapters/cloudflare-agent.js'

// Vercel AI SDK MCP adapter — patches an `@ai-sdk/mcp` MCPClient's `request`
// method so every outbound `tools/call` flows through Atrib's interceptor.
// The Vercel client has its own JSON-RPC implementation (NOT
// `@modelcontextprotocol/sdk` Client), so `wrapMcpClient` does not apply.
export { attributeVercelAiSdkMcp } from './adapters/vercel-ai-sdk-mcp.js'
export type {
  VercelAiSdkMcpClientLike,
  AttributeVercelAiSdkMcpOptions,
} from './adapters/vercel-ai-sdk-mcp.js'

// LangChain JS MCP adapter — patches every internal `@modelcontextprotocol/sdk`
// Client owned by a `@langchain/mcp-adapters` `MultiServerMCPClient` so every
// outbound `tools/call` (and every forked client from per-call-header
// workflows) flows through Atrib's interceptor.
export { attributeLangchainMcp } from './adapters/langchain-mcp.js'
export type {
  LangchainMcpClientLike,
  LangchainMultiServerMcpClientLike,
  AttributeLangchainMcpOptions,
} from './adapters/langchain-mcp.js'
