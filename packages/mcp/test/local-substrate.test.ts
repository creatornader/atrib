import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  LOCAL_SUBSTRATE_REQUEST_MODES,
  LOCAL_SUBSTRATE_RESPONSE_SCHEMA,
  base64urlEncode,
  bindLocalSubstrateCoordinatorNodeServer,
  buildLocalSubstrateHealthReport,
  canonicalRecord,
  createHttpLocalSubstrateTransport,
  createInProcessLocalSubstrateCoordinator,
  createLocalSubstrateCoordinatorHttpHandler,
  encodeToken,
  handleLocalSubstrateCoordinatorHttpRequest,
  hashLocalSubstrateRecordBody,
  hexEncode,
  localSubstrateRecordBodiesEqual,
  probeLocalSubstrateHealth,
  sha256,
  tryLocalSubstrateCoordinator,
  validateLocalSubstrateFixture,
  validateLocalSubstrateHealthReport,
  validateLocalSubstrateRequest,
  validateLocalSubstrateResponse,
  verifyRecord,
  type AtribRecord,
  type LocalSubstrateCoordinatorRequest,
  type LocalSubstrateCoordinatorResponse,
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

function fixtureSeed(value: number): string {
  return base64urlEncode(new Uint8Array(32).fill(value))
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

  it('accepts shadow_probe only for startup-spawn sign requests', () => {
    const fixture = readJson<LocalSubstrateFixture>('cases/startup-spawn-codex-tool-call.json')
    const request: LocalSubstrateCoordinatorRequest = {
      ...fixture.input.coordinator_request,
      mode: 'shadow_probe',
    }

    expect(LOCAL_SUBSTRATE_REQUEST_MODES).toContain('shadow_probe')
    expect(validateLocalSubstrateRequest(request).ok).toBe(true)

    expect(
      validateLocalSubstrateRequest({
        ...request,
        operation: 'enqueue_record_and_join_receipt',
      }).issues,
    ).toContainEqual({
      path: 'mode',
      message: 'shadow_probe is only valid for sign_record requests',
    })
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

  it('validates coordinator responses against the request operation', () => {
    const fixture = readJson<LocalSubstrateFixture>('cases/startup-spawn-codex-tool-call.json')
    const valid: LocalSubstrateCoordinatorResponse = {
      schema: LOCAL_SUBSTRATE_RESPONSE_SCHEMA,
      operation: fixture.input.coordinator_request.operation,
      status: 'accepted',
      record_hash: `sha256:${'1'.repeat(64)}`,
      warnings: ['queued for archive submission'],
      health_report: fixture.input.health_report,
    }
    const mismatch = {
      ...valid,
      operation: 'enqueue_record_and_join_receipt',
    }

    expect(
      validateLocalSubstrateResponse(valid, { request: fixture.input.coordinator_request }).ok,
    ).toBe(true)
    expect(
      validateLocalSubstrateResponse(mismatch, { request: fixture.input.coordinator_request })
        .issues,
    ).toContainEqual({
      path: 'operation',
      message: 'must match request.operation',
    })
    expect(
      validateLocalSubstrateResponse({
        schema: LOCAL_SUBSTRATE_RESPONSE_SCHEMA,
        operation: fixture.input.coordinator_request.operation,
        status: 'accepted',
      }).issues,
    ).toContainEqual({
      path: 'record_hash',
      message: 'accepted responses must include the signed record hash',
    })
  })

  it('requires WAL join responses to return receipt ids', () => {
    const fixture = readJson<LocalSubstrateFixture>('cases/watcher-wal-annotation.json')
    const missingReceipt: LocalSubstrateCoordinatorResponse = {
      schema: LOCAL_SUBSTRATE_RESPONSE_SCHEMA,
      operation: fixture.input.coordinator_request.operation,
      status: 'accepted',
      record_hash: `sha256:${'4'.repeat(64)}`,
    }

    expect(
      validateLocalSubstrateResponse(missingReceipt, {
        request: fixture.input.coordinator_request,
      }).issues,
    ).toContainEqual({
      path: 'receipt_id',
      message: 'accepted WAL join responses must include a receipt id',
    })
  })

  it('does not call coordinator transport for invalid requests', async () => {
    const fixture = readJson<LocalSubstrateFixture>('cases/startup-spawn-codex-tool-call.json')
    const invalid = {
      ...fixture.input.coordinator_request,
      schema: 'wrong-schema',
    } as unknown as LocalSubstrateCoordinatorRequest
    let called = false

    const result = await tryLocalSubstrateCoordinator(invalid, {
      expectedHarnessClass: fixture.harness_class,
      directRecordBody: fixture.input.direct_record_body,
      transport: async () => {
        called = true
        return {}
      },
    })

    expect(result.ok).toBe(false)
    expect(result.status).toBe('invalid_request')
    expect(called).toBe(false)
  })

  it('classifies accepted, rejected, invalid, and unavailable coordinator attempts', async () => {
    const fixture = readJson<LocalSubstrateFixture>('cases/startup-spawn-codex-tool-call.json')
    const request = fixture.input.coordinator_request
    const accepted = await tryLocalSubstrateCoordinator(request, {
      timeoutMs: 100,
      transport: async (_request, options) => {
        expect(options.timeoutMs).toBe(100)
        expect(options.signal).toBeDefined()
        return {
          schema: LOCAL_SUBSTRATE_RESPONSE_SCHEMA,
          operation: request.operation,
          status: 'accepted',
          record_hash: `sha256:${'2'.repeat(64)}`,
        }
      },
    })
    const rejected = await tryLocalSubstrateCoordinator(request, {
      transport: async () => ({
        schema: LOCAL_SUBSTRATE_RESPONSE_SCHEMA,
        operation: request.operation,
        status: 'rejected',
        rejection_reason: 'coordinator disabled by operator policy',
      }),
    })
    const invalid = await tryLocalSubstrateCoordinator(request, {
      transport: async () => ({
        schema: LOCAL_SUBSTRATE_RESPONSE_SCHEMA,
        operation: request.operation,
        status: 'accepted',
        record_hash: 'not-a-record-hash',
      }),
    })
    const unavailable = await tryLocalSubstrateCoordinator(request, {
      timeoutMs: 5,
      transport: async () => {
        await new Promise(() => undefined)
      },
    })

    expect(accepted.ok).toBe(true)
    expect(accepted.status).toBe('accepted')
    expect(rejected.ok).toBe(false)
    expect(rejected.status).toBe('rejected')
    expect(invalid.ok).toBe(false)
    expect(invalid.status).toBe('invalid_response')
    expect(unavailable.ok).toBe(false)
    expect(unavailable.status).toBe('unavailable')
    expect(unavailable.reason).toMatch(/timed out/)
  })

  it('posts coordinator requests over the explicit HTTP transport', async () => {
    const fixture = readJson<LocalSubstrateFixture>('cases/startup-spawn-codex-tool-call.json')
    const response: LocalSubstrateCoordinatorResponse = {
      schema: LOCAL_SUBSTRATE_RESPONSE_SCHEMA,
      operation: fixture.input.coordinator_request.operation,
      status: 'accepted',
      record_hash: `sha256:${'3'.repeat(64)}`,
    }
    const seen: Array<{ url: string; init: RequestInit }> = []
    const fetchImpl: typeof fetch = async (input, init) => {
      seen.push({ url: String(input), init: init ?? {} })
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    const transport = createHttpLocalSubstrateTransport('http://127.0.0.1:8787/atrib', {
      fetch: fetchImpl,
      headers: { 'x-test': 'yes' },
    })

    const raw = await transport(fixture.input.coordinator_request, { timeoutMs: 50 })

    expect(raw).toEqual(response)
    expect(seen).toHaveLength(1)
    expect(seen[0]!.url).toBe('http://127.0.0.1:8787/atrib')
    expect(seen[0]!.init.method).toBe('POST')
    expect(seen[0]!.init.headers).toMatchObject({
      'content-type': 'application/json',
      'x-test': 'yes',
    })
    expect(JSON.parse(String(seen[0]!.init.body))).toEqual(fixture.input.coordinator_request)
  })

  it('serves coordinator POST and health over the shared HTTP handler', async () => {
    const fixture = readJson<LocalSubstrateFixture>('cases/startup-spawn-codex-tool-call.json')
    const observed: AtribRecord[] = []
    const coordinator = createInProcessLocalSubstrateCoordinator({
      creatorKey: fixtureSeed(0x11),
      logSubmission: 'disabled',
      onRecord: (record) => {
        observed.push(record)
      },
      health: {
        pid: 777,
        version: '0.0.0-test',
        transport: 'http://127.0.0.1:8787/atrib/local-substrate',
      },
    })
    const handler = createLocalSubstrateCoordinatorHttpHandler(coordinator)
    const fetchImpl: typeof fetch = async (input, init) => {
      return (
        (await handler(new Request(String(input), init))) ??
        new Response('not found', { status: 404 })
      )
    }
    const transport = createHttpLocalSubstrateTransport(
      'http://127.0.0.1:8787/atrib/local-substrate',
      { fetch: fetchImpl },
    )

    const result = await tryLocalSubstrateCoordinator(fixture.input.coordinator_request, {
      transport,
    })

    expect(result.ok).toBe(true)
    expect(result.status).toBe('accepted')
    expect(observed).toHaveLength(1)

    const healthResponse = await handler(
      new Request('http://127.0.0.1:8787/atrib/local-substrate/health'),
    )
    expect(healthResponse?.status).toBe(200)
    const health = (await healthResponse!.json()) as ReturnType<typeof coordinator.health>
    expect(health.status).toBe('healthy')
    expect(health.report.coordinator.pid).toBe(777)
    expect(health.report.contexts.active).toEqual([
      fixture.input.coordinator_request.record_body.context_id,
    ])

    const headResponse = await handler(
      new Request('http://127.0.0.1:8787/atrib/local-substrate', { method: 'HEAD' }),
    )
    expect(headResponse?.status).toBe(200)
    expect(await headResponse!.text()).toBe('')

    coordinator.destroy()
  })

  it('keeps HTTP service request failures outside the coordinator hot path', async () => {
    const coordinator = createInProcessLocalSubstrateCoordinator({
      creatorKey: fixtureSeed(0x11),
      logSubmission: 'disabled',
    })

    const invalidRequest = await handleLocalSubstrateCoordinatorHttpRequest(
      coordinator,
      'POST',
      '/atrib/local-substrate',
      { schema: 'wrong-schema' },
    )
    const missing = await handleLocalSubstrateCoordinatorHttpRequest(
      coordinator,
      'GET',
      '/not-an-atrib-route',
    )
    const invalidJson = await createLocalSubstrateCoordinatorHttpHandler(coordinator)(
      new Request('http://127.0.0.1:8787/atrib/local-substrate', {
        method: 'POST',
        body: 'not-json',
      }),
    )

    expect(invalidRequest?.status).toBe(400)
    expect(JSON.parse(invalidRequest!.body)).toMatchObject({ error: 'invalid_request' })
    expect(missing).toBeNull()
    expect(invalidJson?.status).toBe(400)
    expect(await invalidJson!.json()).toMatchObject({ error: 'invalid_json' })

    coordinator.destroy()
  })

  it('binds a loopback Node HTTP server for supervised local hosts', async () => {
    const fixture = readJson<LocalSubstrateFixture>('cases/startup-spawn-codex-tool-call.json')
    const observed: AtribRecord[] = []
    const coordinator = createInProcessLocalSubstrateCoordinator({
      creatorKey: fixtureSeed(0x11),
      logSubmission: 'disabled',
      onRecord: (record) => {
        observed.push(record)
      },
      health: {
        pid: 888,
        version: '0.0.0-node-test',
        transport: 'node-http',
      },
    })
    const server = await bindLocalSubstrateCoordinatorNodeServer(coordinator, { port: 0 })

    try {
      const result = await tryLocalSubstrateCoordinator(fixture.input.coordinator_request, {
        transport: createHttpLocalSubstrateTransport(server.endpoint),
      })
      const health = await fetch(server.healthEndpoint)
      const missing = await fetch(`${server.url}/not-an-atrib-route`)
      const head = await fetch(server.endpoint, { method: 'HEAD' })

      expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
      expect(result.ok).toBe(true)
      expect(result.status).toBe('accepted')
      expect(observed).toHaveLength(1)
      expect(health.status).toBe(200)
      expect(((await health.json()) as ReturnType<typeof coordinator.health>).report.coordinator.pid).toBe(
        888,
      )
      expect(missing.status).toBe(404)
      expect(await missing.json()).toEqual({ error: 'not_found' })
      expect(head.status).toBe(200)
      expect(head.headers.get('access-control-allow-origin')).toBeNull()
      expect(await head.text()).toBe('')
    } finally {
      await server.close()
      coordinator.destroy()
    }
  })

  it('rejects bad Node HTTP bodies before the coordinator hot path', async () => {
    let called = false
    const coordinator = {
      transport: async () => {
        called = true
        return {}
      },
      health: () =>
        probeLocalSubstrateHealth({
          coordinator: {
            pid: 999,
            version: '0.0.0-node-test',
            transport: 'node-http',
          },
        }),
    }
    const server = await bindLocalSubstrateCoordinatorNodeServer(coordinator, {
      port: 0,
      maxBodyBytes: 8,
    })

    try {
      const invalidJson = await fetch(server.endpoint, { method: 'POST', body: 'not-json' })
      const tooLarge = await fetch(server.endpoint, {
        method: 'POST',
        body: JSON.stringify({ bigger: 'than-eight-bytes' }),
      })

      expect(invalidJson.status).toBe(400)
      expect(await invalidJson.json()).toMatchObject({ error: 'invalid_json' })
      expect(tooLarge.status).toBe(413)
      expect(await tooLarge.json()).toMatchObject({ error: 'payload_too_large' })
      expect(called).toBe(false)
    } finally {
      await server.close()
    }
  })

  it('signs startup-spawn records through the in-process coordinator prototype', async () => {
    const fixture = readJson<LocalSubstrateFixture>('cases/startup-spawn-codex-tool-call.json')
    const observed: AtribRecord[] = []
    const coordinator = createInProcessLocalSubstrateCoordinator({
      creatorKey: fixtureSeed(0x11),
      logSubmission: 'disabled',
      onRecord: (record) => {
        observed.push(record)
      },
      health: {
        pid: 401,
        version: '0.0.0-test',
        transport: 'in-process-test',
        activeWrapperPids: [501],
      },
    })

    const result = await tryLocalSubstrateCoordinator(fixture.input.coordinator_request, {
      transport: coordinator.transport,
    })

    expect(result.ok).toBe(true)
    expect(result.status).toBe('accepted')
    if (!result.ok) {
      throw new Error(result.status)
    }

    expect(observed).toHaveLength(1)
    const signed = observed[0]!
    expect(await verifyRecord(signed)).toBe(true)
    expect(signed.signature).not.toBe('')
    expect(result.response.record_hash).toBe(`sha256:${hexEncode(sha256(canonicalRecord(signed)))}`)
    expect(result.response.receipt_id).toBe(encodeToken(signed))
    expect(result.response.health_report?.contexts.active).toEqual([
      fixture.input.coordinator_request.record_body.context_id,
    ])
    expect(result.response.health_report?.processes.active_wrappers).toBe(1)
    expect(coordinator.health().status).toBe('healthy')

    await coordinator.flush()
    coordinator.destroy()
  })

  it('signs watcher WAL records through commit mode with receipt join metadata', async () => {
    const fixture = readJson<LocalSubstrateFixture>('cases/watcher-wal-annotation.json')
    const observed: Array<{ record: AtribRecord; receiptId: string; walEntryId?: string }> = []
    const coordinator = createInProcessLocalSubstrateCoordinator({
      creatorKey: fixtureSeed(0x11),
      supportedHarnessClasses: ['watcher-wal'],
      logSubmission: 'disabled',
      onRecord: (record, context) => {
        observed.push({
          record,
          receiptId: context.receipt_id,
          walEntryId: context.request.wal?.entry_id,
        })
      },
      health: {
        pid: 402,
        version: '0.0.0-test',
        transport: 'in-process-test',
        walPending: 1,
        walJoined: 42,
        walOrphanReceipts: 0,
      },
    })

    const result = await tryLocalSubstrateCoordinator(fixture.input.coordinator_request, {
      expectedHarnessClass: 'watcher-wal',
      directRecordBody: fixture.input.direct_record_body,
      transport: coordinator.transport,
    })

    expect(result.ok).toBe(true)
    expect(result.status).toBe('accepted')
    if (!result.ok) {
      throw new Error(result.status)
    }

    expect(observed).toHaveLength(1)
    const signed = observed[0]!.record
    expect(await verifyRecord(signed)).toBe(true)
    expect(observed[0]!.receiptId).toBe(result.response.receipt_id)
    expect(observed[0]!.walEntryId).toBe(fixture.input.coordinator_request.wal?.entry_id)
    expect(result.response.operation).toBe('enqueue_record_and_join_receipt')
    expect(result.response.receipt_id).toBe(encodeToken(signed))
    expect(result.response.record_hash).toBe(`sha256:${hexEncode(sha256(canonicalRecord(signed)))}`)
    expect(result.response.health_report?.contexts.active).toEqual([
      fixture.input.coordinator_request.record_body.context_id,
    ])
    expect(result.response.health_report?.wal).toMatchObject({
      pending: 1,
      joined: 42,
      orphan_receipts: 0,
    })

    await coordinator.flush()
    coordinator.destroy()
  })

  it('shadow probes sign startup-spawn bodies without committing coordinator side effects', async () => {
    const fixture = readJson<LocalSubstrateFixture>('cases/startup-spawn-codex-tool-call.json')
    const observed: AtribRecord[] = []
    const coordinator = createInProcessLocalSubstrateCoordinator({
      creatorKey: fixtureSeed(0x11),
      logSubmission: 'disabled',
      onRecord: (record) => {
        observed.push(record)
      },
    })

    const result = await tryLocalSubstrateCoordinator(
      {
        ...fixture.input.coordinator_request,
        mode: 'shadow_probe',
      },
      {
        transport: coordinator.transport,
      },
    )

    expect(result.ok).toBe(true)
    expect(result.status).toBe('accepted')
    if (!result.ok) {
      throw new Error(result.status)
    }
    expect(result.response.record_hash).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(result.response.receipt_id).toBeDefined()
    expect(observed).toHaveLength(0)

    coordinator.destroy()
  })

  it('rejects in-process requests when the signer does not match the body', async () => {
    const fixture = readJson<LocalSubstrateFixture>('cases/startup-spawn-codex-tool-call.json')
    const observed: AtribRecord[] = []
    const coordinator = createInProcessLocalSubstrateCoordinator({
      creatorKey: fixtureSeed(0x22),
      logSubmission: 'disabled',
      onRecord: (record) => {
        observed.push(record)
      },
    })

    const result = await tryLocalSubstrateCoordinator(fixture.input.coordinator_request, {
      transport: coordinator.transport,
    })

    expect(result.ok).toBe(false)
    expect(result.status).toBe('rejected')
    if (result.status !== 'rejected') {
      throw new Error(result.status)
    }
    expect(result.reason).toBe('record_body.creator_key does not match coordinator signer')
    expect(observed).toHaveLength(0)

    coordinator.destroy()
  })

  it('keeps the in-process prototype scoped to startup-spawn by default', async () => {
    const fixture = readJson<LocalSubstrateFixture>('cases/long-lived-assistant-observation.json')
    const coordinator = createInProcessLocalSubstrateCoordinator({
      creatorKey: fixtureSeed(0x11),
      logSubmission: 'disabled',
    })

    const result = await tryLocalSubstrateCoordinator(fixture.input.coordinator_request, {
      transport: coordinator.transport,
    })

    expect(result.ok).toBe(false)
    expect(result.status).toBe('rejected')
    if (result.status !== 'rejected') {
      throw new Error(result.status)
    }
    expect(result.reason).toBe('unsupported harness class: long-lived-agent')

    coordinator.destroy()
  })

  it('rejects in-process requests after destroy', async () => {
    const fixture = readJson<LocalSubstrateFixture>('cases/startup-spawn-codex-tool-call.json')
    const coordinator = createInProcessLocalSubstrateCoordinator({
      creatorKey: fixtureSeed(0x11),
      logSubmission: 'disabled',
    })

    coordinator.destroy()
    const result = await tryLocalSubstrateCoordinator(fixture.input.coordinator_request, {
      transport: coordinator.transport,
    })

    expect(result.ok).toBe(false)
    expect(result.status).toBe('rejected')
    if (result.status !== 'rejected') {
      throw new Error(result.status)
    }
    expect(result.reason).toBe('coordinator destroyed')
  })

  it('builds and probes read-only health reports for rollout gating', () => {
    const report = buildLocalSubstrateHealthReport({
      coordinator: {
        pid: 101,
        version: '0.0.0-test',
        transport: 'unix:/tmp/atrib-substrate.sock',
        creatorKeyScope: 'single',
      },
      queues: { logSubmissionDepth: 2, archiveSubmissionDepth: 1 },
      wal: { pending: 3, joined: 10, orphanReceipts: 1 },
      activeContextIds: [
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      ],
      activeWrapperPids: [201, 202],
      staleChildPids: [301],
    })
    const probe = probeLocalSubstrateHealth({
      coordinator: {
        pid: 101,
        version: '0.0.0-test',
        transport: 'unix:/tmp/atrib-substrate.sock',
        creatorKeyScope: 'single',
      },
      queues: { logSubmissionDepth: 2, archiveSubmissionDepth: 1 },
      wal: { pending: 3, joined: 10, orphanReceipts: 1 },
      activeContextIds: report.contexts.active,
      activeWrappers: report.processes.active_wrappers,
      staleChildren: report.processes.stale_children,
    })

    expect(report.contexts.active).toEqual([
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    ])
    expect(report.processes.active_wrappers).toBe(2)
    expect(report.processes.stale_children).toBe(1)
    expect(validateLocalSubstrateHealthReport(report).ok).toBe(true)
    expect(probe.ok).toBe(false)
    expect(probe.status).toBe('degraded')
    expect(probe.warnings).toEqual(['stale child process count is 1', 'orphan receipt count is 1'])
  })
})
