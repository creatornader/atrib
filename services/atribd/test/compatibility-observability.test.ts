// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createMcpCompatibilityObserver,
  MCP_COMPATIBILITY_SCHEMA,
} from '../src/compatibility-observability.js'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) {
    rmSync(path, { recursive: true, force: true })
  }
})

function modernBody(name = 'codex', version = '1.0.0') {
  return {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list',
    params: {
      _meta: {
        'io.modelcontextprotocol/protocolVersion': '2026-07-28',
        'io.modelcontextprotocol/clientInfo': { name, version },
      },
    },
  }
}

function legacyBody(name = 'claude-code', version = '1.0.0') {
  return {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      clientInfo: { name, version },
    },
  }
}

describe('MCP compatibility observability', () => {
  it('reports bounded protocol facts and a legacy-after-modern regression', () => {
    let now = Date.parse('2026-07-28T00:00:00.000Z')
    const alerts: unknown[] = []
    const observer = createMcpCompatibilityObserver({
      profile: 'codex',
      expectedModern: true,
      stateFile: false,
      now: () => now,
      onLegacyAfterModern: (event) => alerts.push(event),
    })

    observer.observe({ headers: { 'mcp-protocol-version': '2026-07-28' } }, modernBody())
    now += 1_000
    observer.observe({ headers: {} }, legacyBody())

    const report = observer.report()
    expect(report.schema).toBe(MCP_COMPATIBILITY_SCHEMA)
    expect(report.modern_requests).toBe(1)
    expect(report.legacy_requests).toBe(1)
    expect(report.legacy_after_modern_requests).toBe(1)
    expect(report.clients['codex@1.0.0']?.requests).toBe(1)
    expect(report.clients['claude-code@1.0.0']?.requests).toBe(1)
    expect(report.protocols['2026-07-28']?.requests).toBe(1)
    expect(report.protocols['2025-06-18']?.requests).toBe(1)
    expect(report.removal_readiness.reasons).toContain(
      'legacy traffic observed after modern traffic',
    )
    expect(alerts).toEqual([
      {
        profile: 'codex',
        client: 'claude-code@1.0.0',
        protocol: '2025-06-18',
        observedAt: '2026-07-28T00:00:01.000Z',
        count: 1,
      },
    ])
    expect(report.privacy).toEqual({
      request_bodies_recorded: false,
      context_ids_recorded: false,
      network_identifiers_recorded: false,
      client_labels_bounded: 16,
      protocol_labels_bounded: 8,
    })
  })

  it('treats legacy-after-modern traffic as a regression only within the window', () => {
    let now = Date.parse('2026-10-28T21:00:00.000Z')
    const observer = createMcpCompatibilityObserver({
      profile: 'claude-code',
      expectedModern: true,
      stateFile: false,
      regressionWindowMs: 60_000,
      now: () => now,
    })
    observer.observe(
      { headers: { 'mcp-protocol-version': '2026-07-28' } },
      modernBody('claude-code'),
    )
    expect(observer.report().regression).toEqual({
      active: false,
      window_ms: 60_000,
      last_legacy_after_modern_at: null,
    })

    observer.observe({ headers: {} }, legacyBody('cutover-check', '0'))
    expect(observer.report().regression.active).toBe(true)

    // The window passes with only modern traffic: no longer active, while the
    // lifetime counter and removal readiness keep the evidence.
    now += 60_000
    observer.observe(
      { headers: { 'mcp-protocol-version': '2026-07-28' } },
      modernBody('claude-code'),
    )
    const later = observer.report()
    expect(later.regression.active).toBe(false)
    expect(later.regression.last_legacy_after_modern_at).toBe('2026-10-28T21:00:00.000Z')
    expect(later.legacy_after_modern_requests).toBe(1)
    expect(later.removal_readiness.reasons).toContain(
      'legacy traffic observed after modern traffic',
    )
  })

  it('restarts the window when restored state has no usable regression time', async () => {
    const now = Date.parse('2026-10-31T05:00:00.000Z')
    for (const stamp of [undefined, 'not-a-date', '2027-10-30T12:00:00.000Z']) {
      const dir = mkdtempSync(join(tmpdir(), 'atribd-compat-'))
      temporaryDirectories.push(dir)
      const stateFile = join(dir, 'state.json')
      writeFileSync(
        stateFile,
        JSON.stringify({
          schema: MCP_COMPATIBILITY_SCHEMA,
          profile: 'claude-code',
          observation_started_at: '2026-10-16T06:45:48.985Z',
          updated_at: '2026-10-28T21:37:44.130Z',
          modern_requests: 289,
          legacy_requests: 14,
          legacy_after_modern_requests: 14,
          ...(stamp === undefined ? {} : { last_legacy_after_modern_at: stamp }),
          clients: {},
          protocols: {},
        }),
      )
      let current = now
      const observer = createMcpCompatibilityObserver({
        profile: 'claude-code',
        expectedModern: true,
        stateFile,
        regressionWindowMs: 60_000,
        now: () => current,
      })
      const report = observer.report()
      expect(report.regression.active).toBe(true)
      expect(report.regression.last_legacy_after_modern_at).toBe('2026-10-31T05:00:00.000Z')
      await observer.flush()
      // The restarted window is saved, so a later restart does not re-arm it.
      const saved = JSON.parse(readFileSync(stateFile, 'utf8'))
      expect(saved.last_legacy_after_modern_at).toBe('2026-10-31T05:00:00.000Z')
      current += 60_000
      expect(observer.report().regression.active).toBe(false)
      const restarted = createMcpCompatibilityObserver({
        profile: 'claude-code',
        expectedModern: true,
        stateFile,
        regressionWindowMs: 60_000,
        now: () => current,
      })
      expect(restarted.report().regression.active).toBe(false)
    }
  })

  it('never reports a regression for a profile not expected to be modern', () => {
    const observer = createMcpCompatibilityObserver({ profile: 'mixed', stateFile: false })
    observer.observe({ headers: { 'mcp-protocol-version': '2026-07-28' } }, modernBody())
    observer.observe({ headers: {} }, legacyBody())
    expect(observer.report().regression.active).toBe(false)
  })

  it('requires a sustained zero window and an announcement before removal', () => {
    let now = Date.parse('2026-07-28T00:00:00.000Z')
    const observer = createMcpCompatibilityObserver({
      profile: 'claude-desktop',
      stateFile: false,
      legacyZeroWindowMs: 10_000,
      now: () => now,
    })
    observer.observe(
      { headers: { 'mcp-protocol-version': '2026-07-28' } },
      modernBody('claude-desktop'),
    )
    expect(observer.report().removal_readiness.status).toBe('blocked')

    now += 10_000
    const ready = observer.report()
    expect(ready.removal_readiness.status).toBe('eligible-for-announcement')
    expect(ready.removal_policy.announcement_required).toBe(true)
  })

  it('keeps aggregate evidence across observer restarts', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'atribd-compat-'))
    temporaryDirectories.push(directory)
    const stateFile = join(directory, 'state.json')
    const first = createMcpCompatibilityObserver({
      profile: 'codex',
      stateFile,
      now: () => Date.parse('2026-07-28T00:00:00.000Z'),
    })
    first.observe({ headers: { 'mcp-protocol-version': '2026-07-28' } }, modernBody())
    await first.flush()

    const persisted = JSON.parse(readFileSync(stateFile, 'utf8')) as {
      modern_requests?: number
    }
    expect(persisted.modern_requests).toBe(1)
    const second = createMcpCompatibilityObserver({ profile: 'codex', stateFile })
    expect(second.report().modern_requests).toBe(1)
  })

  it('folds excess client and protocol labels into bounded buckets', () => {
    const observer = createMcpCompatibilityObserver({ stateFile: false })
    for (let index = 0; index < 24; index += 1) {
      observer.observe(
        { headers: { 'mcp-protocol-version': `legacy-${index}` } },
        legacyBody(`client-${index}`),
      )
    }
    const report = observer.report()
    expect(Object.keys(report.clients)).toHaveLength(17)
    expect(Object.keys(report.protocols)).toHaveLength(9)
    expect(report.clients.other?.requests).toBe(8)
    expect(report.protocols.other?.requests).toBe(16)
  })
})
