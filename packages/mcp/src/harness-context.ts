// SPDX-License-Identifier: Apache-2.0

/**
 * Harness session-id discovery for cognitive-primitive MCP servers (D083).
 *
 * Extends D078's ATRIB_CONTEXT_ID env-var fallback. D078 made the four
 * cognitive-primitive MCP servers (@atrib/emit, @atrib/recall, @atrib/trace,
 * @atrib/summarize) honor process.env.ATRIB_CONTEXT_ID when a tool call
 * omits the context_id argument.
 *
 * D083 v1 added a harness env-var fallback (e.g. CLAUDE_CODE_SESSION_ID).
 * That fix closed the orphan-singleton class for harnesses that spawn MCP
 * children per-session (inheriting the per-session env). It did NOT close
 * it for harnesses that spawn MCP children ONCE at process startup, before
 * any session exists. The per-session env never propagates to the
 * already-running child. Claude Code is the canonical example: MCP
 * children are spawned at Claude Code launch; CLAUDE_CODE_SESSION_ID is
 * created later, per-conversation, and never reaches the child's env.
 *
 * D083 v2 (this file) adds a SECOND fallback per discovery entry: a
 * state file the harness writes from a session-aware context (typically a
 * SessionStart hook). The MCP child reads the file each call. The premise:
 *   - the harness has a session-aware writer (hook, callback) that DOES
 *     have the per-session id in its env
 *   - the MCP child has no such surface, but can read a file
 *   - the writer translates env -> file; the reader translates file -> id
 *
 * The file path is supplied as a thunk so it can resolve dynamically
 * (e.g., per-parent-PID to isolate concurrent harness instances).
 *
 * Per D078's precedent the fallback is silent: harness state files
 * represent the spawning host's declared session scope, not a
 * misconfiguration. Missing files, parse errors, and stat failures all
 * produce undefined (not exceptions) so callers see the same shape as
 * "neither set."
 */

import { readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const HEX_32 = /^[0-9a-f]{32}$/

/** Maximum bytes to read from a fallback file. A 32-hex or UUID-form
 * session id is < 40 bytes; anything larger is suspicious garbage. */
const FALLBACK_FILE_MAX_BYTES = 128

/** A single harness's discovery rule. */
export interface HarnessDiscovery {
  /**
   * Documented env var name the harness exposes to MCP child processes.
   * Empty string means "no env-var path; file only" (rare).
   */
  envVar: string
  /**
   * Optional thunk returning a state file path. The file is expected to
   * contain a single line whose `parse()` produces a 32-hex context_id.
   * Function form (not static string) supports dynamic resolution like
   * per-parent-PID isolation (process.ppid).
   *
   * The writer responsibility lives outside this library: typically a
   * harness-specific SessionStart hook in the operator's hooks directory.
   * The file convention is documented per discovery entry.
   */
  fallbackFile?: () => string
  /**
   * Parse a candidate value (from env or file) into a 32-hex context_id,
   * or return null if the value cannot produce one. Pure function; no
   * side effects. Whitespace already trimmed by the caller.
   */
  parse(value: string): string | null
}

/**
 * Registered harnesses, ordered most-canonical first. Adding a new entry
 * here is the implementation step for a new §9 integration pattern that
 * lands harness-aware context discovery; the ADR governing each entry
 * should be cross-referenced from the comment.
 */
export const KNOWN_HARNESS_DISCOVERIES: readonly HarnessDiscovery[] = [
  // Claude Code: parent process exposes CLAUDE_CODE_SESSION_ID as a UUID
  // (e.g. "38af29c4-fc3a-4f88-8fec-392501b8a0a9") to HOOK subprocesses
  // (PreToolUse, SessionStart, etc.). The env var is NOT in scope for
  // MCP children spawned at Claude Code launch, so the file fallback is
  // required for the MCP child path.
  //
  // File convention: ~/.claude/state/active-session-id-<claude-code-pid>
  // Writer: SessionStart hook (overwrites on every session start).
  //         The hook has CLAUDE_CODE_SESSION_ID in env and process.ppid =
  //         Claude Code PID. The MCP child has process.ppid = Claude Code
  //         PID. Same key on both sides.
  // Content: the reference writer writes the raw UUID with dashes (one
  //         line). parse() ALSO accepts the already-stripped 32-hex form
  //         for hand-edits or alternate writers, but the canonical write
  //         shape is the dashed UUID for operator-readability.
  // Per-PID keying isolates concurrent Claude Code instances (each
  //         spawns its own MCP children + its own SessionStart hook).
  // Limitation: a single Claude Code instance serving multiple sessions
  //         in sequence (e.g. via /clear) overwrites this file each time;
  //         in-process MCP children read the most-recent session id.
  //         If the agent needs to disambiguate per-call, it MUST thread
  //         context_id explicitly. This is acceptable because Claude Code
  //         today serves one active session per instance at a time.
  {
    envVar: 'CLAUDE_CODE_SESSION_ID',
    fallbackFile: () =>
      join(homedir(), '.claude', 'state', `active-session-id-${process.ppid}`),
    parse: (value: string): string | null => {
      const candidate = value.replace(/-/g, '').toLowerCase()
      return HEX_32.test(candidate) ? candidate : null
    },
  },
] as const

/**
 * Read up to FALLBACK_FILE_MAX_BYTES from a fallback state file. Returns
 * the trimmed contents on success, null on any error (missing file, read
 * failure, oversize, etc.). Never throws.
 */
function readFallbackFile(path: string): string | null {
  try {
    const s = statSync(path)
    if (!s.isFile()) return null
    if (s.size > FALLBACK_FILE_MAX_BYTES) return null
    const raw = readFileSync(path, 'utf8')
    const trimmed = raw.trim()
    return trimmed.length > 0 ? trimmed : null
  } catch {
    return null
  }
}

/**
 * Resolve an effective context_id from environment and harness state
 * files, applying precedence:
 *
 *   1. ATRIB_CONTEXT_ID env (D078; explicit operator/harness intent)
 *   2. For each KNOWN_HARNESS_DISCOVERIES entry, in order:
 *      2a. discovery.envVar in env (D083 v1; per-session-spawn harnesses)
 *      2b. discovery.fallbackFile() readable + parseable (D083 v2;
 *          startup-spawn harnesses like Claude Code MCP children)
 *   3. undefined (caller falls through to its own resolution chain;
 *      typically synthesizes a fresh genesis chain_root + warning)
 *
 * Returns a validated 32-hex string or undefined. Never throws.
 *
 * The env-vs-file order within each discovery favors env when both are
 * set: env is more immediate (set by the process spawner explicitly)
 * while file is a fallback for cases env can't reach. If a harness
 * intentionally overrides via env, that should win over a stale file.
 */
export function resolveEnvContextId(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const explicit = env['ATRIB_CONTEXT_ID']
  if (explicit && HEX_32.test(explicit)) return explicit
  for (const discovery of KNOWN_HARNESS_DISCOVERIES) {
    // Env-var path. parse() may throw (a buggy or future discovery entry
    // could ship a parser that asserts); catch so the silent-failure
    // contract holds regardless of registry-entry quality.
    if (discovery.envVar !== '') {
      const value = env[discovery.envVar]
      if (value !== undefined) {
        try {
          const parsed = discovery.parse(value)
          if (parsed) return parsed
        } catch {
          // fall through to file path; next discovery; or undefined
        }
      }
    }
    // File-fallback path. Both the path-thunk and parse() are
    // try-wrapped so any registry-entry exception falls through to
    // the next discovery or to undefined.
    if (discovery.fallbackFile !== undefined) {
      let path: string | null = null
      try {
        path = discovery.fallbackFile()
      } catch {
        path = null
      }
      if (path !== null) {
        const raw = readFallbackFile(path)
        if (raw !== null) {
          try {
            const parsed = discovery.parse(raw)
            if (parsed) return parsed
          } catch {
            // fall through
          }
        }
      }
    }
  }
  return undefined
}
