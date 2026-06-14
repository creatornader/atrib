// SPDX-License-Identifier: Apache-2.0

import { mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { isRuntimeLogCliEntrypoint, runRuntimeLogCli } from '../src/cli.js'
import {
  buildRuntimeLogInspection,
  createLogWindowManifest,
  hashCanonical,
  hashLogWindow,
  hashLogWindowManifest,
  hashProjectionBundle,
  hashRuntimeLogEvent,
  hashSessionDefinition,
  hashSideEffectReceipts,
  isSha256Uri,
  renderRuntimeLogInspectionHtml,
  verifyCompactionBinding,
  verifyForkBinding,
  verifyLogWindowManifest,
  type RuntimeLogEventRef,
  type RuntimeLogProjectionRef,
  type RuntimeLogSideEffectReceiptRef,
} from '../src/index.js'

const SESSION_DEFINITION = {
  session_id: 'run-template',
  behavior_pack: 'activegraph-diligence-v0',
} as const

const SESSION_DIGEST = hashSessionDefinition(SESSION_DEFINITION)

function event(id: string, position: number, body: unknown): RuntimeLogEventRef {
  return {
    event_id: id,
    position,
    event_hash: hashRuntimeLogEvent(body),
  }
}

function baseEvents(): RuntimeLogEventRef[] {
  return [
    event('evt-1', 1, { type: 'plan', text: 'inspect export surface' }),
    event('evt-2', 2, { type: 'tool_call', tool: 'activegraph.export' }),
  ]
}

async function runCli(args: string[]) {
  let stdout = ''
  let stderr = ''
  const code = await runRuntimeLogCli(args, {
    stdout: (text) => {
      stdout += text
    },
    stderr: (text) => {
      stderr += text
    },
  })
  return { code, stdout, stderr }
}

async function writeCliFixtures() {
  const dir = await mkdtemp(join(tmpdir(), 'atrib-runtime-log-'))
  const eventsPath = join(dir, 'events.jsonl')
  const sessionPath = join(dir, 'session.json')
  const manifestPath = join(dir, 'manifest.json')

  await writeFile(
    eventsPath,
    [
      JSON.stringify({ id: 'evt-1', position: 1, type: 'plan', text: 'inspect export surface' }),
      JSON.stringify({ id: 'evt-2', position: 2, type: 'tool_call', tool: 'activegraph.export' }),
    ].join('\n'),
  )
  await writeFile(
    sessionPath,
    JSON.stringify({ id: 'run-cli', behavior_pack: 'activegraph-diligence-v0' }),
  )

  return { dir, eventsPath, sessionPath, manifestPath }
}

describe('@atrib/runtime-log', () => {
  it('hashes JCS material deterministically', () => {
    const left = hashCanonical({ b: 2, a: 1 })
    const right = hashCanonical({ a: 1, b: 2 })

    expect(left).toBe(right)
    expect(isSha256Uri(left)).toBe(true)
  })

  it('keeps runtime-log window order in the event root', () => {
    const events = baseEvents()
    const forward = hashLogWindow(events)
    const reversed = hashLogWindow([...events].reverse())

    expect(forward).not.toBe(reversed)
  })

  it('builds a manifest with event, projection, and receipt roots', () => {
    const events = baseEvents()
    const projections: RuntimeLogProjectionRef[] = [
      {
        name: 'trace-tree',
        format: 'openinference',
        root_hash: hashCanonical({ trace_id: 'tr-1' }),
        event_count: 2,
      },
    ]
    const receipts: RuntimeLogSideEffectReceiptRef[] = [
      {
        protocol: 'mcp',
        receipt_hash: hashCanonical({ tool: 'activegraph.export', ok: true }),
      },
    ]

    const manifest = createLogWindowManifest({
      source: {
        id: 'activegraph.local',
        kind: 'activegraph-export',
        version: '0.1.0',
      },
      runtime: {
        name: 'activegraph',
        version: '0.1.0',
      },
      session: {
        id: 'run-1',
        digest: SESSION_DIGEST,
      },
      window: {
        start: 1,
        end: 2,
      },
      events,
      projections,
      side_effect_receipts: receipts,
      privacy_posture: 'host-owned',
      verifier_policy: {
        require_event_root: true,
      },
    })

    expect(manifest.event_count).toBe(2)
    expect(manifest.event_root).toBe(hashLogWindow(events))
    expect(manifest.projection_root).toBe(hashProjectionBundle(projections))
    expect(manifest.side_effect_receipts_root).toBe(hashSideEffectReceipts(receipts))
    expect(hashLogWindowManifest(manifest)).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  it('verifies supplied evidence against a manifest', () => {
    const events = baseEvents()
    const manifest = createLogWindowManifest({
      source: { id: 'reference-jsonl', kind: 'file', version: '0.1.0' },
      runtime: { name: 'reference-runtime-log', version: '0.1.0' },
      session: { id: 'run-2', digest: SESSION_DIGEST },
      window: { start: 1, end: 2 },
      events,
      privacy_posture: 'local-mirror',
      verifier_policy: { require_event_root: true, require_session_definition: true },
    })

    const result = verifyLogWindowManifest(manifest, {
      session_definition: SESSION_DEFINITION,
      events,
    })

    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.checks.session_definition).toBe(true)
    expect(result.checks.event_root).toBe(true)
  })

  it('rejects a tampered event window', () => {
    const events = baseEvents()
    const manifest = createLogWindowManifest({
      source: { id: 'reference-jsonl', kind: 'file', version: '0.1.0' },
      runtime: { name: 'reference-runtime-log', version: '0.1.0' },
      session: { id: 'run-3', digest: SESSION_DIGEST },
      window: { start: 1, end: 2 },
      events,
      privacy_posture: 'local-mirror',
      verifier_policy: { require_event_root: true },
    })
    const tampered = [
      events[0]!,
      event('evt-2', 2, { type: 'tool_call', tool: 'activegraph.export', tampered: true }),
    ]

    const result = verifyLogWindowManifest(manifest, { events: tampered })

    expect(result.valid).toBe(false)
    expect(result.checks.event_root).toBe(false)
    expect(result.errors.join('\n')).toContain('event_root mismatch')
  })

  it('rejects a wrong session definition digest', () => {
    const events = baseEvents()
    const manifest = createLogWindowManifest({
      source: { id: 'reference-jsonl', kind: 'file', version: '0.1.0' },
      runtime: { name: 'reference-runtime-log', version: '0.1.0' },
      session: { id: 'run-4', digest: SESSION_DIGEST },
      window: { start: 1, end: 2 },
      events,
      privacy_posture: 'local-mirror',
      verifier_policy: {
        require_event_root: true,
        require_session_definition: true,
      },
    })

    const result = verifyLogWindowManifest(manifest, {
      session_definition: { session_id: 'run-template', behavior_pack: 'other' },
      events,
    })

    expect(result.valid).toBe(false)
    expect(result.checks.session_definition).toBe(false)
    expect(result.issues.map((entry) => entry.code)).toContain('session_definition_digest_mismatch')
  })

  it('rejects wrong event counts with stable issue codes', () => {
    const events = baseEvents()
    const manifest = createLogWindowManifest({
      source: { id: 'reference-jsonl', kind: 'file', version: '0.1.0' },
      runtime: { name: 'reference-runtime-log', version: '0.1.0' },
      session: { id: 'run-5', digest: SESSION_DIGEST },
      window: { start: 1, end: 2 },
      events,
      privacy_posture: 'local-mirror',
      verifier_policy: { require_event_root: true },
    })

    const result = verifyLogWindowManifest(manifest, { events: events.slice(0, 1) })

    expect(result.valid).toBe(false)
    expect(result.issues.map((entry) => entry.code)).toContain('event_count_mismatch')
  })

  it('rejects supplied evidence outside the declared window bounds', () => {
    const events = baseEvents()
    const manifest = createLogWindowManifest({
      source: { id: 'reference-jsonl', kind: 'file', version: '0.1.0' },
      runtime: { name: 'reference-runtime-log', version: '0.1.0' },
      session: { id: 'run-6', digest: SESSION_DIGEST },
      window: { start: 1, end: 3 },
      events,
      privacy_posture: 'local-mirror',
      verifier_policy: { require_event_root: true },
    })

    const result = verifyLogWindowManifest(manifest, { events })

    expect(result.valid).toBe(false)
    expect(result.checks.window_bounds).toBe(false)
    expect(result.issues.map((entry) => entry.code)).toContain('window_bounds_mismatch')
  })

  it('rejects manifest fields that the redaction policy declares withheld', () => {
    const events = baseEvents()
    const manifest = createLogWindowManifest({
      source: { id: 'reference-jsonl', kind: 'file', version: '0.1.0' },
      runtime: { name: 'reference-runtime-log', version: '0.1.0' },
      session: { id: 'run-7', digest: SESSION_DIGEST },
      window: { start: 1, end: 2 },
      events,
      redaction: { mode: 'hash-only', fields: ['raw_prompt'] },
      privacy_posture: 'local-mirror',
      verifier_policy: { require_event_root: true },
    })
    const manifestWithRawPrompt = {
      ...manifest,
      raw_prompt: 'do not embed this in the manifest',
    }

    const result = verifyLogWindowManifest(manifestWithRawPrompt, { events })

    expect(result.valid).toBe(false)
    expect(result.checks.withheld_fields).toBe(false)
    expect(result.issues.map((entry) => entry.code)).toContain('withheld_field_present')
  })

  it('hashes projection and receipt refs without caller-order drift', () => {
    const projections: RuntimeLogProjectionRef[] = [
      { name: 'b', format: 'json', root_hash: hashCanonical({ b: true }) },
      { name: 'a', format: 'json', root_hash: hashCanonical({ a: true }) },
    ]
    const receipts: RuntimeLogSideEffectReceiptRef[] = [
      { protocol: 'z', receipt_hash: hashCanonical({ z: true }) },
      { protocol: 'a', receipt_hash: hashCanonical({ a: true }) },
    ]

    expect(hashProjectionBundle(projections)).toBe(hashProjectionBundle([...projections].reverse()))
    expect(hashSideEffectReceipts(receipts)).toBe(hashSideEffectReceipts([...receipts].reverse()))
  })

  it('rejects invalid hash strings before building roots', () => {
    expect(() =>
      hashLogWindow([
        {
          event_id: 'evt-bad',
          position: 1,
          event_hash: 'sha256:not-valid',
        },
      ]),
    ).toThrow('event_hash for evt-bad')
  })

  it('rejects a mismatched fork parent manifest', () => {
    const parentEvents = baseEvents()
    const parent = createLogWindowManifest({
      source: { id: 'reference-jsonl', kind: 'file', version: '0.1.0' },
      runtime: { name: 'reference-runtime-log', version: '0.1.0' },
      session: { id: 'parent', digest: SESSION_DIGEST },
      window: { start: 1, end: 2 },
      events: parentEvents,
      privacy_posture: 'local-mirror',
      verifier_policy: { require_event_root: true },
    })
    const otherParent = createLogWindowManifest({
      source: { id: 'reference-jsonl', kind: 'file', version: '0.1.0' },
      runtime: { name: 'reference-runtime-log', version: '0.1.0' },
      session: { id: 'other-parent', digest: SESSION_DIGEST },
      window: { start: 1, end: 2 },
      events: parentEvents,
      privacy_posture: 'local-mirror',
      verifier_policy: { require_event_root: true },
    })
    const child = createLogWindowManifest({
      source: { id: 'reference-jsonl', kind: 'file', version: '0.1.0' },
      runtime: { name: 'reference-runtime-log', version: '0.1.0' },
      session: { id: 'child', digest: SESSION_DIGEST },
      window: { start: 3, end: 4 },
      events: [event('evt-3', 3, { type: 'forked' })],
      fork: { parent_window_manifest_hash: hashLogWindowManifest(parent) },
      privacy_posture: 'local-mirror',
      verifier_policy: { require_fork_parent: true },
    })

    const directResult = verifyForkBinding(child, otherParent)
    const manifestResult = verifyLogWindowManifest(child, {
      events: child.event_count ? [event('evt-3', 3, { type: 'forked' })] : [],
      fork_parent_manifest: otherParent,
    })

    expect(directResult.valid).toBe(false)
    expect(directResult.issues.map((entry) => entry.code)).toContain('fork_parent_mismatch')
    expect(manifestResult.valid).toBe(false)
    expect(manifestResult.checks.fork_parent).toBe(false)
  })

  it('rejects missing compaction source evidence', () => {
    const source = createLogWindowManifest({
      source: { id: 'reference-jsonl', kind: 'file', version: '0.1.0' },
      runtime: { name: 'reference-runtime-log', version: '0.1.0' },
      session: { id: 'source', digest: SESSION_DIGEST },
      window: { start: 1, end: 2 },
      events: baseEvents(),
      privacy_posture: 'local-mirror',
      verifier_policy: { require_event_root: true },
    })
    const compactedEvents = [event('evt-summary', 3, { type: 'summary', source: 'source' })]
    const compacted = createLogWindowManifest({
      source: { id: 'reference-jsonl', kind: 'file', version: '0.1.0' },
      runtime: { name: 'reference-runtime-log', version: '0.1.0' },
      session: { id: 'compacted', digest: SESSION_DIGEST },
      window: { start: 3, end: 3 },
      events: compactedEvents,
      compaction: {
        source_window_manifest_hash: hashLogWindowManifest(source),
        compacted_event_root: hashLogWindow(compactedEvents),
      },
      privacy_posture: 'local-mirror',
      verifier_policy: { require_compaction_source: true },
    })

    const directResult = verifyCompactionBinding(compacted, {
      compacted_events: compactedEvents,
    })
    const manifestResult = verifyLogWindowManifest(compacted, {
      events: compactedEvents,
      compaction_events: compactedEvents,
    })

    expect(directResult.valid).toBe(false)
    expect(directResult.issues.map((entry) => entry.code)).toContain('compaction_source_missing')
    expect(manifestResult.valid).toBe(false)
    expect(manifestResult.issues.map((entry) => entry.code)).toContain('compaction_source_missing')
  })

  it('prints version from the default command path', async () => {
    const result = await runCli(['--version'])

    expect(result).toMatchObject({ code: 0, stdout: '0.1.0\n', stderr: '' })
  })

  it('recognizes npm bin symlink entrypoint paths', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'atrib-runtime-log-entrypoint-'))
    const realCliPath = join(dir, 'cli.js')
    const symlinkPath = join(dir, 'atrib-runtime-log')
    await writeFile(realCliPath, '#!/usr/bin/env node\n')
    await symlink(realCliPath, symlinkPath)

    expect(isRuntimeLogCliEntrypoint(pathToFileURL(realCliPath).href, symlinkPath)).toBe(true)
  })

  it('attests, verifies, and inspects a manifest from files only', async () => {
    const { eventsPath, sessionPath, manifestPath } = await writeCliFixtures()

    const attest = await runCli([
      'attest',
      '--events',
      eventsPath,
      '--session-definition',
      sessionPath,
      '--out',
      manifestPath,
      '--source-id',
      'fixture.runtime-log',
      '--runtime-name',
      'fixture-runtime',
      '--runtime-version',
      '0.1.0',
    ])
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      event_count: number
      session: { digest: string }
    }

    expect(attest).toMatchObject({ code: 0, stdout: '', stderr: '' })
    expect(manifest.event_count).toBe(2)
    expect(manifest.session.digest).toBe(
      hashSessionDefinition({ id: 'run-cli', behavior_pack: 'activegraph-diligence-v0' }),
    )

    const verify = await runCli([
      'verify',
      '--manifest',
      manifestPath,
      '--events',
      eventsPath,
      '--session-definition',
      sessionPath,
    ])
    const verifyResult = JSON.parse(verify.stdout) as { valid: boolean; issues: unknown[] }

    expect(verify.code).toBe(0)
    expect(verifyResult.valid).toBe(true)
    expect(verifyResult.issues).toEqual([])

    const inspect = await runCli([
      'inspect',
      '--manifest',
      manifestPath,
      '--events',
      eventsPath,
      '--session-definition',
      sessionPath,
    ])
    const inspectResult = JSON.parse(inspect.stdout) as {
      manifest_hash: string
      source_identity: { source: { id: string } }
      window: { event_count: number }
      claim: { valid: boolean }
    }

    expect(inspect.code).toBe(0)
    expect(inspectResult.manifest_hash).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(inspectResult.source_identity.source.id).toBe('fixture.runtime-log')
    expect(inspectResult.window.event_count).toBe(2)
    expect(inspectResult.claim.valid).toBe(true)
  })

  it('builds a reviewer inspection packet without raw runtime bodies', () => {
    const events = baseEvents()
    const manifest = createLogWindowManifest({
      source: { id: 'reference-jsonl', kind: 'file', version: '0.1.0' },
      runtime: { name: 'reference-runtime-log', version: '0.1.0' },
      session: { id: 'run-inspect', digest: SESSION_DIGEST },
      window: { start: 1, end: 2 },
      events,
      redaction: { mode: 'hash-only', fields: ['raw_prompt'] },
      privacy_posture: 'local-mirror',
      verifier_policy: { require_event_root: true },
    })

    const inspection = buildRuntimeLogInspection({
      manifest,
      evidence: { events },
      signed_record: {
        record_hash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        uri: 'https://log.atrib.dev/v1/records/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
    })
    const html = renderRuntimeLogInspectionHtml(inspection)

    expect(inspection.claim.valid).toBe(true)
    expect(inspection.redaction.raw_runtime_bodies_shown).toBe(false)
    expect(inspection.redaction.fields).toEqual(['raw_prompt'])
    expect(inspection.signed_record?.record_hash).toBe(
      'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    )
    expect(html).toContain('Runtime-log proof packet')
    expect(html).toContain('Raw runtime bodies')
    expect(html).toContain('not shown')
  })

  it('exits nonzero and prints issue codes for tampered file verification', async () => {
    const { dir, eventsPath, sessionPath, manifestPath } = await writeCliFixtures()
    const tamperedEventsPath = join(dir, 'tampered-events.jsonl')
    await runCli([
      'attest',
      '--events',
      eventsPath,
      '--session-definition',
      sessionPath,
      '--out',
      manifestPath,
    ])
    await writeFile(
      tamperedEventsPath,
      [
        JSON.stringify({ id: 'evt-1', position: 1, type: 'plan', text: 'inspect export surface' }),
        JSON.stringify({ id: 'evt-2', position: 2, type: 'tool_call', tool: 'other.export' }),
      ].join('\n'),
    )

    const verify = await runCli([
      'verify',
      '--manifest',
      manifestPath,
      '--events',
      tamperedEventsPath,
      '--session-definition',
      sessionPath,
    ])
    const verifyResult = JSON.parse(verify.stdout) as {
      valid: boolean
      issues: Array<{ code: string }>
    }

    expect(verify.code).toBe(1)
    expect(verifyResult.valid).toBe(false)
    expect(verifyResult.issues.map((entry) => entry.code)).toContain('event_root_mismatch')
  })

  it('renders invalid verifier issue codes in the HTML inspection packet', async () => {
    const { dir, eventsPath, sessionPath, manifestPath } = await writeCliFixtures()
    const tamperedEventsPath = join(dir, 'tampered-events.jsonl')
    const htmlPath = join(dir, 'proof.html')
    await runCli([
      'attest',
      '--events',
      eventsPath,
      '--session-definition',
      sessionPath,
      '--out',
      manifestPath,
    ])
    await writeFile(
      tamperedEventsPath,
      [
        JSON.stringify({ id: 'evt-1', position: 1, type: 'plan', text: 'inspect export surface' }),
        JSON.stringify({ id: 'evt-2', position: 2, type: 'tool_call', tool: 'other.export' }),
      ].join('\n'),
    )

    const inspect = await runCli([
      'inspect',
      '--manifest',
      manifestPath,
      '--events',
      tamperedEventsPath,
      '--session-definition',
      sessionPath,
      '--format',
      'html',
      '--out',
      htmlPath,
      '--signed-record',
      'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    ])
    const html = await readFile(htmlPath, 'utf8')

    expect(inspect).toMatchObject({ code: 0, stdout: '', stderr: '' })
    expect(html).toContain('Rejected')
    expect(html).toContain('event_root_mismatch')
    expect(html).toContain(
      'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    )
    expect(html).not.toContain('other.export</code></td>')
  })
})
