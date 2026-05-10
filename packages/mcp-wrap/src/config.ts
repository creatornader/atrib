// Wrapper config schema. The single contract by which an operator configures
// any MCP server to be wrapped: a JSON object describing the upstream
// command, identity (agent name), where to mirror records, and optional
// per-tool overrides.
//
// Two ways to source the config:
//   1. JSON file at $ATRIB_WRAP_CONFIG (default: ~/.atrib/wrap-config.json)
//   2. Environment variables (ATRIB_WRAP_*), overrides the file when both
//      present so operators can flip behavior without editing the file.

import { z } from 'zod'

/**
 * Per-tool override. When `transactionTool: true`, the named tool emits a
 * transaction record (event_type=transaction) instead of a tool_call record.
 *
 * `injectReceiptId: true` enables the @atrib/mcp preCallTransform hook for
 * this specific tool, useful when the upstream tool writes data to durable
 * storage and downstream consumers want to anchor `informed_by` references
 * to the row produced by the call. The receipt_id is injected into the tool
 * args under the name `atrib_receipt_id` (the convention established by
 * Loop 5 / D057).
 */
export const ToolOverrideSchema = z.object({
  transactionTool: z.boolean().optional(),
  injectReceiptId: z.boolean().optional(),
})

export type ToolOverride = z.infer<typeof ToolOverrideSchema>

export const WrapConfigSchema = z.object({
  /**
   * Logical name for THIS wrapped server. Used in:
   *   - the proxy McpServer name surfaced to the host
   *   - default record mirror file path: ~/.atrib/records/<name>.jsonl
   *   - default debug log file path: ~/.atrib/logs/<name>.log
   *   - Keychain service lookup: atrib-creator-<agent> (when agent is set)
   */
  name: z.string().min(1),

  /**
   * Identity hint used in:
   *   - Keychain service lookup: atrib-creator-<agent>
   *   - serverUrl path segment: <serverUrl>/<agent>
   *   - default record mirror filename: <name>-<agent>.jsonl when distinct
   * Defaults to "claude-code" because that matches the most common operator
   * setup (see atrib-emit's resolveKey default).
   */
  agent: z.string().min(1).default('claude-code'),

  /**
   * Upstream MCP server command. Required. The wrapper spawns this as a
   * child process and proxies tool calls to it via stdio.
   */
  upstream: z.object({
    command: z.string().min(1),
    args: z.array(z.string()).optional(),
    /**
     * Extra environment variables to forward to the upstream process. Merged
     * with `process.env` (process.env wins on key conflicts). Useful for
     * wrappers that need to forward a config file the upstream reads (e.g.
     * AGENT_BRIDGE_URL, AGENT_BRIDGE_KEY).
     */
    env: z.record(z.string(), z.string()).optional(),
  }),

  /**
   * Canonical URL for content_id derivation per spec §1.2.2. Required for
   * unique content_ids across stdio MCP servers (no host header to derive
   * from). Path segment for `agent` is appended automatically.
   *
   * Example: `serverUrl: "mcp://my-server.local"` + `agent: "claude-code"`
   *          → effective serverUrl = "mcp://my-server.local/claude-code"
   */
  serverUrl: z.string().min(1),

  /** Log submission endpoint. Defaults to atrib production log. */
  logEndpoint: z.string().url().default('https://log.atrib.dev/v1/entries'),

  /**
   * Whether to chain successive tool calls within this wrapper's process
   * lifetime. Defaults true: the dogfood-loop's central claim ("agents
   * reason from a past they can prove") requires CHAIN_PRECEDES edges, and
   * stdio hosts (Claude Code, Cursor) do not propagate atrib's outbound
   * _meta token. Set false to opt out per-wrapper.
   */
  autoChain: z.boolean().default(true),

  /**
   * Per-tool overrides keyed by tool name. Tools not listed get default
   * behavior (signed as tool_call records, no receipt injection).
   */
  tools: z.record(z.string(), ToolOverrideSchema).optional(),

  /**
   * File paths. Both default to `~/.atrib/{logs,records}/<name>.{log,jsonl}`.
   * Set explicitly to override (or to an empty string to disable that file).
   */
  logFile: z.string().optional(),
  recordFile: z.string().optional(),
})

export type WrapConfig = z.infer<typeof WrapConfigSchema>

/** Load + validate config from a JSON object (already-parsed). */
export function parseConfig(raw: unknown): WrapConfig {
  return WrapConfigSchema.parse(raw)
}
