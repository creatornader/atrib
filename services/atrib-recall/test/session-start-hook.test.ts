// SPDX-License-Identifier: Apache-2.0

/**
 * Smoke tests for the SessionStart hook script
 * (~/.claude/scripts/atrib-session-start.mjs).
 *
 * Spawns the script with controlled ATRIB_RECORD_FILE and ATRIB_LOG_ENDPOINT
 * env vars and asserts on the format of its stdout. Critical because hook
 * regressions are otherwise invisible, Claude Code surfaces stdout as
 * additional context, but a broken hook just emits empty / wrong text without
 * any error path.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  signRecord,
  getPublicKey,
  base64urlEncode,
  genesisChainRoot,
} from '@atrib/mcp'
import type { AtribRecord } from '@atrib/mcp'

const HOOK = resolve(homedir(), '.claude', 'scripts', 'atrib-session-start.mjs')

const KEY = new Uint8Array(32).fill(53)
const CTX = 'a'.repeat(32)

async function makeSigned(timestamp = 1700000000000, content_id?: string): Promise<AtribRecord> {
  const pub = await getPublicKey(KEY)
  const record = {
    spec_version: 'atrib/1.0' as const,
    event_type: 'tool_call' as const,
    context_id: CTX,
    creator_key: base64urlEncode(pub),
    chain_root: genesisChainRoot(CTX),
    content_id: content_id ?? `sha256:${timestamp.toString(16).padStart(64, '0')}`,
    timestamp,
    signature: '',
  }
  return signRecord(record as AtribRecord, KEY)
}

function runHook(env: Record<string, string>): { stdout: string; status: number | null } {
  // Isolate from operator state: point every "would read from disk" path
  // at the per-test tmp dir so substrate-health (Block 6) and tracker /
  // roadmap staleness (Block 5) don't bleed real local files into stdout.
  // Tests that want to exercise those blocks override individual paths in
  // the env arg.
  const isolated = {
    ATRIB_TRACKER_FILE: join(tmp, 'missing-tracker.md'),
    ATRIB_ROADMAP_FILE: join(tmp, 'missing-roadmap.md'),
    ATRIB_HEALTH_HOOKS_LOG: join(tmp, 'missing-hooks.log'),
    ATRIB_HEALTH_WRAPPER_LOG: join(tmp, 'missing-wrapper.log'),
    ATRIB_HEALTH_HERMES_LOG: join(tmp, 'missing-hermes.log'),
    ATRIB_HEALTH_VAULT_SYNC_LOG: join(tmp, 'missing-vault-sync.log'),
    ATRIB_EMIT_RECORD_FILE: join(tmp, 'missing-emit.jsonl'),
  }
  const result = spawnSync('node', [HOOK], {
    env: { ...process.env, ...isolated, ...env },
    encoding: 'utf8',
    timeout: 3000,
  })
  return { stdout: result.stdout ?? '', status: result.status }
}

let tmp: string
let recordFile: string

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'atrib-hook-'))
  recordFile = join(tmp, 'records.jsonl')
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

describe('atrib-session-start hook', () => {
  it('emits empty output and exit 0 when no records and no log reachable', () => {
    const { stdout, status } = runHook({
      ATRIB_RECORD_FILE: join(tmp, 'missing.jsonl'),
      ATRIB_LOG_ENDPOINT: 'https://nonexistent.example.invalid',
    })
    expect(status).toBe(0)
    expect(stdout.trim()).toBe('')
  })

  it('emits the cryptographic-framing line when records exist (offline log)', async () => {
    const r = await makeSigned()
    writeFileSync(recordFile, JSON.stringify(r))

    const { stdout, status } = runHook({
      ATRIB_RECORD_FILE: recordFile,
      ATRIB_LOG_ENDPOINT: 'https://nonexistent.example.invalid',
    })
    expect(status).toBe(0)
    expect(stdout).toMatch(/^atrib: 1 signed prior action /)
    expect(stdout).toMatch(/across 1 trace/)
    // Offline log → no root/verify line, but the chain anchor remains.
    expect(stdout).toMatch(/most recent prior trace [0-9a-f]{12}/)
    // Block 4 ritual prompt references the recall MCP tool by its full name.
    // Copy was rephrased from "recall via recall_my_attribution_history"
    // (early v2) to the current "Use mcp__atrib-recall__recall_my_attribution_history"
    // form once the MCP tool name stabilized. Match the underlying tool name
    // rather than the surrounding copy so future rephrasings don't break.
    expect(stdout).toMatch(/recall_my_attribution_history/)
    // Should NOT claim "verify at log.atrib.dev" when the log was unreachable.
    expect(stdout).not.toMatch(/verify at log\.atrib\.dev/)
  })

  it('pluralizes correctly for multiple records', async () => {
    const records = [
      await makeSigned(1, `sha256:${'a'.repeat(64)}`),
      await makeSigned(2, `sha256:${'b'.repeat(64)}`),
    ]
    writeFileSync(recordFile, records.map((r) => JSON.stringify(r)).join('\n'))

    const { stdout } = runHook({
      ATRIB_RECORD_FILE: recordFile,
      ATRIB_LOG_ENDPOINT: 'https://nonexistent.example.invalid',
    })
    expect(stdout).toMatch(/2 signed prior actions/)
  })

  it('uses the most-recent (highest timestamp) record as the chain anchor', async () => {
    const oldCtx = 'b'.repeat(32)
    const newCtx = CTX
    const oldRec = {
      ...(await makeSigned(1, `sha256:${'1'.repeat(64)}`)),
      context_id: oldCtx,
    }
    // Re-sign after mutating context_id so the signature still matches.
    // For this test, we don't need a valid signature, the hook only
    // pattern-matches context_id and timestamp. Write the unsigned form.
    const newRec = await makeSigned(9_999_999, `sha256:${'2'.repeat(64)}`)
    writeFileSync(recordFile, [JSON.stringify(oldRec), JSON.stringify(newRec)].join('\n'))

    const { stdout } = runHook({
      ATRIB_RECORD_FILE: recordFile,
      ATRIB_LOG_ENDPOINT: 'https://nonexistent.example.invalid',
    })
    expect(stdout).toMatch(new RegExp(`most recent prior trace ${newCtx.slice(0, 12)}`))
  })

  it('exits 0 even on garbage in the jsonl file (degradation guarantee)', () => {
    writeFileSync(recordFile, 'this-is-not-json\n{"partial": "obj"}\n')
    const { stdout, status } = runHook({
      ATRIB_RECORD_FILE: recordFile,
      ATRIB_LOG_ENDPOINT: 'https://nonexistent.example.invalid',
    })
    expect(status).toBe(0)
    // Both lines reject, empty output is correct.
    expect(stdout.trim()).toBe('')
  })
})
