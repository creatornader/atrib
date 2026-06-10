import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  hashLocalSubstrateRecordBody,
  localSubstrateRecordBodiesEqual,
  validateLocalSubstrateFixture,
  validateLocalSubstrateHealthReport,
  validateLocalSubstrateRequest,
  type LocalSubstrateCoordinatorRequest,
  type LocalSubstrateFixture,
  type LocalSubstrateHarnessClass,
} from '../src/index.js'

const corpusRoot = fileURLToPath(
  new URL('../../../spec/conformance/local-substrate-coordinator/', import.meta.url),
)

interface Manifest {
  cases: Array<{
    file: string
    name: string
  }>
  required_harness_classes: LocalSubstrateHarnessClass[]
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(new URL(relativePath, `file://${corpusRoot}/`), 'utf8')) as T
}

describe('local substrate coordinator contract', () => {
  it('validates every P042 fixture against the shared package contract', () => {
    const manifest = readJson<Manifest>('manifest.json')
    const seen = new Set<LocalSubstrateHarnessClass>()

    for (const entry of manifest.cases) {
      const fixture = readJson<LocalSubstrateFixture>(entry.file)
      const result = validateLocalSubstrateFixture(fixture, { expectedName: entry.name })

      expect(result.issues).toEqual([])
      expect(result.ok).toBe(true)
      expect(fixture.name).toBe(entry.name)
      expect(
        localSubstrateRecordBodiesEqual(
          fixture.input.coordinator_request.record_body,
          fixture.input.direct_record_body,
        ),
      ).toBe(true)
      expect(hashLocalSubstrateRecordBody(fixture.input.coordinator_request.record_body)).toBe(
        fixture.expected.canonical_record_body_sha256,
      )

      seen.add(fixture.harness_class)
    }

    expect([...seen].sort()).toEqual([...manifest.required_harness_classes].sort())
  })

  it('rejects a coordinator request that mutates signed record bytes', () => {
    const fixture = readJson<LocalSubstrateFixture>('cases/startup-spawn-codex-tool-call.json')
    const request: LocalSubstrateCoordinatorRequest = {
      ...fixture.input.coordinator_request,
      record_body: {
        ...fixture.input.coordinator_request.record_body,
        tool_name: 'agent-bridge.changed',
      },
    }

    const result = validateLocalSubstrateRequest(request, {
      expectedHarnessClass: fixture.harness_class,
      directRecordBody: fixture.input.direct_record_body,
    })

    expect(result.ok).toBe(false)
    expect(result.issues).toContainEqual({
      path: 'record_body',
      message: 'must equal the direct producer body',
    })
  })

  it('rejects signed records at the coordinator boundary', () => {
    const fixture = readJson<LocalSubstrateFixture>('cases/long-lived-assistant-observation.json')
    const request = {
      ...fixture.input.coordinator_request,
      record_body: {
        ...fixture.input.coordinator_request.record_body,
        signature: 'this-field-belongs-after-the-coordinator-signing-path',
      },
    }

    const result = validateLocalSubstrateRequest(request, {
      expectedHarnessClass: fixture.harness_class,
      directRecordBody: fixture.input.direct_record_body,
    })

    expect(result.ok).toBe(false)
    expect(result.issues).toContainEqual({
      path: 'record_body.signature',
      message: 'record_body must be unsigned',
    })
  })

  it('requires watcher WAL requests to carry explicit receipt join metadata', () => {
    const fixture = readJson<LocalSubstrateFixture>('cases/watcher-wal-annotation.json')
    const { wal: _wal, ...withoutWal } = fixture.input.coordinator_request

    const result = validateLocalSubstrateRequest(withoutWal, {
      expectedHarnessClass: fixture.harness_class,
      directRecordBody: fixture.input.direct_record_body,
    })

    expect(result.ok).toBe(false)
    expect(result.issues).toContainEqual({
      path: 'wal',
      message: 'watcher-wal requests must include WAL join metadata',
    })
  })

  it('rejects coordinator context that no longer matches the unsigned body', () => {
    const fixture = readJson<LocalSubstrateFixture>('cases/startup-spawn-codex-tool-call.json')
    const request: LocalSubstrateCoordinatorRequest = {
      ...fixture.input.coordinator_request,
      context: {
        ...fixture.input.coordinator_request.context!,
        context_id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        chain_tail: `sha256:${'b'.repeat(64)}`,
        parent_record_hash: `sha256:${'c'.repeat(64)}`,
      },
    }

    const result = validateLocalSubstrateRequest(request, {
      expectedHarnessClass: fixture.harness_class,
      directRecordBody: fixture.input.direct_record_body,
    })

    expect(result.ok).toBe(false)
    expect(result.issues).toEqual(
      expect.arrayContaining([
        {
          path: 'context.context_id',
          message: 'must match record_body.context_id',
        },
        {
          path: 'context.chain_tail',
          message: 'must match record_body.chain_root',
        },
        {
          path: 'context.parent_record_hash',
          message: 'must be present in record_body.informed_by',
        },
      ]),
    )
  })

  it('keeps coordinator health reports non-blocking and rollout-gate shaped', () => {
    const fixture = readJson<LocalSubstrateFixture>('cases/startup-spawn-codex-tool-call.json')
    const valid = validateLocalSubstrateHealthReport(fixture.input.health_report)
    const invalid = validateLocalSubstrateHealthReport({
      ...fixture.input.health_report,
      processes: {
        active_wrappers: 1,
      },
    })

    expect(valid.ok).toBe(true)
    expect(invalid.ok).toBe(false)
    expect(invalid.issues).toContainEqual({
      path: 'processes.stale_children',
      message: 'must be a non-negative integer',
    })
  })
})
