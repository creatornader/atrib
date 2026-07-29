// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
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
    const observer = createMcpCompatibilityObserver({
      profile: 'codex',
      expectedModern: true,
      stateFile: false,
      now: () => now,
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
    expect(report.privacy).toEqual({
      request_bodies_recorded: false,
      context_ids_recorded: false,
      network_identifiers_recorded: false,
      client_labels_bounded: 16,
      protocol_labels_bounded: 8,
    })
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
