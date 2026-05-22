#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0

// atrib-emit-cli: thin command-line wrapper around emitInProcess, the
// in-process signing entrypoint from index.ts.
//
// Per D082, hook-class producers spawn this binary instead of importing
// @atrib/emit, which keeps the operator's hook source directory free of a
// package.json and node_modules/. The binary itself is a short-lived Node
// process that signs in-process, so records remain byte-identical to MCP-
// server-signed and middleware-signed records per spec §1.3.
//
// Wire contract (stable as of @atrib/emit@0.11.3):
//
//   stdin: one JSON object — the same envelope emitInProcess accepts.
//     {
//       "event_type":   "https://atrib.dev/v1/types/observation" | "...annotation" | "...revision" | extension URI,
//       "content":      { ... },
//       "context_id":   "<32-hex>"?,
//       "informed_by":  ["sha256:..."]?,
//       "annotates":    "sha256:..."?,
//       "revises":      "sha256:..."?,
//       "session_token":"<base64url>"?,
//       "provenance_token": "<base64url>"?,
//       "tool_name":    "..."?,
//       "args_hash":    "sha256:..."?
//     }
//
//   stdout: one JSON object — the EmitOutput shape emitInProcess returns.
//     {
//       "record_hash": "sha256:...",
//       "log_index":   <number> | null,
//       "checkpoint":  "..." | null,
//       "warnings":    [ ... ]
//     }
//
//   stderr: human-readable diagnostic line(s) for the spawning hook to log.
//
//   exit code: always 0. The caller cannot block on a non-zero from a
//     signing helper without corrupting the user's session (§5.8
//     degradation contract). All failure modes are surfaced as warnings
//     inside the JSON result or as a stderr diagnostic line.
//
// CLI flags (kept minimal — the envelope carries everything routable):
//   --log-endpoint <url>     override ATRIB_LOG_ENDPOINT for this call
//   --flush-deadline-ms <n>  override the 5000ms default
//   --version                print package version and exit 0
//   --help                   print this usage and exit 0
//
// Environment variables (honored exactly as emitInProcess + resolveKey do):
//   ATRIB_LOG_ENDPOINT, ATRIB_MIRROR_FILE, ATRIB_AUTOCHAIN_SOURCE,
//   ATRIB_AGENT, ATRIB_PRIVATE_KEY, ATRIB_KEYCHAIN_TIMEOUT_MS,
//   ATRIB_OP_TIMEOUT_MS.

import { readFileSync, realpathSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { emitInProcess } from './index.js'

interface ParsedArgs {
  logEndpoint?: string
  flushDeadlineMs?: number
  showVersion: boolean
  showHelp: boolean
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const out: ParsedArgs = { showVersion: false, showHelp: false }
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
    if (a === '--log-endpoint') {
      const next = argv[i + 1]
      if (next === undefined) throw new Error(`--log-endpoint requires a value`)
      out.logEndpoint = next
      i++
      continue
    }
    if (a === '--flush-deadline-ms') {
      const next = argv[i + 1]
      if (next === undefined) throw new Error(`--flush-deadline-ms requires a value`)
      const n = Number(next)
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error(`--flush-deadline-ms must be a positive number (got ${next})`)
      }
      out.flushDeadlineMs = n
      i++
      continue
    }
    throw new Error(`unknown argument: ${a}`)
  }
  return out
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => {
      data += chunk
    })
    process.stdin.on('end', () => resolve(data))
    process.stdin.on('error', reject)
  })
}

function readPackageVersion(): string {
  // dist/cli.js sits next to dist/index.js. The package.json is one dir up.
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
  process.stderr.write(`atrib-emit-cli ${readPackageVersion()}
Sign one cognitive event (observation / annotation / revision) in-process,
without an MCP transport. See D082 in atrib/DECISIONS.md.

USAGE
  atrib-emit-cli [--log-endpoint <url>] [--flush-deadline-ms <n>] < envelope.json

OPTIONS
  --log-endpoint <url>      Override ATRIB_LOG_ENDPOINT for this call.
  --flush-deadline-ms <n>   Override the default 5000ms post-sign flush bound.
  --version                 Print package version and exit.
  --help                    Print this help and exit.

ENVELOPE FIELDS (read from stdin as one JSON object)
  event_type, content (required); context_id, informed_by, annotates,
  revises, session_token, provenance_token, tool_name, args_hash (optional).

OUTPUT
  EmitOutput JSON on stdout. Exit code is always 0 per §5.8 degradation
  contract; failures surface as warnings inside the result or on stderr.
`)
}

interface RawEnvelope {
  event_type?: unknown
  content?: unknown
  context_id?: unknown
  informed_by?: unknown
  annotates?: unknown
  revises?: unknown
  session_token?: unknown
  provenance_token?: unknown
  tool_name?: unknown
  args_hash?: unknown
}

// The CLI's wire envelope mirrors what callers passed to the MCP-transport
// version exactly. Re-shape it into the EmitInput shape (lowercase property
// names) the in-process API expects, dropping unknown keys silently.
function buildEmitInput(envelope: RawEnvelope): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (envelope.event_type !== undefined) out['event_type'] = envelope.event_type
  if (envelope.content !== undefined) out['content'] = envelope.content
  if (envelope.context_id !== undefined) out['context_id'] = envelope.context_id
  if (envelope.informed_by !== undefined) out['informed_by'] = envelope.informed_by
  if (envelope.annotates !== undefined) out['annotates'] = envelope.annotates
  if (envelope.revises !== undefined) out['revises'] = envelope.revises
  if (envelope.session_token !== undefined) out['session_token'] = envelope.session_token
  if (envelope.provenance_token !== undefined) out['provenance_token'] = envelope.provenance_token
  if (envelope.tool_name !== undefined) out['tool_name'] = envelope.tool_name
  if (envelope.args_hash !== undefined) out['args_hash'] = envelope.args_hash
  return out
}

function writeStdoutJson(value: unknown): void {
  process.stdout.write(JSON.stringify(value) + '\n')
}

function writeStderrLine(line: string): void {
  process.stderr.write(line + '\n')
}

// Compose a hook-safe fallback result for the cases where we cannot even
// reach emitInProcess (stdin parse failure, etc). The caller's hook reads
// our stdout and logs it; a structured payload keeps the contract uniform.
function fallbackResult(reason: string): {
  record_hash: string
  log_index: null
  checkpoint: null
  warnings: string[]
} {
  return {
    record_hash: 'sha256:unknown',
    log_index: null,
    checkpoint: null,
    warnings: [`atrib-emit-cli skipped: ${reason}`],
  }
}

export async function main(argv: readonly string[]): Promise<number> {
  let parsed: ParsedArgs
  try {
    parsed = parseArgs(argv)
  } catch (e) {
    writeStderrLine(`atrib-emit-cli: ${e instanceof Error ? e.message : String(e)}`)
    writeStdoutJson(fallbackResult('invalid CLI arguments'))
    return 0
  }

  if (parsed.showVersion) {
    process.stdout.write(`${readPackageVersion()}\n`)
    return 0
  }
  if (parsed.showHelp) {
    printHelp()
    return 0
  }

  let raw: string
  try {
    raw = await readStdin()
  } catch (e) {
    writeStderrLine(`atrib-emit-cli: stdin read error: ${e instanceof Error ? e.message : String(e)}`)
    writeStdoutJson(fallbackResult('stdin read error'))
    return 0
  }

  if (raw.trim().length === 0) {
    writeStderrLine(`atrib-emit-cli: empty stdin; expected one JSON envelope`)
    writeStdoutJson(fallbackResult('empty stdin'))
    return 0
  }

  let envelope: RawEnvelope
  try {
    envelope = JSON.parse(raw) as RawEnvelope
  } catch (e) {
    writeStderrLine(`atrib-emit-cli: stdin parse error: ${e instanceof Error ? e.message : String(e)}`)
    writeStdoutJson(fallbackResult('stdin parse error'))
    return 0
  }

  if (envelope.event_type === undefined || envelope.content === undefined) {
    writeStderrLine(`atrib-emit-cli: envelope missing required field(s) event_type or content`)
    writeStdoutJson(fallbackResult('envelope missing event_type or content'))
    return 0
  }

  const args = buildEmitInput(envelope)
  const options: { logEndpoint?: string; flushDeadlineMs?: number } = {}
  if (parsed.logEndpoint !== undefined) options.logEndpoint = parsed.logEndpoint
  if (parsed.flushDeadlineMs !== undefined) options.flushDeadlineMs = parsed.flushDeadlineMs

  const t0 = Date.now()
  try {
    const result = await emitInProcess(args, options)
    writeStdoutJson(result)
    const elapsed = Date.now() - t0
    writeStderrLine(
      `atrib-emit-cli: ok record_hash=${String(result.record_hash).slice(0, 24)}… log_index=${result.log_index ?? 'null'} ` +
        `warnings=${result.warnings.length} elapsed=${elapsed}ms`,
    )
    return 0
  } catch (e) {
    // emitInProcess only throws on a malformed input that fails EmitInput.parse.
    // Operational failures (network down, key unresolvable) come back as
    // warnings, not exceptions, per §5.8. Surface the parse error to the
    // hook's log and degrade gracefully.
    const elapsed = Date.now() - t0
    const message = e instanceof Error ? e.message : String(e)
    writeStderrLine(`atrib-emit-cli: emitInProcess threw: ${message} elapsed=${elapsed}ms`)
    writeStdoutJson(fallbackResult(`emitInProcess threw: ${message}`))
    return 0
  }
}

// Invoke main() when run as a script (the bin entrypoint), not when imported.
// Both sides resolved through realpath so a symlink shim (npm install -g
// creates one; operators may also create their own) matches the resolved
// dist/cli.js path the module loader saw. Without realpath, the entrypoint
// check fails when the binary is invoked via symlink and the CLI exits
// silently with no work done — observed during D082 smoke testing.
function isInvokedAsEntrypoint(): boolean {
  const argv1 = process.argv[1]
  if (typeof argv1 !== 'string' || argv1.length === 0) return false
  const moduleFile = fileURLToPath(import.meta.url)
  try {
    return realpathSync(moduleFile) === realpathSync(argv1)
  } catch {
    // realpathSync throws if a path doesn't exist (rare, but possible if
    // argv[1] is something unusual). Fall back to the unresolved compare.
    return import.meta.url === pathToFileURL(argv1).href
  }
}

if (isInvokedAsEntrypoint()) {
  void main(process.argv.slice(2)).then((code) => {
    process.exit(code)
  })
}
