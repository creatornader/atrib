// SPDX-License-Identifier: Apache-2.0

/**
 * Daemon transport: MCP Streamable HTTP client for the local primitives
 * runtime.
 *
 * Semantically stateless per the SDK brief: nothing connection-scoped carries
 * meaning. Context, trace, capabilities, and chain tokens travel on each
 * request. The v2 client negotiates the 2026-07-28 protocol through
 * server/discover and falls back to the legacy handshake for an older runtime.
 *
 * Degradation (§5.8): every operational failure is caught, logged with the
 * `atrib:` prefix, and reported as an unavailable outcome — never thrown.
 */

import { readFileSync } from 'node:fs'
import {
  Client,
  StreamableHTTPClientTransport,
  type ClientCapabilities,
} from '@modelcontextprotocol/client'
import {
  ATTRIBUTION_EXTENSION_ID,
  ATTRIBUTION_EXTENSION_VERSION,
  MCP_CLIENT_CAPABILITIES_META_KEY,
  buildAttributionRequestMeta,
  validateAttributionSettings,
  verifyAttributionReceipt,
  type AttributionAcceptValue,
  type AttributionReceiptVerification,
  type AttributionSettingsValidation,
} from '@atrib/mcp'
import {
  ATTRIBUTION_EXTENSION_KEY,
  parseAttributionReceiptBlock,
  type VerifiedAttributionReceipt,
} from './attribution.js'
import {
  DEFAULT_CALL_TIMEOUT_MS,
  DEFAULT_CONNECT_TIMEOUT_MS,
  DEFAULT_RETRY_COOLDOWN_MS,
  resolveDaemonEndpoint,
  type DaemonConfig,
} from './config.js'

export type DaemonCallOutcome =
  | {
      ok: true
      value: unknown
      transport: DaemonTransportInfo
      attribution?: VerifiedAttributionReceipt
    }
  | { ok: false; reason: string }

export type DaemonConnectionOutcome =
  | { ok: true; transport: DaemonTransportInfo }
  | { ok: false; reason: string }

export interface DaemonTransportInfo {
  protocol_version: string
  protocol_era: 'modern' | 'legacy'
  server_info?: { name: string; version: string }
  discover?: unknown
  attribution: AttributionSettingsValidation
}

/**
 * Parse + verify the `dev.atrib/attribution` block on a tool result's
 * `_meta`. The lenient parser extracts the block; `verifyAttributionReceipt`
 * runs over the RAW block (extension spec §6.2). §5.8-safe: any exception
 * degrades to a `malformed` verification, never a throw.
 */
function extractAttribution(meta: unknown): VerifiedAttributionReceipt | null {
  const block = parseAttributionReceiptBlock(meta)
  if (block === null) return null
  let verification: AttributionReceiptVerification
  try {
    const raw =
      typeof meta === 'object' && meta !== null
        ? (meta as Record<string, unknown>)[ATTRIBUTION_EXTENSION_KEY]
        : undefined
    verification = verifyAttributionReceipt(raw)
  } catch (error) {
    console.warn(`atrib: attribution receipt verification failed: ${String(error)}`)
    verification = { valid: false, mismatched: ['malformed'] }
  }
  return { block, verification }
}

function sdkVersion(): string {
  try {
    const parsed = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { version?: unknown }
    return typeof parsed.version === 'string' ? parsed.version : 'unknown'
  } catch {
    return 'unknown'
  }
}

const SDK_CLIENT_INFO = { name: 'atrib-sdk', version: sdkVersion() }
const IDEMPOTENCY_META_KEY = 'dev.atrib/idempotencyKey'

interface DaemonClientOptions {
  attributionReceipts?: boolean
  attributionAccept?: readonly AttributionAcceptValue[]
}

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
  private readonly parseReceipts: boolean
  private readonly attributionAccept: readonly AttributionAcceptValue[]
  private readonly requestMeta: Record<string, unknown>
  private readonly clientCapabilities: ClientCapabilities
  private readonly sessionToken: string | undefined
  private client: Client | null = null
  private connecting: Promise<Client | null> | null = null
  private lastFailureAt = 0
  private latestToken: string | undefined

  constructor(config?: DaemonConfig, options?: DaemonClientOptions) {
    this.endpoint = resolveDaemonEndpoint(config)
    this.connectTimeoutMs = config?.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS
    this.callTimeoutMs = config?.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS
    this.retryCooldownMs = config?.retryCooldownMs ?? DEFAULT_RETRY_COOLDOWN_MS
    this.parseReceipts = options?.attributionReceipts !== false
    this.attributionAccept = options?.attributionAccept ?? ['token']
    this.requestMeta = { ...(config?.requestMeta ?? {}) }
    this.sessionToken = config?.sessionToken
    const requestCapabilities =
      typeof this.requestMeta[MCP_CLIENT_CAPABILITIES_META_KEY] === 'object' &&
      this.requestMeta[MCP_CLIENT_CAPABILITIES_META_KEY] !== null &&
      !Array.isArray(this.requestMeta[MCP_CLIENT_CAPABILITIES_META_KEY])
        ? (this.requestMeta[MCP_CLIENT_CAPABILITIES_META_KEY] as Record<string, unknown>)
        : {}
    const configuredCapabilities = {
      ...requestCapabilities,
      ...(config?.clientCapabilities ?? {}),
    }
    const requestExtensions =
      typeof requestCapabilities['extensions'] === 'object' &&
      requestCapabilities['extensions'] !== null &&
      !Array.isArray(requestCapabilities['extensions'])
        ? (requestCapabilities['extensions'] as Record<string, unknown>)
        : {}
    const configuredExtensions =
      typeof configuredCapabilities['extensions'] === 'object' &&
      configuredCapabilities['extensions'] !== null &&
      !Array.isArray(configuredCapabilities['extensions'])
        ? (configuredCapabilities['extensions'] as Record<string, unknown>)
        : {}
    this.clientCapabilities = {
      ...configuredCapabilities,
      extensions: {
        ...requestExtensions,
        ...configuredExtensions,
        [ATTRIBUTION_EXTENSION_ID]: {
          version: ATTRIBUTION_EXTENSION_VERSION,
          accept: [...this.attributionAccept],
        },
      },
    } as ClientCapabilities
  }

  /**
   * Call one MCP tool on the daemon. Tool results carrying a single JSON
   * text block (the atrib primitive convention) are parsed; other shapes
   * are returned raw.
   */
  async callTool(
    name: string,
    args: Record<string, unknown>,
    options?: {
      idempotencyKey?: string
      contextId?: string
      token?: string
      requestMeta?: Record<string, unknown>
    },
  ): Promise<DaemonCallOutcome> {
    const client = await this.ensureClient()
    if (!client) {
      return { ok: false, reason: `daemon unreachable at ${this.endpoint}` }
    }
    try {
      const effectiveToken = options?.token ?? this.latestToken
      const result = await withTimeout(
        client.callTool({
          name,
          arguments: args,
          _meta: buildAttributionRequestMeta(
            {
              ...this.requestMeta,
              ...(options?.requestMeta ?? {}),
              [MCP_CLIENT_CAPABILITIES_META_KEY]: this.clientCapabilities,
              ...(options?.idempotencyKey !== undefined
                ? { [IDEMPOTENCY_META_KEY]: options.idempotencyKey }
                : {}),
            },
            {
              accept: this.attributionAccept,
              ...(options?.contextId !== undefined ? { contextId: options.contextId } : {}),
              ...(effectiveToken !== undefined ? { token: effectiveToken } : {}),
              ...(this.sessionToken !== undefined ? { sessionToken: this.sessionToken } : {}),
            },
          ),
        }),
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
      const attribution = this.parseReceipts
        ? extractAttribution((result as { _meta?: unknown })._meta)
        : null
      if (attribution?.verification.valid === true && attribution.block.token !== undefined) {
        this.latestToken = attribution.block.token
      }
      const transport = this.connectionInfo(client)
      const withAttribution = (value: unknown): DaemonCallOutcome =>
        attribution !== null
          ? { ok: true, value, transport, attribution }
          : { ok: true, value, transport }
      if (text === undefined) {
        return withAttribution(result)
      }
      try {
        return withAttribution(JSON.parse(text))
      } catch {
        return withAttribution(text)
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

  getConnectionInfo(): DaemonTransportInfo | null {
    return this.client ? this.connectionInfo(this.client) : null
  }

  async connect(): Promise<DaemonConnectionOutcome> {
    const client = await this.ensureClient()
    return client
      ? { ok: true, transport: this.connectionInfo(client) }
      : { ok: false, reason: `daemon unreachable at ${this.endpoint}` }
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
      let client: Client | null = null
      try {
        // URL parsing stays INSIDE the try: a garbage endpoint is an
        // operational failure that must degrade (§5.8), never throw.
        const url = new URL(this.endpoint)
        const transport = new StreamableHTTPClientTransport(url)
        client = new Client(SDK_CLIENT_INFO, {
          capabilities: this.clientCapabilities,
          versionNegotiation: { mode: 'auto' },
        })
        await withTimeout(client.connect(transport), this.connectTimeoutMs, 'daemon connect')
        this.client = client
        this.lastFailureAt = 0
        return client
      } catch (error) {
        this.lastFailureAt = Date.now()
        if (client) {
          try {
            await client.close()
          } catch {
            // Ignore close failures on a connection that never established.
          }
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

  private connectionInfo(client: Client): DaemonTransportInfo {
    const protocolVersion = client.getNegotiatedProtocolVersion() ?? 'unknown'
    const protocolEra = client.getProtocolEra() ?? 'legacy'
    const serverInfo = client.getServerVersion()
    const serverCapabilities = client.getServerCapabilities() as
      | { extensions?: Record<string, unknown> }
      | undefined
    return {
      protocol_version: protocolVersion,
      protocol_era: protocolEra,
      ...(serverInfo !== undefined
        ? { server_info: { name: serverInfo.name, version: serverInfo.version } }
        : {}),
      ...(client.getDiscoverResult() !== undefined
        ? { discover: client.getDiscoverResult() }
        : {}),
      attribution: validateAttributionSettings(
        serverCapabilities?.extensions?.[ATTRIBUTION_EXTENSION_ID],
      ),
    }
  }
}
