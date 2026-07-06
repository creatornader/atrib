// SPDX-License-Identifier: Apache-2.0

/**
 * Daemon transport: MCP Streamable HTTP client for the local primitives
 * runtime.
 *
 * Semantically stateless per the SDK brief: nothing session-scoped carries
 * meaning — context_id and chain tokens travel as explicit tool arguments
 * on every call. The MCP protocol session (initialize handshake +
 * Mcp-Session-Id) is a transport detail of the CURRENT runtime that the
 * official client manages; when the post-2026-07-28 stateless transport
 * ships, this class swaps transports without changing the SDK surface.
 *
 * Degradation (§5.8): every operational failure is caught, logged with the
 * `atrib:` prefix, and reported as an unavailable outcome — never thrown.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import {
  DEFAULT_CALL_TIMEOUT_MS,
  DEFAULT_CONNECT_TIMEOUT_MS,
  DEFAULT_RETRY_COOLDOWN_MS,
  resolveDaemonEndpoint,
  type DaemonConfig,
} from './config.js'

export type DaemonCallOutcome =
  | { ok: true; value: unknown }
  | { ok: false; reason: string }

const SDK_CLIENT_INFO = { name: 'atrib-sdk', version: '0.1.0' }

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`atrib: ${label} timed out after ${ms}ms`)), ms)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

export class DaemonClient {
  private readonly endpoint: string
  private readonly connectTimeoutMs: number
  private readonly callTimeoutMs: number
  private readonly retryCooldownMs: number
  private client: Client | null = null
  private connecting: Promise<Client | null> | null = null
  private lastFailureAt = 0

  constructor(config?: DaemonConfig) {
    this.endpoint = resolveDaemonEndpoint(config)
    this.connectTimeoutMs = config?.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS
    this.callTimeoutMs = config?.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS
    this.retryCooldownMs = config?.retryCooldownMs ?? DEFAULT_RETRY_COOLDOWN_MS
  }

  /**
   * Call one MCP tool on the daemon. Tool results carrying a single JSON
   * text block (the atrib primitive convention) are parsed; other shapes
   * are returned raw.
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<DaemonCallOutcome> {
    const client = await this.ensureClient()
    if (!client) {
      return { ok: false, reason: `daemon unreachable at ${this.endpoint}` }
    }
    try {
      const result = await withTimeout(
        client.callTool({ name, arguments: args }),
        this.callTimeoutMs,
        `tools/call ${name}`,
      )
      const content = (result as { content?: Array<{ type?: string; text?: string }> }).content
      const isError = (result as { isError?: boolean }).isError === true
      const text =
        Array.isArray(content) && content[0]?.type === 'text' ? content[0].text : undefined
      if (isError) {
        return { ok: false, reason: `daemon tool ${name} errored: ${text ?? 'unknown error'}` }
      }
      if (text === undefined) {
        return { ok: true, value: result }
      }
      try {
        return { ok: true, value: JSON.parse(text) }
      } catch {
        return { ok: true, value: text }
      }
    } catch (error) {
      // A failed call may mean the transport session died; drop the client
      // so the next call reconnects (after cooldown).
      await this.close()
      this.lastFailureAt = Date.now()
      const reason = error instanceof Error ? error.message : String(error)
      console.warn(`atrib: daemon call ${name} failed: ${reason}`)
      return { ok: false, reason }
    }
  }

  async close(): Promise<void> {
    const client = this.client
    this.client = null
    if (client) {
      try {
        await client.close()
      } catch {
        // Best-effort close per §5.8.
      }
    }
  }

  private async ensureClient(): Promise<Client | null> {
    if (this.client) return this.client
    if (this.connecting) return this.connecting
    if (this.lastFailureAt > 0 && Date.now() - this.lastFailureAt < this.retryCooldownMs) {
      return null
    }
    this.connecting = (async () => {
      // The SDK's concrete transport declares `sessionId: string | undefined`
      // while the Transport interface under exactOptionalPropertyTypes wants
      // an optional property; the runtime shapes are identical.
      const transport = new StreamableHTTPClientTransport(
        new URL(this.endpoint),
      ) as unknown as Transport
      const client = new Client(SDK_CLIENT_INFO)
      try {
        await withTimeout(client.connect(transport), this.connectTimeoutMs, 'daemon connect')
        this.client = client
        this.lastFailureAt = 0
        return client
      } catch (error) {
        this.lastFailureAt = Date.now()
        try {
          await client.close()
        } catch {
          // Ignore close failures on a connection that never established.
        }
        const reason = error instanceof Error ? error.message : String(error)
        console.warn(`atrib: daemon connect failed (${this.endpoint}): ${reason}`)
        return null
      } finally {
        this.connecting = null
      }
    })()
    return this.connecting
  }
}
