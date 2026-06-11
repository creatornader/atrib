#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0

// Generic config-driven MCP wrapper CLI entrypoint.
//
// Usage:
//   atrib-wrap                           # reads $ATRIB_WRAP_CONFIG or ~/.atrib/wrap-config.json
//   atrib-wrap path/to/config.json       # reads the given path
//
// On startup:
//   1. Parses the config (zod validates).
//   2. Resolves the signing key (env / file / Keychain / 1Password).
//   3. Spawns the upstream MCP server.
//   4. Applies @atrib/mcp middleware to every tool call.
//   5. Connects to stdio so the host (Claude Code, Cursor, etc.) talks to it
//      as a normal MCP server.
//
// Errors during config or key resolution exit non-zero so operator
// misconfigurations surface immediately rather than silently degrading.

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { parseConfig } from './config.js'
import {
  installWrapperLifecycle,
  type WrapperShutdownDetails,
  type WrapperShutdownReason,
} from './lifecycle.js'
import { ensureSecureDir, secureAppend } from './paths.js'
import { wrap } from './wrap.js'

const DEFAULT_CONFIG_PATH = join(homedir(), '.atrib', 'wrap-config.json')

function findConfigPath(): string {
  const argPath = process.argv[2]
  if (argPath) return argPath
  return process.env['ATRIB_WRAP_CONFIG'] ?? DEFAULT_CONFIG_PATH
}

async function main(): Promise<void> {
  const configPath = findConfigPath()
  if (!existsSync(configPath)) {
    console.error(
      `[mcp-wrap] config not found at ${configPath}. Pass a path as argv[1] or set ATRIB_WRAP_CONFIG.`,
    )
    process.exit(1)
  }

  let config
  try {
    const raw = JSON.parse(readFileSync(configPath, 'utf-8'))
    config = parseConfig(raw)
  } catch (err) {
    console.error(
      `[mcp-wrap] config invalid at ${configPath}: ${err instanceof Error ? err.message : String(err)}`,
    )
    process.exit(1)
  }

  // File logger. Wrapper stderr is invisible in most MCP hosts (Claude Code,
  // Cursor discard it). A file log is the only operator-visible debug surface.
  const log = (level: 'info' | 'warn' | 'error', msg: string, extra?: Record<string, unknown>) => {
    const logFile =
      config.logFile ??
      join(
        homedir(),
        '.atrib',
        'logs',
        config.name === config.agent ? `${config.name}.log` : `${config.name}-${config.agent}.log`,
      )
    if (!logFile) return
    try {
      ensureSecureDir(dirname(logFile))
      secureAppend(
        logFile,
        JSON.stringify({
          ts: new Date().toISOString(),
          level,
          name: config.name,
          agent: config.agent,
          msg,
          ...(extra ?? {}),
        }) + '\n',
      )
    } catch {
      // File logging itself failed. Fall back to stderr; don't crash the wrapper.
      console.error(`[mcp-wrap] file logging failed for ${logFile}`)
    }
  }

  let result
  try {
    result = await wrap(config, { log })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log('error', 'wrap bootstrap failed', { error: msg })
    console.error(`[mcp-wrap] bootstrap failed: ${msg}`)
    process.exit(1)
  }

  log('info', 'wrapper starting', {
    serverUrl: config.serverUrl,
    logEndpoint: config.logEndpoint,
    localSubstrateMode: config.localSubstrate?.mode,
    upstreamCommand: config.upstream.command,
    keySource: result.key.source,
    pid: process.pid,
  })

  const transport = new StdioServerTransport()
  await result.proxy.server.connect(transport)
  log('info', 'wrapper ready, awaiting host stdio')

  const shutdown = async (reason: WrapperShutdownReason, details: WrapperShutdownDetails = {}) => {
    log('info', 'wrapper shutting down', { reason, ...details })
    try {
      await transport.close()
    } catch (err) {
      log('warn', 'host transport close failed during shutdown', {
        reason,
        error: err instanceof Error ? err.message : String(err),
      })
    }
    await result.proxy.close()
  }
  installWrapperLifecycle({ shutdown, log })
}

main().catch((err) => {
  console.error('[mcp-wrap] unhandled bootstrap error:', err)
  process.exit(1)
})
