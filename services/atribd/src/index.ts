#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0

/**
 * atribd: the local daemon for atrib's cognitive surface.
 *
 * One host-owned process mounts the attest write home, the recall read
 * home, and summarize in process and serves the seventeen-tool alias-window
 * union (fifteen legacy names plus the attest and recall verbs) as thin
 * aliases over two internal handlers (write, read). Transports: stateless Streamable HTTP (the
 * recommended daemon topology), direct stdio (in-process), and a
 * stdio-to-HTTP proxy shim for startup-spawn harnesses.
 *
 * Signed records are byte-identical to the standalone per-primitive
 * binaries: the daemon calls the same handler code paths with the same
 * `_local.producer` sidecar labels, and never reimplements chain-root
 * selection (D067; `resolveChainRoot` in @atrib/mcp stays the single
 * source of truth).
 */

import { pathToFileURL } from 'node:url'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  bindAtribdHttpHost,
  httpEndpoint,
  normalizeMcpPath,
  DEFAULT_HTTP_HOST,
  DEFAULT_HTTP_PATH,
  DEFAULT_HTTP_PORT,
  DEFAULT_TOOLS_LIST_TTL_MS,
} from './http-host.js'
import { createAtribdHttpProxyRuntime, createAtribdRuntime } from './stdio.js'
import { DEFAULT_TOOL_TIMEOUT_MS } from './backend.js'

export {
  createAtribdBackend,
  callWithToolTimeout,
  readPackageVersion,
  runtimeContractsDegraded,
  toolCallDiagnosticsDegraded,
  writeSerializationKey,
  ContextWriteLocks,
  logDaemonEvent,
  errorMessage,
  PRIMITIVE_SPECS,
  WRITE_TOOL_NAMES,
  DEFAULT_TOOL_TIMEOUT_MS,
  type AtribdBackend,
  type AtribdBackendOptions,
  type AtribdPrimitiveFactory,
  type AtribdPrimitiveHandle,
  type AtribdHandlerKind,
  type AtribdDiagnostics,
  type AtribdToolCallDiagnostic,
  type AtribdRuntimeContracts,
  type AtribdRuntimeContractDiagnostic,
  type AtribdSurfaceContractDiagnostic,
  type AtribdBehavioralProbeDiagnostic,
} from './backend.js'
export {
  applyHttpContextPolicy,
  MISSING_CONTEXT_ERROR_TEXT,
  type HttpContextPolicyOutcome,
} from './context-policy.js'
export {
  createSessionSdkStatelessAdapter,
  type AtribdTransportAdapter,
  type SessionSdkStatelessAdapterOptions,
} from './transport-adapter.js'
export {
  bindAtribdHttpHost,
  createAtribdServer,
  routingHeaderMismatch,
  httpEndpoint,
  normalizeMcpPath,
  healthPathFor,
  DEFAULT_HTTP_HOST,
  DEFAULT_HTTP_PORT,
  DEFAULT_HTTP_PATH,
  DEFAULT_TOOLS_LIST_TTL_MS,
  type AtribdHttpHost,
  type AtribdHttpHostOptions,
  type AtribdRequestCounters,
  type AtribdServerFactoryOptions,
} from './http-host.js'
export {
  createAtribdRuntime,
  createAtribdHttpProxyRuntime,
  type AtribdRuntime,
  type AtribdRuntimeOptions,
} from './stdio.js'

type TransportMode = 'stdio' | 'streamable-http' | 'stdio-http-proxy'

interface CliOptions {
  transport: TransportMode
  host: string
  port: number
  path: string
  endpoint: string
  json: boolean
  toolTimeoutMs: number
  toolsListTtlMs: number
  ambientContext: boolean
  help: boolean
}

function envString(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]
    if (value !== undefined && value !== '') return value
  }
  return undefined
}

const TRUE_ENV_VALUES = new Set(['1', 'true', 'yes', 'on'])

function envFlag(...names: string[]): boolean {
  const raw = envString(...names)
  return raw !== undefined && TRUE_ENV_VALUES.has(raw.trim().toLowerCase())
}

function requireArg(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index]
  if (value === undefined) throw new Error(`${flag} requires a value`)
  return value
}

function parsePort(raw: string): number {
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 0 || n > 65535) {
    throw new Error('--port must be an integer from 0 to 65535')
  }
  return n
}

function parseOptionalPort(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === '') return undefined
  return parsePort(raw)
}

function parsePositiveInt(raw: string, name: string): number {
  const n = Number(raw)
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
  return n
}

function parseOptionalPositiveInt(raw: string | undefined, name: string): number | undefined {
  if (raw === undefined || raw === '') return undefined
  return parsePositiveInt(raw, name)
}

function normalizeHttpEndpoint(raw: string, flag: string): string {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('unsupported protocol')
    }
    return url.toString()
  } catch {
    throw new Error(`${flag} must be an absolute HTTP URL`)
  }
}

function deprecatedSessionIdleNotice(source: string): void {
  process.stderr.write(
    `atribd: ${source} is ignored; the stateless daemon has no HTTP sessions to expire\n`,
  )
}

export function parseCliOptions(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    transport: 'stdio',
    host: envString('ATRIBD_HTTP_HOST', 'ATRIB_PRIMITIVES_HTTP_HOST') ?? DEFAULT_HTTP_HOST,
    port:
      parseOptionalPort(envString('ATRIBD_HTTP_PORT', 'ATRIB_PRIMITIVES_HTTP_PORT')) ??
      DEFAULT_HTTP_PORT,
    path: envString('ATRIBD_HTTP_PATH', 'ATRIB_PRIMITIVES_HTTP_PATH') ?? DEFAULT_HTTP_PATH,
    endpoint:
      envString('ATRIBD_HTTP_ENDPOINT', 'ATRIB_PRIMITIVES_HTTP_ENDPOINT') ??
      httpEndpoint(DEFAULT_HTTP_HOST, DEFAULT_HTTP_PORT, DEFAULT_HTTP_PATH),
    json: false,
    toolTimeoutMs:
      parseOptionalPositiveInt(
        envString('ATRIBD_TOOL_TIMEOUT_MS', 'ATRIB_PRIMITIVES_TOOL_TIMEOUT_MS'),
        'ATRIBD_TOOL_TIMEOUT_MS',
      ) ?? DEFAULT_TOOL_TIMEOUT_MS,
    toolsListTtlMs:
      parseOptionalPositiveInt(envString('ATRIBD_TOOLS_LIST_TTL_MS'), 'ATRIBD_TOOLS_LIST_TTL_MS') ??
      DEFAULT_TOOLS_LIST_TTL_MS,
    ambientContext: envFlag('ATRIBD_AMBIENT_CONTEXT'),
    help: false,
  }

  // Deprecated session-era configuration: honored as a no-op with a
  // one-line stderr notice, never a fatal error (§5.8 posture toward
  // configuration drift).
  if (envString('ATRIB_PRIMITIVES_SESSION_IDLE_MS') !== undefined) {
    deprecatedSessionIdleNotice('ATRIB_PRIMITIVES_SESSION_IDLE_MS')
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') {
      options.help = true
    } else if (arg === '--http') {
      options.transport = 'streamable-http'
    } else if (arg === '--transport') {
      const value = requireArg(argv, ++i, '--transport')
      if (value !== 'stdio' && value !== 'streamable-http' && value !== 'stdio-http-proxy') {
        throw new Error('--transport must be stdio, streamable-http, or stdio-http-proxy')
      }
      options.transport = value
    } else if (arg === '--endpoint') {
      options.endpoint = requireArg(argv, ++i, '--endpoint')
    } else if (arg === '--host') {
      options.host = requireArg(argv, ++i, '--host')
    } else if (arg === '--port') {
      options.port = parsePort(requireArg(argv, ++i, '--port'))
    } else if (arg === '--path') {
      options.path = requireArg(argv, ++i, '--path')
    } else if (arg === '--json') {
      options.json = true
    } else if (arg === '--tool-timeout-ms') {
      options.toolTimeoutMs = parsePositiveInt(
        requireArg(argv, ++i, '--tool-timeout-ms'),
        '--tool-timeout-ms',
      )
    } else if (arg === '--tools-list-ttl-ms') {
      options.toolsListTtlMs = parsePositiveInt(
        requireArg(argv, ++i, '--tools-list-ttl-ms'),
        '--tools-list-ttl-ms',
      )
    } else if (arg === '--ambient-context') {
      options.ambientContext = true
    } else if (arg === '--session-idle-ms') {
      requireArg(argv, ++i, '--session-idle-ms')
      deprecatedSessionIdleNotice('--session-idle-ms')
    } else {
      throw new Error(`unknown argument: ${arg}`)
    }
  }

  options.path = normalizeMcpPath(options.path)
  options.endpoint = normalizeHttpEndpoint(options.endpoint, '--endpoint')
  return options
}

function usage(): string {
  return `Usage:
  atribd [--transport stdio]
  atribd --transport streamable-http [--host 127.0.0.1] [--port 8796] [--path /mcp]
  atribd --transport stdio-http-proxy --endpoint http://127.0.0.1:8796/mcp

Options:
  --http                         Alias for --transport streamable-http.
  --transport <mode>             stdio, streamable-http, or stdio-http-proxy. Defaults to stdio.
  --endpoint <url>               HTTP MCP endpoint for stdio-http-proxy mode.
  --host <host>                  HTTP bind host. Defaults to 127.0.0.1.
  --port <port>                  HTTP bind port. Defaults to 8796. Use 0 for ephemeral.
  --path <path>                  HTTP MCP path. Defaults to /mcp.
  --tool-timeout-ms <ms>         Bound each primitive tool call. Defaults to 45000.
  --tools-list-ttl-ms <ms>       SEP-2549 freshness hint on tools/list. Defaults to 5 minutes (alias-window W2).
  --ambient-context              Opt the HTTP surface back into ambient context discovery
                                 (D078/D083). Default is explicit-required.
  --session-idle-ms <ms>         Deprecated; ignored (the stateless daemon has no sessions).
  --json                         Print a JSON ready line in HTTP mode.
  --help                         Print this help.
`
}

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2))
  if (options.help) {
    process.stdout.write(usage())
    return
  }

  if (options.transport === 'streamable-http') {
    const host = await bindAtribdHttpHost({
      host: options.host,
      port: options.port,
      path: options.path,
      jsonReady: options.json,
      toolTimeoutMs: options.toolTimeoutMs,
      toolsListTtlMs: options.toolsListTtlMs,
      ambientContext: options.ambientContext,
    })
    const shutdown = async () => {
      try {
        await host.close()
      } finally {
        process.exit(0)
      }
    }
    process.once('SIGINT', shutdown)
    process.once('SIGTERM', shutdown)
    if (!options.json) {
      process.stderr.write(`atribd: listening at ${host.endpoint}\n`)
    }
    return
  }

  const runtime =
    options.transport === 'stdio-http-proxy'
      ? await createAtribdHttpProxyRuntime(options.endpoint, {
          toolTimeoutMs: options.toolTimeoutMs,
        })
      : await createAtribdRuntime({
          toolTimeoutMs: options.toolTimeoutMs,
          toolsListTtlMs: options.toolsListTtlMs,
        })
  const shutdown = async () => {
    try {
      await runtime.close()
    } finally {
      process.exit(0)
    }
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)

  const transport = new StdioServerTransport()
  await runtime.server.connect(transport)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    process.stderr.write(
      `atribd: fatal ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`,
    )
    process.exit(1)
  })
}
