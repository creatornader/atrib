// SPDX-License-Identifier: Apache-2.0

/**
 * Harness session-id discovery for cognitive-primitive MCP servers (D083).
 *
 * Extends D078's ATRIB_CONTEXT_ID env-var fallback. D078 made the four
 * cognitive-primitive MCP servers (@atrib/emit, @atrib/recall, @atrib/trace,
 * @atrib/summarize) honor process.env.ATRIB_CONTEXT_ID when a tool call
 * omits the context_id argument. That covers Inspect-style harnesses that
 * thread per-run scope into spawned MCP children via the env block.
 *
 * D083 adds a second fallback layer: when ATRIB_CONTEXT_ID is unset OR
 * invalid, derive a deterministic 32-hex context_id from a documented
 * harness env var (e.g. CLAUDE_CODE_SESSION_ID). This closes the
 * cognitive-extractor "fresh orphan" path the substrate-health analysis
 * surfaced 2026-05-22: an agent running under Claude Code calls
 * atrib-annotate without context_id and no operator-set ATRIB_CONTEXT_ID
 * exists in the MCP child env, producing an orphan singleton chain that
 * is signed-but-uncomposable with the session's other records.
 *
 * Per D078's precedent the fallback is silent: harness env vars represent
 * the spawning host's declared session scope, not a misconfiguration.
 * Invalid values produce undefined (not an error) so callers see the same
 * shape as "neither set."
 */

const HEX_32 = /^[0-9a-f]{32}$/

/** A single harness's env-var discovery rule. */
export interface HarnessDiscovery {
  /** Documented env var name the harness exposes to MCP child processes. */
  envVar: string
  /**
   * Parse the env value into a valid 32-hex context_id, or return null if
   * the value cannot produce one. Pure function; no side effects.
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
  // (e.g. "38af29c4-fc3a-4f88-8fec-392501b8a0a9"). Stripping the dashes and
  // lowercasing yields a 32-hex context_id matching the derivation any
  // companion PostToolUse / lifecycle hook would apply when deriving
  // context_id from the same envelope.
  {
    envVar: 'CLAUDE_CODE_SESSION_ID',
    parse: (value: string): string | null => {
      const candidate = value.replace(/-/g, '').toLowerCase()
      return HEX_32.test(candidate) ? candidate : null
    },
  },
] as const

/**
 * Resolve an effective context_id from environment, applying precedence:
 *
 *   1. ATRIB_CONTEXT_ID (D078; explicit operator/harness intent)
 *   2. First valid harness env var per KNOWN_HARNESS_DISCOVERIES (D083)
 *   3. undefined (caller falls through to its own resolution chain)
 *
 * Returns a validated 32-hex string or undefined. Never throws.
 */
export function resolveEnvContextId(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const explicit = env['ATRIB_CONTEXT_ID']
  if (explicit && HEX_32.test(explicit)) return explicit
  for (const discovery of KNOWN_HARNESS_DISCOVERIES) {
    const value = env[discovery.envVar]
    if (value !== undefined) {
      const parsed = discovery.parse(value)
      if (parsed) return parsed
    }
  }
  return undefined
}
