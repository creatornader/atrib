#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0

// Host-owned local substrate coordinator entrypoint.
//
// This is a supervised local process, not an MCP server. It reuses the
// existing @atrib/emit key resolver so the coordinator signs under the same
// creator identity as emit and the wrapper.

import {
  LOCAL_SUBSTRATE_HARNESS_CLASSES,
  LOCAL_SUBSTRATE_NODE_DEFAULT_HOST,
  LOCAL_SUBSTRATE_NODE_DEFAULT_MAX_BODY_BYTES,
  LOCAL_SUBSTRATE_NODE_DEFAULT_PORT,
  base64urlEncode,
  bindLocalSubstrateCoordinatorNodeServer,
  createInProcessLocalSubstrateCoordinator,
  type InProcessLocalSubstrateCoordinator,
  type LocalSubstrateHarnessClass,
  type LocalSubstrateNodeServerHandle,
} from '@atrib/mcp'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveKey, type ResolvedKey } from './keys.js'

const DEFAULT_SHUTDOWN_TIMEOUT_MS = 2000
const supportedHarnessClasses = new Set<string>(LOCAL_SUBSTRATE_HARNESS_CLASSES)

interface ParsedArgs {
  host?: string
  port?: number
  maxBodyBytes?: number
  logEndpoint?: string
  logSubmission?: 'enabled' | 'disabled'
  harnessClasses?: LocalSubstrateHarnessClass[]
  shutdownTimeoutMs?: number
  showVersion: boolean
  showHelp: boolean
  showDescribe: boolean
  jsonOutput: boolean
}

interface HostDescription {
  name: 'atrib-local-substrate'
  version: string
  description: string
  options: Array<{ flag: string; takes_value: boolean; description: string }>
  env_vars: Array<{ name: string; description: string; required: boolean }>
}

interface StartHostOptions {
  key: ResolvedKey
  host?: string
  port?: number
  maxBodyBytes?: number
  logEndpoint?: string
  logSubmission?: 'enabled' | 'disabled'
  harnessClasses?: readonly LocalSubstrateHarnessClass[]
  shutdownTimeoutMs?: number
}

interface LocalSubstrateHostHandle {
  coordinator: InProcessLocalSubstrateCoordinator
  server: LocalSubstrateNodeServerHandle
  close: () => Promise<void>
}

function parseArgs(argv: readonly string[], env: NodeJS.ProcessEnv = process.env): ParsedArgs {
  const out: ParsedArgs = {
    showVersion: false,
    showHelp: false,
    showDescribe: false,
    jsonOutput: false,
  }

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--version' || a === '-v') {
      out.showVersion = true
      continue
    }
    if (a === '--help' || a === '-h') {
      out.showHelp = true
      continue
    }
    if (a === '--describe') {
      out.showDescribe = true
      continue
    }
    if (a === '--json') {
      out.jsonOutput = true
      continue
    }
    if (a === '--host') {
      out.host = requireValue(argv, ++i, '--host')
      continue
    }
    if (a === '--port') {
      out.port = parsePort(requireValue(argv, ++i, '--port'), '--port')
      continue
    }
    if (a === '--max-body-bytes') {
      out.maxBodyBytes = parsePositiveInt(
        requireValue(argv, ++i, '--max-body-bytes'),
        '--max-body-bytes',
      )
      continue
    }
    if (a === '--log-endpoint') {
      out.logEndpoint = requireValue(argv, ++i, '--log-endpoint')
      continue
    }
    if (a === '--log-submission') {
      out.logSubmission = parseLogSubmission(requireValue(argv, ++i, '--log-submission'))
      continue
    }
    if (a === '--harness-classes') {
      out.harnessClasses = parseHarnessClasses(requireValue(argv, ++i, '--harness-classes'))
      continue
    }
    if (a === '--shutdown-timeout-ms') {
      out.shutdownTimeoutMs = parsePositiveInt(
        requireValue(argv, ++i, '--shutdown-timeout-ms'),
        '--shutdown-timeout-ms',
      )
      continue
    }
    throw new Error(`unknown argument: ${a}`)
  }

  out.host = out.host ?? parseOptionalString(env['ATRIB_LOCAL_SUBSTRATE_HOST'])
  out.port =
    out.port ?? parseOptionalPort(env['ATRIB_LOCAL_SUBSTRATE_PORT'], 'ATRIB_LOCAL_SUBSTRATE_PORT')
  out.maxBodyBytes =
    out.maxBodyBytes ??
    parseOptionalPositiveInt(
      env['ATRIB_LOCAL_SUBSTRATE_MAX_BODY_BYTES'],
      'ATRIB_LOCAL_SUBSTRATE_MAX_BODY_BYTES',
    )
  out.logEndpoint = out.logEndpoint ?? parseOptionalString(env['ATRIB_LOG_ENDPOINT'])
  out.logSubmission =
    out.logSubmission ?? parseOptionalLogSubmission(env['ATRIB_LOCAL_SUBSTRATE_LOG_SUBMISSION'])
  out.harnessClasses =
    out.harnessClasses ?? parseOptionalHarnessClasses(env['ATRIB_LOCAL_SUBSTRATE_HARNESS_CLASSES'])
  out.shutdownTimeoutMs =
    out.shutdownTimeoutMs ??
    parseOptionalPositiveInt(
      env['ATRIB_LOCAL_SUBSTRATE_SHUTDOWN_TIMEOUT_MS'],
      'ATRIB_LOCAL_SUBSTRATE_SHUTDOWN_TIMEOUT_MS',
    )

  return out
}

function requireValue(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index]
  if (value === undefined) throw new Error(`${flag} requires a value`)
  return value
}

function parseOptionalString(raw: string | undefined): string | undefined {
  return raw === undefined || raw.trim() === '' ? undefined : raw
}

function parsePort(raw: string, name: string): number {
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 0 || n > 65_535) {
    throw new Error(`${name} must be an integer from 0 to 65535`)
  }
  return n
}

function parseOptionalPort(raw: string | undefined, name: string): number | undefined {
  return raw === undefined || raw.trim() === '' ? undefined : parsePort(raw, name)
}

function parsePositiveInt(raw: string, name: string): number {
  const n = Number(raw)
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
  return n
}

function parseOptionalPositiveInt(raw: string | undefined, name: string): number | undefined {
  return raw === undefined || raw.trim() === '' ? undefined : parsePositiveInt(raw, name)
}

function parseLogSubmission(raw: string): 'enabled' | 'disabled' {
  if (raw === 'enabled' || raw === 'disabled') return raw
  throw new Error('--log-submission must be enabled or disabled')
}

function parseOptionalLogSubmission(raw: string | undefined): 'enabled' | 'disabled' | undefined {
  return raw === undefined || raw.trim() === '' ? undefined : parseLogSubmission(raw)
}

function parseHarnessClasses(raw: string): LocalSubstrateHarnessClass[] {
  const values = raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0)

  if (values.length === 0) {
    throw new Error('harness classes must include at least one value')
  }

  for (const value of values) {
    if (!supportedHarnessClasses.has(value)) {
      throw new Error(
        `unsupported harness class ${value}; expected one of ${LOCAL_SUBSTRATE_HARNESS_CLASSES.join(', ')}`,
      )
    }
  }

  return [...new Set(values)] as LocalSubstrateHarnessClass[]
}

function parseOptionalHarnessClasses(
  raw: string | undefined,
): LocalSubstrateHarnessClass[] | undefined {
  return raw === undefined || raw.trim() === '' ? undefined : parseHarnessClasses(raw)
}

function readPackageVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url))
    const pkgPath = join(here, '..', 'package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string }
    return pkg.version ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

function printHelp(): void {
  process.stderr.write(`atrib-local-substrate ${readPackageVersion()}
Run the host-owned P042 local substrate coordinator over loopback HTTP.

USAGE
  atrib-local-substrate [--json] [--host <host>] [--port <n>]
  atrib-local-substrate --describe
  atrib-local-substrate --version | --help

OPTIONS
  --host <host>              Bind host. Defaults to 127.0.0.1.
  --port <n>                 Bind port. Defaults to 8787. Use 0 in tests.
  --max-body-bytes <n>       Request body cap. Defaults to 1048576.
  --log-endpoint <url>       Override ATRIB_LOG_ENDPOINT.
  --log-submission <mode>    enabled or disabled. Defaults to enabled.
  --harness-classes <csv>    startup-spawn,long-lived-agent,watcher-wal by default.
  --shutdown-timeout-ms <n>  Best-effort flush bound on SIGTERM/SIGINT. Defaults to 2000.
  --json                     Write the ready event as JSON on stdout.
  --describe                 Emit a JSON description of this host binary.
  --version                  Print package version.
  --help                     Print this help.
`)
}

function buildDescription(): HostDescription {
  return {
    name: 'atrib-local-substrate',
    version: readPackageVersion(),
    description:
      'Host-owned local substrate coordinator for P042. It signs exact unsigned record bodies through @atrib/mcp and exposes POST /atrib/local-substrate plus health probes over loopback HTTP.',
    options: [
      { flag: '--host', takes_value: true, description: 'Bind host. Defaults to 127.0.0.1.' },
      { flag: '--port', takes_value: true, description: 'Bind port. Defaults to 8787.' },
      {
        flag: '--max-body-bytes',
        takes_value: true,
        description: 'Maximum request body size in bytes.',
      },
      { flag: '--log-endpoint', takes_value: true, description: 'Override ATRIB_LOG_ENDPOINT.' },
      {
        flag: '--log-submission',
        takes_value: true,
        description: 'enabled or disabled. Disable only for tests and local proofs.',
      },
      {
        flag: '--harness-classes',
        takes_value: true,
        description: 'Comma-separated supported harness classes.',
      },
      {
        flag: '--shutdown-timeout-ms',
        takes_value: true,
        description: 'Best-effort flush bound on shutdown.',
      },
      { flag: '--json', takes_value: false, description: 'Write the ready event as JSON.' },
    ],
    env_vars: [
      {
        name: 'ATRIB_PRIVATE_KEY',
        description: 'base64url Ed25519 32-byte seed. First key source tried.',
        required: false,
      },
      {
        name: 'ATRIB_KEY_FILE',
        description: 'Path to a file containing the seed. Second key source.',
        required: false,
      },
      {
        name: 'ATRIB_AGENT',
        description: 'Agent label used for the agent-scoped Keychain service.',
        required: false,
      },
      {
        name: 'ATRIB_LOCAL_SUBSTRATE_HOST',
        description: 'Bind host override.',
        required: false,
      },
      {
        name: 'ATRIB_LOCAL_SUBSTRATE_PORT',
        description: 'Bind port override.',
        required: false,
      },
      {
        name: 'ATRIB_LOCAL_SUBSTRATE_HARNESS_CLASSES',
        description: 'Comma-separated harness classes the host accepts.',
        required: false,
      },
      {
        name: 'ATRIB_LOCAL_SUBSTRATE_LOG_SUBMISSION',
        description: 'enabled or disabled. Defaults to enabled.',
        required: false,
      },
    ],
  }
}

function keyScope(key: ResolvedKey): string {
  if (key.source === 'keychain' && key.keychainService) return `keychain:${key.keychainService}`
  return key.source
}

async function startLocalSubstrateHost(
  options: StartHostOptions,
): Promise<LocalSubstrateHostHandle> {
  const harnessClasses = options.harnessClasses ?? [...LOCAL_SUBSTRATE_HARNESS_CLASSES]
  const coordinator = createInProcessLocalSubstrateCoordinator({
    creatorKey: base64urlEncode(options.key.privateKey),
    supportedHarnessClasses: harnessClasses,
    ...(options.logEndpoint !== undefined ? { logEndpoint: options.logEndpoint } : {}),
    ...(options.logSubmission !== undefined ? { logSubmission: options.logSubmission } : {}),
    health: {
      pid: process.pid,
      version: readPackageVersion(),
      transport: 'node-http',
      creatorKeyScope: keyScope(options.key),
      activeWrappers: 0,
      staleChildren: 0,
    },
  })

  let server: LocalSubstrateNodeServerHandle
  try {
    server = await bindLocalSubstrateCoordinatorNodeServer(coordinator, {
      host: options.host ?? LOCAL_SUBSTRATE_NODE_DEFAULT_HOST,
      port: options.port ?? LOCAL_SUBSTRATE_NODE_DEFAULT_PORT,
      maxBodyBytes: options.maxBodyBytes ?? LOCAL_SUBSTRATE_NODE_DEFAULT_MAX_BODY_BYTES,
    })
  } catch (error) {
    coordinator.destroy()
    throw error
  }

  let closed = false
  const close = async (): Promise<void> => {
    if (closed) return
    closed = true
    await server.close()
    await withTimeout(
      coordinator.flush(),
      options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS,
    ).catch(() => undefined)
    coordinator.destroy()
  }

  return { coordinator, server, close }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function writeReady(handle: LocalSubstrateHostHandle, jsonOutput: boolean): void {
  const event = {
    event: 'ready',
    name: 'atrib-local-substrate',
    version: readPackageVersion(),
    pid: process.pid,
    url: handle.server.url,
    endpoint: handle.server.endpoint,
    health_endpoint: handle.server.healthEndpoint,
  }
  if (jsonOutput) {
    process.stdout.write(`${JSON.stringify(event)}\n`)
  } else {
    process.stderr.write(
      `atrib-local-substrate: listening at ${event.endpoint} (health ${event.health_endpoint})\n`,
    )
  }
}

export interface KeyRetryOptions {
  /** Key resolver; defaults to resolveKey. Injectable for tests. */
  resolve?: () => Promise<ResolvedKey | null>
  /** First backoff delay in ms. */
  initialDelayMs?: number
  /** Backoff cap in ms. */
  maxDelayMs?: number
  /** Total budget in ms; 0 (default) waits indefinitely. */
  maxWaitMs?: number
  /** Clock; injectable for tests. */
  now?: () => number
  /** Sleep; injectable for tests. */
  sleep?: (ms: number) => Promise<void>
  /** Log sink; defaults to stderr. */
  log?: (message: string) => void
}

/**
 * Resolve the signing key, polling with exponential backoff instead of failing
 * on the first miss.
 *
 * A login-managed host can start before the login Keychain is unlocked, so the
 * first resolveKey() returns null. Exiting there makes the process crash-loop
 * under a KeepAlive supervisor, and any dependent that waits on the substrate
 * hangs. Instead we stay alive and retry until the Keychain unlocks and the key
 * resolves, so a reboot self-heals with no manual restart.
 *
 * Returns null only when a finite ATRIB_KEY_RETRY_MAX_MS budget is exhausted
 * (default 0 = wait indefinitely), preserving an explicit-failure escape hatch.
 */
export async function resolveSigningKeyWithRetry(
  options: KeyRetryOptions = {},
): Promise<ResolvedKey | null> {
  const resolve = options.resolve ?? resolveKey
  const initialDelayMs = options.initialDelayMs ?? 2_000
  const maxDelayMs = Math.max(options.maxDelayMs ?? 30_000, initialDelayMs)
  const maxWaitMs = options.maxWaitMs ?? 0
  const now = options.now ?? ((): number => Date.now())
  const sleep =
    options.sleep ??
    ((ms: number): Promise<void> => new Promise<void>((resolveSleep) => setTimeout(resolveSleep, ms)))
  const log = options.log ?? ((message: string): void => void process.stderr.write(message))

  const startedAt = now()
  let attempt = 0
  let delay = initialDelayMs

  for (;;) {
    attempt += 1
    let key: ResolvedKey | null = null
    try {
      key = await resolve()
    } catch (error) {
      // A throw here (e.g. a transient ATRIB_KEY_FILE read) is treated like a
      // miss and retried, but logged each time so a genuine misconfiguration
      // stays visible instead of silently looping.
      log(
        `atrib-local-substrate: key resolution error on attempt ${attempt}: ${
          error instanceof Error ? error.message : String(error)
        }\n`,
      )
    }

    if (key) {
      if (attempt > 1) {
        const waitedSec = Math.round((now() - startedAt) / 1_000)
        log(
          `atrib-local-substrate: signing key resolved after ${attempt} attempts (~${waitedSec}s)\n`,
        )
      }
      return key
    }

    if (maxWaitMs > 0 && now() - startedAt >= maxWaitMs) return null

    if (attempt === 1) {
      log(
        'atrib-local-substrate: no signing key yet (the login Keychain may be locked at boot); ' +
          'waiting and retrying with backoff. Set ATRIB_KEY_RETRY_MAX_MS to cap the wait.\n',
      )
    }

    await sleep(delay)
    delay = Math.min(delay * 2, maxDelayMs)
  }
}

function keyRetryOptionsFromEnv(): KeyRetryOptions {
  const options: KeyRetryOptions = {}
  const initial = parseOptionalPositiveInt(
    process.env['ATRIB_KEY_RETRY_INTERVAL_MS'],
    'ATRIB_KEY_RETRY_INTERVAL_MS',
  )
  if (initial !== undefined) options.initialDelayMs = initial
  const maxDelay = parseOptionalPositiveInt(
    process.env['ATRIB_KEY_RETRY_MAX_INTERVAL_MS'],
    'ATRIB_KEY_RETRY_MAX_INTERVAL_MS',
  )
  if (maxDelay !== undefined) options.maxDelayMs = maxDelay
  const maxWaitRaw = process.env['ATRIB_KEY_RETRY_MAX_MS']
  if (maxWaitRaw !== undefined && maxWaitRaw.trim() !== '') {
    const n = Number(maxWaitRaw)
    if (!Number.isInteger(n) || n < 0) {
      throw new Error('ATRIB_KEY_RETRY_MAX_MS must be a non-negative integer')
    }
    options.maxWaitMs = n
  }
  return options
}

async function main(): Promise<void> {
  let args: ParsedArgs
  try {
    args = parseArgs(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(
      `atrib-local-substrate: ${error instanceof Error ? error.message : String(error)}\n`,
    )
    process.exit(1)
  }

  if (args.showVersion) {
    process.stdout.write(`${readPackageVersion()}\n`)
    return
  }
  if (args.showHelp) {
    printHelp()
    return
  }
  if (args.showDescribe) {
    process.stdout.write(`${JSON.stringify(buildDescription(), null, 2)}\n`)
    return
  }

  const key = await resolveSigningKeyWithRetry(keyRetryOptionsFromEnv())
  if (!key) {
    process.stderr.write(
      'atrib-local-substrate: no signing key resolved within ATRIB_KEY_RETRY_MAX_MS; set ATRIB_PRIVATE_KEY, ATRIB_KEY_FILE, or an atrib Keychain entry\n',
    )
    process.exit(1)
  }

  const handle = await startLocalSubstrateHost({
    key,
    ...(args.host !== undefined ? { host: args.host } : {}),
    ...(args.port !== undefined ? { port: args.port } : {}),
    ...(args.maxBodyBytes !== undefined ? { maxBodyBytes: args.maxBodyBytes } : {}),
    ...(args.logEndpoint !== undefined ? { logEndpoint: args.logEndpoint } : {}),
    ...(args.logSubmission !== undefined ? { logSubmission: args.logSubmission } : {}),
    ...(args.harnessClasses !== undefined ? { harnessClasses: args.harnessClasses } : {}),
    ...(args.shutdownTimeoutMs !== undefined ? { shutdownTimeoutMs: args.shutdownTimeoutMs } : {}),
  })

  writeReady(handle, args.jsonOutput)

  let shuttingDown = false
  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return
    shuttingDown = true
    process.stderr.write(`atrib-local-substrate: received ${signal}, shutting down\n`)
    handle
      .close()
      .then(() => process.exit(0))
      .catch((error) => {
        process.stderr.write(
          `atrib-local-substrate: shutdown error ${error instanceof Error ? error.message : String(error)}\n`,
        )
        process.exit(1)
      })
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(
      `atrib-local-substrate: fatal ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    )
    process.exit(1)
  })
}

export const __test_only__ = {
  buildDescription,
  parseArgs,
  startLocalSubstrateHost,
  resolveSigningKeyWithRetry,
}
