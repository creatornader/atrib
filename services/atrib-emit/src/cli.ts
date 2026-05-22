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

import { readFileSync, realpathSync, accessSync, constants as fsConstants } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { emitInProcess } from './index.js'
import { resolveKey } from './keys.js'

type Subcommand = 'emit' | 'doctor'

interface ParsedArgs {
  subcommand: Subcommand
  logEndpoint?: string
  flushDeadlineMs?: number
  showVersion: boolean
  showHelp: boolean
  showDescribe: boolean
  jsonOutput: boolean
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const out: ParsedArgs = {
    subcommand: 'emit',
    showVersion: false,
    showHelp: false,
    showDescribe: false,
    jsonOutput: false,
  }
  let start = 0
  // First positional, if it's a known subcommand, sets the mode.
  if (argv[0] === 'doctor' || argv[0] === 'emit') {
    out.subcommand = argv[0] as Subcommand
    start = 1
  }
  for (let i = start; i < argv.length; i++) {
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
  atrib-emit-cli [emit] [--log-endpoint <url>] [--flush-deadline-ms <n>] < envelope.json
  atrib-emit-cli doctor [--log-endpoint <url>] [--json]
  atrib-emit-cli --describe
  atrib-emit-cli --version | --help

SUBCOMMANDS
  emit (default)            Read one JSON envelope from stdin, sign in-process,
                            write EmitOutput JSON to stdout. Exit code always 0
                            per §5.8 degradation contract.
  doctor                    Substrate readiness check: verify a signing key is
                            resolvable, the log endpoint is reachable, and the
                            local mirror path is writable. Exits 0 if all
                            checks pass, non-zero otherwise.

GLOBAL OPTIONS
  --log-endpoint <url>      Override ATRIB_LOG_ENDPOINT.
  --flush-deadline-ms <n>   (emit) Override the default 5000ms post-sign flush bound.
  --json                    (doctor) Emit machine-readable JSON to stdout.
  --describe                Emit a JSON description of this CLI's contract
                            (subcommands, options, envelope schema, env vars).
  --version                 Print package version.
  --help                    Print this help.

ENVELOPE FIELDS (emit, read from stdin as one JSON object)
  event_type, content (required); context_id, informed_by, annotates,
  revises, session_token, provenance_token, tool_name, args_hash (optional).

OUTPUT
  emit: EmitOutput JSON on stdout, always exit 0.
  doctor: text summary on stdout (or JSON with --json), exit 0 on pass.
`)
}

// Stable JSON description of the CLI's surface. Designed for agent / tooling
// introspection: an LLM that has never seen this binary can pipe
// `atrib-emit-cli --describe` to discover the input envelope schema, output
// shape, environment variables, and subcommands without reading source.
interface CliDescription {
  name: 'atrib-emit-cli'
  version: string
  description: string
  subcommands: Record<string, { description: string; reads_stdin: boolean }>
  options: Array<{ flag: string; takes_value: boolean; description: string }>
  envelope_schema: {
    required: Record<string, string>
    optional: Record<string, string>
  }
  output_schema: Record<string, string>
  env_vars: Array<{ name: string; description: string; required: boolean }>
  spec_references: Array<{ section: string; url: string }>
  decision_references: Array<{ adr: string; url: string }>
}

function buildDescription(): CliDescription {
  return {
    name: 'atrib-emit-cli',
    version: readPackageVersion(),
    description:
      'Thin command-line wrapper around emitInProcess (atrib D082). Reads one JSON envelope on stdin, signs the record in-process, writes EmitOutput JSON to stdout. Exit code 0 per §5.8 degradation contract.',
    subcommands: {
      emit: {
        description: 'Sign one cognitive event (default; runs when no subcommand is given).',
        reads_stdin: true,
      },
      doctor: {
        description: 'Substrate readiness check: key, log endpoint, mirror path.',
        reads_stdin: false,
      },
    },
    options: [
      { flag: '--log-endpoint', takes_value: true, description: 'Override ATRIB_LOG_ENDPOINT.' },
      {
        flag: '--flush-deadline-ms',
        takes_value: true,
        description: '(emit) Upper bound on post-sign queue flush in ms; default 5000.',
      },
      { flag: '--json', takes_value: false, description: '(doctor) Machine-readable JSON output.' },
      { flag: '--describe', takes_value: false, description: 'This description block.' },
      { flag: '--version', takes_value: false, description: 'Package version.' },
      { flag: '--help', takes_value: false, description: 'Usage.' },
    ],
    envelope_schema: {
      required: {
        event_type:
          'URI per spec §1.2.4. Normative: https://atrib.dev/v1/types/{observation,annotation,revision,tool_call,transaction}.',
        content: 'Object of any shape. Becomes the signed semantic payload.',
      },
      optional: {
        context_id: '32-hex trace identifier; threads records into a coherent session chain (D072, D078).',
        informed_by: 'Array of sha256:<64-hex> record_hashes; ANNOTATES edge per §3.2.4.',
        annotates: 'sha256:<64-hex> record_hash; required when event_type is the annotation URI per D058 / §1.2.7.',
        revises: 'sha256:<64-hex> record_hash; required when event_type is the revision URI per D059 / §1.2.9.',
        session_token: 'Cross-session causal anchor per W3C Trace Context tracestate.',
        provenance_token:
          'Genesis-record-only 22-char base64url cross-session anchor per spec §1.2.6 / D044.',
        tool_name: 'Disclosed tool name per §8.2 (optional disclosure posture).',
        args_hash: 'sha256:<64-hex> commitment to canonical args per §8.3 salted-commitment posture.',
        producer: 'Producer label routed to mirror sidecar `_local.producer`. Defaults to "atrib-emit-cli"; hook helpers override with finer attribution (e.g. "claude-hooks-builtin-2b").',
      },
    },
    output_schema: {
      record_hash: '"sha256:<64-hex>" of the signed canonical form, or "sha256:unknown" on degraded fallback.',
      log_index: 'integer position in the log if submission confirmed within flush deadline, else null.',
      checkpoint: 'C2SP signed note string if confirmed, else null.',
      inclusion_proof: 'array of base64 SHA-256 hashes (proof bundle) if confirmed, else null or omitted.',
      context_id: '32-hex trace id the record was signed under.',
      warnings: 'array of strings: degraded paths (queued / flush-deadline / missing-key / etc).',
    },
    env_vars: [
      { name: 'ATRIB_PRIVATE_KEY', description: 'base64url Ed25519 32-byte seed. First key source tried.', required: false },
      { name: 'ATRIB_KEY_FILE', description: 'Path to a file containing the seed. Second source.', required: false },
      { name: 'ATRIB_KEYCHAIN_TIMEOUT_MS', description: 'Keychain spawn timeout in ms (default 3000).', required: false },
      { name: 'ATRIB_OP_TIMEOUT_MS', description: '1Password CLI spawn timeout in ms (default 10000).', required: false },
      { name: 'ATRIB_LOG_ENDPOINT', description: 'Override the log submission URL.', required: false },
      { name: 'ATRIB_MIRROR_FILE', description: 'JSONL file path the signing path appends to.', required: false },
      { name: 'ATRIB_AUTOCHAIN_SOURCE', description: 'JSONL file path the inheritance reads from (chain composition).', required: false },
      { name: 'ATRIB_AGENT', description: 'Agent label used in the default mirror filename.', required: false },
      { name: 'ATRIB_CONTEXT_ID', description: 'Default 32-hex context_id when envelope omits one (D078).', required: false },
      { name: 'CLAUDE_CODE_SESSION_ID', description: 'Harness-injected fallback (D083): UUID stripped + lowercased to a 32-hex context_id when ATRIB_CONTEXT_ID is unset. One entry in @atrib/mcp KNOWN_HARNESS_DISCOVERIES.', required: false },
    ],
    spec_references: [
      { section: '§1.3', url: 'https://github.com/creatornader/atrib/blob/main/atrib-spec.md#13-canonical-serialization' },
      { section: '§1.4.2', url: 'https://github.com/creatornader/atrib/blob/main/atrib-spec.md#142-record-hash' },
      { section: '§5.8', url: 'https://github.com/creatornader/atrib/blob/main/atrib-spec.md#58-degradation-contract' },
    ],
    decision_references: [
      {
        adr: 'D079',
        url: 'https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d079-the-six-core-cognitive-primitives--atribs-agent-facing-surface',
      },
      {
        adr: 'D081',
        url: 'https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d081-in-process-emit-for-hook-class-producers-emitinprocess',
      },
      {
        adr: 'D082',
        url: 'https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d082-cli-binary-distribution-of-emitinprocess-supersedes-d081s-integration-shape',
      },
    ],
  }
}

// One readiness check. Each function returns a structured result; runDoctor()
// aggregates and renders. Kept as small pure functions so a future caller can
// import buildDescription() / runDoctor() programmatically.
interface CheckResult {
  ok: boolean
  detail: string
  timing_ms: number
  data?: Record<string, unknown>
}

async function checkKey(): Promise<CheckResult> {
  const t0 = Date.now()
  try {
    const key = await resolveKey()
    const timing = Date.now() - t0
    if (!key) {
      return {
        ok: false,
        detail:
          'no signing key resolved (set ATRIB_PRIVATE_KEY, ATRIB_KEY_FILE, or store seed in macOS Keychain as service "atrib-creator")',
        timing_ms: timing,
      }
    }
    return {
      ok: true,
      detail: `key resolved (source: ${key.source})`,
      timing_ms: timing,
      data: { source: key.source },
    }
  } catch (e) {
    return {
      ok: false,
      detail: `resolveKey threw: ${e instanceof Error ? e.message : String(e)}`,
      timing_ms: Date.now() - t0,
    }
  }
}

async function checkLogEndpoint(endpoint: string): Promise<CheckResult> {
  // Probe the checkpoint endpoint rather than /v1/entries: HEAD-ish, doesn't
  // require auth, returns the signed tree head. Reachable + parseable means
  // the log is alive and we can talk to it; any HTTP error or network failure
  // is a soft-fail (signing still works via the local queue, just no confirm).
  const probeUrl = endpoint.replace(/\/v1\/entries\/?$/, '') + '/v1/checkpoint'
  const t0 = Date.now()
  try {
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), 5000)
    const r = await fetch(probeUrl, { method: 'GET', signal: ac.signal })
    clearTimeout(timer)
    const timing = Date.now() - t0
    if (!r.ok) {
      return {
        ok: false,
        detail: `log endpoint returned ${r.status} from ${probeUrl}; signing still works locally`,
        timing_ms: timing,
        data: { url: probeUrl, status: r.status },
      }
    }
    const text = await r.text()
    // Checkpoint format is "<origin>\n<tree_size>\n<root_hash>\n\n<signature>"
    // per C2SP signed-note. We only need to confirm tree_size parses; the
    // signature is verified by separate consumers.
    const lines = text.split('\n')
    const treeSize = Number(lines[1] ?? '0')
    return {
      ok: true,
      detail: `log endpoint reachable (${probeUrl}, tree_size ${treeSize})`,
      timing_ms: timing,
      data: { url: probeUrl, tree_size: treeSize },
    }
  } catch (e) {
    return {
      ok: false,
      detail: `log endpoint unreachable: ${e instanceof Error ? e.message : String(e)} (${probeUrl})`,
      timing_ms: Date.now() - t0,
      data: { url: probeUrl },
    }
  }
}

function checkMirrorWritable(): CheckResult {
  const t0 = Date.now()
  const path =
    process.env['ATRIB_MIRROR_FILE'] ??
    join(homedir(), '.atrib', 'records', `atrib-emit-${process.env['ATRIB_AGENT'] ?? 'claude-code'}.jsonl`)
  const parent = dirname(path)
  try {
    // The mirror file itself may or may not exist; we care about the parent
    // dir being writable. Best-effort: if parent missing, that's a fail
    // (signing path would create the file later but the runtime needs the dir).
    accessSync(parent, fsConstants.W_OK)
    return {
      ok: true,
      detail: `mirror parent writable (${parent})`,
      timing_ms: Date.now() - t0,
      data: { path, parent },
    }
  } catch (e) {
    return {
      ok: false,
      detail: `mirror parent not writable: ${parent} (${e instanceof Error ? e.message : String(e)})`,
      timing_ms: Date.now() - t0,
      data: { path, parent },
    }
  }
}

interface DoctorReport {
  ok: boolean
  version: string
  checks: {
    key: CheckResult
    log_endpoint: CheckResult
    mirror_writable: CheckResult
  }
}

async function runDoctor(opts: { logEndpoint?: string }): Promise<DoctorReport> {
  const endpoint = opts.logEndpoint ?? process.env['ATRIB_LOG_ENDPOINT'] ?? 'https://log.atrib.dev/v1/entries'
  const [key, logEndpoint, mirror] = await Promise.all([
    checkKey(),
    checkLogEndpoint(endpoint),
    Promise.resolve(checkMirrorWritable()),
  ])
  return {
    ok: key.ok && logEndpoint.ok && mirror.ok,
    version: readPackageVersion(),
    checks: { key, log_endpoint: logEndpoint, mirror_writable: mirror },
  }
}

function renderDoctorText(report: DoctorReport): string {
  const lines: string[] = []
  lines.push(`atrib-emit-cli ${report.version} — substrate readiness check`)
  const fmt = (label: string, r: CheckResult): string => {
    const tag = r.ok ? '[OK]  ' : '[FAIL]'
    return `  ${tag} ${label.padEnd(18)} ${r.detail} (${r.timing_ms}ms)`
  }
  lines.push(fmt('key', report.checks.key))
  lines.push(fmt('log_endpoint', report.checks.log_endpoint))
  lines.push(fmt('mirror_writable', report.checks.mirror_writable))
  lines.push('')
  lines.push(report.ok ? 'All checks passed.' : 'One or more checks failed.')
  return lines.join('\n')
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
  /**
   * Producer label routed to the mirror sidecar's `_local.producer` field.
   * When omitted, the CLI labels records `'atrib-emit-cli'`. Hook-class
   * callers that want finer attribution (e.g. `'claude-hooks-builtin-2b'`,
   * `'claude-hooks-mcp-2a'`) pass it here to override.
   */
  producer?: unknown
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
  if (parsed.showDescribe) {
    writeStdoutJson(buildDescription())
    return 0
  }

  if (parsed.subcommand === 'doctor') {
    const report = await runDoctor({ logEndpoint: parsed.logEndpoint })
    if (parsed.jsonOutput) {
      writeStdoutJson(report)
    } else {
      process.stdout.write(renderDoctorText(report) + '\n')
    }
    // Doctor exits non-zero on failure — operator-facing diagnostic, NOT the
    // hook-safe always-0 contract of `emit`. Scripts can rely on this to gate
    // CI / deployment checks.
    return report.ok ? 0 : 1
  }

  // Default subcommand: emit.
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
  // Identify CLI-signed records distinctly from MCP-server emits so the
  // mirror's by-producer aggregation buckets hook-spawned signing apart
  // from interactive tool calls. Hooks override via the envelope's
  // top-level `producer` field when they need finer attribution
  // (e.g. "claude-hooks-builtin-2b").
  const envelopeProducer =
    typeof envelope.producer === 'string' && envelope.producer.length > 0
      ? envelope.producer
      : 'atrib-emit-cli'
  const options: { logEndpoint?: string; flushDeadlineMs?: number; producer: string } = {
    producer: envelopeProducer,
  }
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
