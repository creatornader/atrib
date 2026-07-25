// SPDX-License-Identifier: Apache-2.0

import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer as createNodeServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import {
  base64urlEncode,
  canonicalRecord,
  createJsonCommitment,
  createToolNameCommitment,
  computeContentId,
  genesisChainRoot,
  getPublicKey,
  hexEncode,
  sha256,
  signRecord,
  type AtribRecord,
} from '@atrib/mcp'
import { OPERATING_EVENT_SCHEMA, type OperatingEvent } from '../src/model.js'
import { BUZZ_RUNTIME_OBSERVATION_SCHEMA } from '../src/observations.js'
import { startOperatingGraphServer } from '../src/server.js'

const tempDirectories: string[] = []

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

async function appendOperatingRecord(
  mirrorFile: string,
  character: string,
  event: OperatingEvent,
  timestamp: number,
  options: {
    readonly committed?: boolean
    readonly localContent?: Record<string, unknown>
    readonly committedContent?: Record<string, unknown>
    readonly informedBy?: readonly string[]
    readonly commitmentScheme?: 'plain-sha256' | 'salted-sha256'
    readonly argsSaltOverride?: unknown
  } = {},
): Promise<void> {
  const seed = new Uint8Array(32).fill(character.charCodeAt(0))
  const contextId = character.repeat(32)
  const content = options.localContent ?? event
  const contentCommitment = createJsonCommitment(
    options.committedContent ?? content,
    options.commitmentScheme ?? 'salted-sha256',
    () => new Uint8Array(16).fill(character.charCodeAt(0)),
  )
  const record = await signRecord(
    {
      spec_version: 'atrib/1.0',
      content_id: computeContentId('mcp://operating-test', event.kind),
      creator_key: base64urlEncode(await getPublicKey(seed)),
      chain_root: genesisChainRoot(contextId),
      event_type: 'https://atrib.dev/v1/types/observation',
      context_id: contextId,
      timestamp,
      ...(options.informedBy && options.informedBy.length > 0
        ? { informed_by: [...options.informedBy] }
        : {}),
      ...(options.committed === false
        ? {}
        : {
            args_hash: contentCommitment.hash,
            ...('argsSaltOverride' in options
              ? { args_salt: options.argsSaltOverride }
              : 'salt' in contentCommitment
                ? { args_salt: contentCommitment.salt }
                : {}),
          }),
      signature: '',
    } as AtribRecord,
    seed,
  )
  appendFileSync(
    mirrorFile,
    `${JSON.stringify({
      record,
      proof: null,
      written_at: timestamp,
      _local: { content, producer: 'operating-test' },
    })}\n`,
  )
}

async function appendActionRecord(
  mirrorFile: string,
  character: string,
): Promise<{
  recordHash: string
  record: AtribRecord
  args: Record<string, unknown>
  result: Record<string, unknown>
}> {
  const seed = new Uint8Array(32).fill(character.charCodeAt(0))
  const contextId = character.repeat(32)
  const args = { issue: 42, private_note: 'local only' }
  const result = { status: 'updated' }
  const argsCommitment = createJsonCommitment(args, 'salted-sha256', () =>
    new Uint8Array(16).fill(3),
  )
  const resultCommitment = createJsonCommitment(result, 'salted-sha256', () =>
    new Uint8Array(16).fill(4),
  )
  const record = await signRecord(
    {
      spec_version: 'atrib/1.0',
      content_id: computeContentId('mcp://operating-test', 'update_issue'),
      creator_key: base64urlEncode(await getPublicKey(seed)),
      chain_root: genesisChainRoot(contextId),
      event_type: 'https://atrib.dev/v1/types/tool_call',
      context_id: contextId,
      timestamp: 300,
      tool_name: createToolNameCommitment('update_issue'),
      args_hash: argsCommitment.hash,
      args_salt: argsCommitment.salt,
      result_hash: resultCommitment.hash,
      result_salt: resultCommitment.salt,
      signature: '',
    } as AtribRecord,
    seed,
  )
  const recordHash = `sha256:${hexEncode(sha256(canonicalRecord(record)))}`
  appendFileSync(
    mirrorFile,
    `${JSON.stringify({
      record,
      proof: null,
      written_at: 300,
      _local: { toolName: 'update_issue', args, result, producer: 'operating-test' },
    })}\n`,
  )
  return { recordHash, record, args, result }
}

async function appendSignedContentRecord(
  mirrorFile: string,
  character: string,
  content: Record<string, unknown>,
  timestamp: number,
  informedBy: readonly string[] = [],
): Promise<string> {
  const seed = new Uint8Array(32).fill(character.charCodeAt(0))
  const contextId = character.repeat(32)
  const contentCommitment = createJsonCommitment(content, 'salted-sha256', () =>
    new Uint8Array(16).fill(character.charCodeAt(0)),
  )
  const record = await signRecord(
    {
      spec_version: 'atrib/1.0',
      content_id: computeContentId('mcp://operating-test', 'signed-content'),
      creator_key: base64urlEncode(await getPublicKey(seed)),
      chain_root: genesisChainRoot(contextId),
      event_type: 'https://atrib.dev/v1/types/observation',
      context_id: contextId,
      timestamp,
      args_hash: contentCommitment.hash,
      args_salt: contentCommitment.salt,
      ...(informedBy.length > 0 ? { informed_by: [...informedBy] } : {}),
      signature: '',
    } as AtribRecord,
    seed,
  )
  const recordHash = `sha256:${hexEncode(sha256(canonicalRecord(record)))}`
  appendFileSync(
    mirrorFile,
    `${JSON.stringify({
      record,
      proof: null,
      written_at: timestamp,
      _local: { content, producer: 'operating-test' },
    })}\n`,
  )
  return recordHash
}

function sha256Uri(character: string): string {
  return `sha256:${character.repeat(64)}`
}

async function creatorKey(character: string): Promise<string> {
  const seed = new Uint8Array(32).fill(character.charCodeAt(0))
  return base64urlEncode(await getPublicKey(seed))
}

function buzzObservationContent(options: {
  readonly workspace: { id: string; name: string }
  readonly task?: { id: string; name: string }
  readonly team?: { id: string; name: string }
  readonly agent?: { id: string; name: string; role: string }
  readonly incomplete?: boolean
}): Record<string, unknown> {
  const incomplete = options.incomplete ?? false
  return {
    schema: BUZZ_RUNTIME_OBSERVATION_SCHEMA,
    kind: 'runtime_observation',
    workspace: options.workspace,
    ...(options.task ? { task: options.task } : {}),
    ...(options.team ? { team: options.team } : {}),
    ...(options.agent ? { mapped_agent: options.agent } : {}),
    source: {
      id: 'buzz-observer-frames',
      kind: 'buzz-nip-ao-capture',
      version: 'v1',
      capture_id: 'buzz-observer-process-1',
      owner_pubkey: 'a'.repeat(64),
      observed_agent_pubkeys: ['b'.repeat(64)],
      capture_kind: 'live-subscription',
    },
    runtime_window: {
      runtime_window_hash: sha256Uri('b'),
      session_id: 'buzz-observer-process-1',
      session_definition_digest: sha256Uri('c'),
      start: 1,
      end: 3,
      event_count: incomplete ? 2 : 3,
      event_root: sha256Uri('d'),
      projection_root: sha256Uri('e'),
      sequence_audit_root: sha256Uri('f'),
    },
    coverage: {
      bounded_to_capture: true,
      sequence_complete: !incomplete,
      basis: incomplete ? 'incomplete-captured-window' : 'complete-captured-window',
      missing_ranges: incomplete ? [{ start: 2, end: 2 }] : [],
      duplicate_seq: [],
      duplicate_event_ids: [],
      out_of_order_count: 0,
    },
    trust: {
      nostr_event_signatures: 'verified-by-observer-adapter',
      recipient_owner_binding: 'verified-by-observer-adapter',
      owner_authorization: 'not-asserted',
      relay_admission: 'not-claimed',
      relay_persistence: 'not-claimed',
      audit_inclusion: 'not-claimed',
      runtime_execution: 'observer-telemetry-only',
      result_truth: 'not-claimed',
      capture_completeness: 'captured-window-only',
      source_artifact_replay: 'not-performed-by-reader',
    },
    execution_evidence: false,
    semantic_effects: {
      accepted_state: false,
      decision: false,
      outcome: false,
      handoff: false,
      resolution: false,
    },
    raw_payloads: 'omitted',
  }
}

describe('operating graph HTTP contract', () => {
  it('requires a bearer secret whenever signed writes are enabled', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'atrib-operating-auth-'))
    tempDirectories.push(directory)
    const mirrorFile = join(directory, 'records.jsonl')
    appendFileSync(mirrorFile, '')

    await expect(
      startOperatingGraphServer({
        mirrorPath: mirrorFile,
        host: '127.0.0.1',
        port: 0,
        writesEnabled: true,
        pollMs: 50,
      }),
    ).rejects.toThrow('ATRIB_OPERATING_WRITE_TOKEN is required')

    const server = await startOperatingGraphServer({
      mirrorPath: mirrorFile,
      host: '127.0.0.1',
      port: 0,
      writesEnabled: true,
      writeToken: 'test-write-token',
      pollMs: 50,
    })
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    try {
      const missing = await fetch(`${base}/v1/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      expect(missing.status).toBe(401)
      expect(missing.headers.get('www-authenticate')).toContain('Bearer')

      const wrong = await fetch(`${base}/v1/resolve`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer wrong-token',
          'Content-Type': 'application/json',
        },
        body: '{}',
      })
      expect(wrong.status).toBe(401)

      const authorized = await fetch(`${base}/v1/events`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test-write-token',
          'Content-Type': 'application/json',
        },
        body: '{}',
      })
      expect(authorized.status).toBe(400)
      expect(await authorized.json()).toEqual({ error: 'invalid request' })
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('rejects uncommitted and tampered local content before semantic projection', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'atrib-operating-integrity-'))
    tempDirectories.push(directory)
    const mirrorFile = join(directory, 'records.jsonl')
    const workspace = { id: 'workspace-integrity', name: 'Integrity' }
    const task = { id: 'task-integrity', name: 'Protect projection' }
    const alice = { id: 'agent-alice', name: 'Alice', role: 'builder' }
    const bob = { id: 'agent-bob', name: 'Bob', role: 'reviewer' }
    const valid: OperatingEvent = {
      schema: OPERATING_EVENT_SCHEMA,
      kind: 'decision',
      workspace,
      task,
      agent: alice,
      subject: 'committed decision',
      value: 'accepted',
    }
    const omitted: OperatingEvent = {
      ...valid,
      subject: 'missing args hash',
    }
    const invalidEmptySalt: OperatingEvent = {
      ...valid,
      subject: 'empty salt must not become plain',
    }
    const signedHandoff: OperatingEvent = {
      schema: OPERATING_EVENT_SCHEMA,
      kind: 'handoff',
      workspace,
      task,
      agent: alice,
      from_agent: alice,
      to_agent: bob,
      subject: 'review handoff',
    }
    const tamperedHandoff: OperatingEvent = {
      ...signedHandoff,
      subject: 'tampered handoff',
    }

    await appendOperatingRecord(mirrorFile, 'a', valid, 100)
    await appendOperatingRecord(mirrorFile, 'b', omitted, 101, { committed: false })
    await appendOperatingRecord(mirrorFile, 'd', invalidEmptySalt, 101, {
      commitmentScheme: 'plain-sha256',
      argsSaltOverride: '',
    })
    await appendOperatingRecord(mirrorFile, 'c', signedHandoff, 102, {
      committedContent: signedHandoff,
      localContent: tamperedHandoff,
    })
    appendFileSync(
      mirrorFile,
      `${JSON.stringify({
        record: { args_hash: 'sha256:not-a-digest', args_salt: 123 },
        _local: { content: valid, producer: 'malformed-commitment' },
      })}\n`,
    )

    const server = await startOperatingGraphServer({
      mirrorPath: mirrorFile,
      host: '127.0.0.1',
      port: 0,
      writesEnabled: false,
      pollMs: 50,
    })
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    try {
      const response = await fetch(`${base}/v1/view?workspace_id=${workspace.id}`)
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.view.counts).toMatchObject({ records_considered: 1, cells_total: 1, handoffs: 0 })
      expect(body.view.activity).toHaveLength(1)
      expect(body.view.activity[0].event.subject).toBe('committed decision')
      expect(body.view.handoffs).toEqual([])
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('keeps Buzz telemetry observational until a compatible signed promotion joins it', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'atrib-operating-buzz-'))
    tempDirectories.push(directory)
    const mirrorFile = join(directory, 'records.jsonl')
    const workspace = { id: 'workspace-buzz', name: 'Buzz' }
    const task = { id: 'task-buzz', name: 'Review capture' }
    const team = { id: 'team-buzz', name: 'Runtime' }
    const agent = { id: 'agent-buzz', name: 'Buzz agent', role: 'observer subject' }
    const observation = buzzObservationContent({ workspace, task, team, agent, incomplete: true })
    const observationHash = await appendSignedContentRecord(mirrorFile, 'd', observation, 200)
    const observationOnlyWorkspace = {
      id: 'workspace-observation-only',
      name: 'Observation only',
    }
    await appendSignedContentRecord(
      mirrorFile,
      '4',
      buzzObservationContent({ workspace: observationOnlyWorkspace }),
      206,
    )

    await appendSignedContentRecord(
      mirrorFile,
      'e',
      {
        ...observation,
        trust: {
          ...(observation['trust'] as Record<string, unknown>),
          owner_authorization: 'verified',
        },
      },
      201,
    )
    await appendSignedContentRecord(mirrorFile, 'f', { ...observation, result: 'approved' }, 202)

    const promotion: OperatingEvent = {
      schema: OPERATING_EVENT_SCHEMA,
      kind: 'accepted_state',
      workspace,
      task,
      team,
      agent,
      subject: 'deployment',
      value: 'approved by application policy',
      source_observation: observationHash,
    }
    await appendOperatingRecord(mirrorFile, '1', promotion, 203)
    await appendOperatingRecord(
      mirrorFile,
      '2',
      { ...promotion, team: { id: 'team-other', name: 'Other team' } },
      204,
      {
        committedContent: { ...promotion, team: { id: 'team-other', name: 'Other team' } },
        informedBy: [observationHash],
      },
    )
    await appendOperatingRecord(mirrorFile, '3', promotion, 205, {
      informedBy: [observationHash],
    })

    const server = await startOperatingGraphServer({
      mirrorPath: mirrorFile,
      host: '127.0.0.1',
      port: 0,
      writesEnabled: false,
      pollMs: 50,
    })
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    try {
      const workspaces = await fetch(`${base}/v1/workspaces`).then((response) => response.json())
      expect(workspaces.workspaces).toEqual(
        expect.arrayContaining([workspace, observationOnlyWorkspace]),
      )
      const observations = await fetch(
        `${base}/v1/runtime-observations?workspace_id=${workspace.id}&limit=999`,
      ).then((response) => response.json())
      expect(observations.observations).toHaveLength(1)
      expect(observations.observations[0]).toMatchObject({
        record_hash: observationHash,
        observation: {
          execution_evidence: false,
          coverage: { sequence_complete: false, missing_ranges: [{ start: 2, end: 2 }] },
          trust: {
            recipient_owner_binding: 'verified-by-observer-adapter',
            owner_authorization: 'not-asserted',
            result_truth: 'not-claimed',
          },
          semantic_effects: {
            accepted_state: false,
            decision: false,
            outcome: false,
            handoff: false,
            resolution: false,
          },
        },
      })

      const view = await fetch(`${base}/v1/view?workspace_id=${workspace.id}`).then((response) =>
        response.json(),
      )
      expect(view.view.counts).toMatchObject({ records_considered: 1, cells_total: 1 })
      expect(view.view.activity).toHaveLength(1)
      expect(view.view.activity[0].event).toMatchObject({
        kind: 'accepted_state',
        source_observation: observationHash,
      })
      expect(view.view.handoffs).toEqual([])
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('applies the creator allowlist to workspace names and observation feeds', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'atrib-operating-trust-'))
    tempDirectories.push(directory)
    const mirrorFile = join(directory, 'records.jsonl')
    const workspace = { id: 'workspace-trusted', name: 'Trusted name' }
    const spoofedWorkspace = { id: workspace.id, name: 'Spoofed name' }
    const untrustedOnlyWorkspace = { id: 'workspace-untrusted', name: 'Untrusted only' }
    await appendSignedContentRecord(mirrorFile, 'a', buzzObservationContent({ workspace }), 210)
    await appendSignedContentRecord(
      mirrorFile,
      'b',
      buzzObservationContent({ workspace: spoofedWorkspace }),
      211,
    )
    await appendSignedContentRecord(
      mirrorFile,
      'b',
      buzzObservationContent({ workspace: untrustedOnlyWorkspace }),
      212,
    )

    const server = await startOperatingGraphServer({
      mirrorPath: mirrorFile,
      host: '127.0.0.1',
      port: 0,
      writesEnabled: false,
      trustedCreatorKeys: [await creatorKey('a')],
      pollMs: 50,
    })
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    try {
      const workspaces = await fetch(`${base}/v1/workspaces`).then((response) => response.json())
      expect(workspaces.workspaces).toEqual([workspace])

      const trusted = await fetch(
        `${base}/v1/runtime-observations?workspace_id=${workspace.id}`,
      ).then((response) => response.json())
      expect(trusted.observations).toHaveLength(1)
      expect(trusted.observations[0].observation.workspace).toEqual(workspace)

      const untrusted = await fetch(
        `${base}/v1/runtime-observations?workspace_id=${untrustedOnlyWorkspace.id}`,
      ).then((response) => response.json())
      expect(untrusted.observations).toEqual([])
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('serves bounded views, body search, reconnect refusal, and live change events', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'atrib-operating-'))
    tempDirectories.push(directory)
    const mirrorFile = join(directory, 'records.jsonl')
    const workspace = { id: 'workspace-1', name: 'Apollo' }
    const task = { id: 'task-1', name: 'Ship' }
    const agent = { id: 'agent-1', name: 'Alice', role: 'builder' }
    await appendOperatingRecord(
      mirrorFile,
      'a',
      {
        schema: OPERATING_EVENT_SCHEMA,
        kind: 'decision',
        workspace,
        task,
        agent,
        subject: 'database',
        value: { selected: 'sqlite', reason: 'single-node' },
      },
      200,
    )
    const server = await startOperatingGraphServer({
      mirrorPath: mirrorFile,
      host: '127.0.0.1',
      port: 0,
      writesEnabled: false,
      pollMs: 50,
    })
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

    try {
      const workspaces = await fetch(`${base}/v1/workspaces`).then((response) => response.json())
      expect(workspaces).toMatchObject({
        revision: 1,
        workspaces: [{ id: workspace.id, name: workspace.name }],
      })

      const view = await fetch(`${base}/v1/view?workspace_id=${workspace.id}`).then((response) =>
        response.json(),
      )
      expect(view.view).toMatchObject({
        scope: { workspace_id: workspace.id },
        identities: [agent],
        counts: { records_considered: 1, cells_total: 1 },
      })

      const search = await fetch(
        `${base}/v1/search?workspace_id=${workspace.id}&q=single-node`,
      ).then((response) => response.json())
      expect(search.results).toHaveLength(1)
      expect(search.results[0].event.subject).toBe('database')

      const ahead = await fetch(`${base}/v1/stream?after=9`)
      expect(ahead.status).toBe(409)

      const controller = new AbortController()
      const stream = await fetch(`${base}/v1/stream?after=1`, {
        signal: controller.signal,
      })
      expect(stream.status).toBe(200)
      const reader = stream.body!.getReader()
      const decoder = new TextDecoder()
      let received = decoder.decode((await reader.read()).value)
      expect(received).toContain('event: ready')

      await appendOperatingRecord(
        mirrorFile,
        'b',
        {
          schema: OPERATING_EVENT_SCHEMA,
          kind: 'outcome',
          workspace,
          task,
          agent,
          subject: 'deploy',
          value: 'healthy',
        },
        100,
      )
      const deadline = Date.now() + 3_000
      while (!received.includes('event: changed') && Date.now() < deadline) {
        const next = await reader.read()
        received += decoder.decode(next.value)
      }
      controller.abort()
      expect(received).toContain('event: changed')
      expect(received).toContain('id: 2')

      const gapController = new AbortController()
      const gapStream = await fetch(`${base}/v1/stream?after=0`, {
        signal: gapController.signal,
      })
      const gapReader = gapStream.body!.getReader()
      const gapPayload = decoder.decode((await gapReader.read()).value)
      gapController.abort()
      expect(gapPayload).toContain('event: gap')
      expect(gapPayload).toContain('"after_revision":0')
      expect(gapPayload).toContain('"current_revision":2')

      const updated = await fetch(`${base}/v1/view?workspace_id=${workspace.id}`).then((response) =>
        response.json(),
      )
      expect(updated.revision).toBeGreaterThan(1)
      expect(
        updated.view.activity.map((entry: { event: { subject: string } }) => entry.event.subject),
      ).toEqual(['database', 'deploy'])

      const disabledWrite = await fetch(`${base}/v1/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      expect(disabledWrite.status).toBe(403)
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }, 10_000)

  it('keeps body openings authorization-protected and verifies disclosed values', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'atrib-operating-body-'))
    tempDirectories.push(directory)
    const mirrorFile = join(directory, 'records.jsonl')
    const { recordHash, args, result } = await appendActionRecord(mirrorFile, 'c')
    const server = await startOperatingGraphServer({
      mirrorPath: mirrorFile,
      host: '127.0.0.1',
      port: 0,
      writesEnabled: false,
      bodyReadToken: 'read-secret',
      pollMs: 50,
    })
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    const hashHex = recordHash.slice('sha256:'.length)

    try {
      const unauthenticated = await fetch(`${base}/v1/body/${hashHex}`)
      expect(unauthenticated.status).toBe(401)

      const authorized = await fetch(`${base}/v1/body/${hashHex}`, {
        headers: { Authorization: 'Bearer read-secret' },
      })
      expect(authorized.status).toBe(200)
      const body = await authorized.json()
      expect(body).toMatchObject({
        schema: 'atrib.body-opening.v1',
        source: 'local-mirror',
        integrity: { record_hash_verified: true, signature_verified: true },
        openings: {
          tool_name: { present: true, verified: true, value: 'update_issue' },
          args: { present: true, verified: true, value: args },
          result: { present: true, verified: true, value: result },
        },
      })
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  const credentialedArchive = new URL('https://archive.example/v1')
  credentialedArchive.username = 'operator'

  it.each([
    ['ftp://archive.example/v1', 'HTTP or HTTPS'],
    ['http://169.254.169.254/v1', 'loopback hosts'],
    [credentialedArchive.toString(), 'must not contain credentials'],
    ['https://archive.example/v1?tenant=one', 'must not contain credentials'],
  ])('rejects unsafe archive configuration %s', async (archiveUrl, message) => {
    await expect(
      startOperatingGraphServer({
        mirrorPath: '/unused',
        host: '127.0.0.1',
        port: 0,
        writesEnabled: false,
        archiveUrl,
        pollMs: 50,
      }),
    ).rejects.toThrow(message)
  })

  it('falls back to an archive and re-verifies the returned signed body', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'atrib-operating-archive-'))
    tempDirectories.push(directory)
    const sourceMirror = join(directory, 'source.jsonl')
    const emptyMirror = join(directory, 'empty.jsonl')
    const { recordHash, record } = await appendActionRecord(sourceMirror, 'd')
    writeFileSync(emptyMirror, '')

    const archive = createNodeServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(
        JSON.stringify({
          record_hash: recordHash,
          record,
          log_proofs: [],
          archived_at_ms: 100,
          retention_window_ms: 1_000,
        }),
      )
    })
    await new Promise<void>((resolve) => archive.listen(0, '127.0.0.1', resolve))
    const archiveBase = `http://127.0.0.1:${(archive.address() as AddressInfo).port}/v1`
    const server = await startOperatingGraphServer({
      mirrorPath: emptyMirror,
      host: '127.0.0.1',
      port: 0,
      writesEnabled: false,
      bodyReadToken: 'read-secret',
      archiveUrl: archiveBase,
      pollMs: 50,
    })
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

    try {
      const response = await fetch(`${base}/v1/body/${recordHash.slice('sha256:'.length)}`, {
        headers: { Authorization: 'Bearer read-secret' },
      })
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({
        source: 'archive',
        record_hash: recordHash,
        integrity: { record_hash_verified: true, signature_verified: true },
        archive: { archived_at_ms: 100, retention_window_ms: 1_000 },
        openings: {
          content: { present: false, verified: null },
          args: { present: false, verified: null },
          result: { present: false, verified: null },
        },
      })
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await new Promise<void>((resolve) => archive.close(() => resolve()))
    }
  })
})
