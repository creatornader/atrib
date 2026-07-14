// SPDX-License-Identifier: Apache-2.0

// Reference tests for the write-side families of
// spec/conformance/attest-recall/: byte-identity, ref-mapping, and
// frozen-constants. Read-side families are consumed by
// services/atrib-recall/test/conformance-read-equivalence.test.ts;
// alias-window by the atribd and mcp-wrap suites.

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  canonicalRecord,
  computeContentId,
  hexEncode,
  sha256,
  verifyRecord,
  EVENT_TYPE_ANNOTATION_URI,
  EVENT_TYPE_DIRECTORY_ANCHOR_URI,
  EVENT_TYPE_OBSERVATION_URI,
  EVENT_TYPE_REVISION_URI,
  EVENT_TYPE_TOOL_CALL_URI,
  EVENT_TYPE_TRANSACTION_URI,
  type AtribRecord,
} from '@atrib/mcp'
import { createAtribAttestServer } from '../src/index.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const CORPUS = resolve(HERE, '..', '..', '..', 'spec', 'conformance', 'attest-recall', 'cases')

function loadCase<T>(...segments: string[]): T {
  return JSON.parse(readFileSync(join(CORPUS, ...segments), 'utf8')) as T
}

interface ByteIdentityCase {
  input: {
    legacy: { tool: string; arguments: Record<string, unknown> }
    attest: { tool: string; arguments: Record<string, unknown> }
    private_key_seed_base64url: string
    timestamp_ms: number
  }
  expected: {
    event_type: string
    record: AtribRecord
    record_hash: string
    canonical_record_sha256: string
    legacy_producer_label: string
    attest_producer_label: string
  }
}

const BYTE_IDENTITY_CASES = [
  'observation-identity',
  'annotation-identity',
  'revision-identity',
] as const

interface SignedSurface {
  record: AtribRecord
  record_hash: string
  producer: string | undefined
  payload: Record<string, unknown>
}

async function signThroughUnionServer(
  tool: string,
  args: Record<string, unknown>,
): Promise<SignedSurface> {
  const caseTmp = mkdtempSync(join(tmpdir(), 'attest-recall-conf-'))
  const mirror = join(caseTmp, 'mirror.jsonl')
  const priorMirror = process.env['ATRIB_MIRROR_FILE']
  process.env['ATRIB_MIRROR_FILE'] = mirror
  try {
    const handle = await createAtribAttestServer()
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await handle.mcp.connect(serverTransport)
    const client = new Client({ name: 'attest-recall-conformance', version: '0.0.0' })
    await client.connect(clientTransport)
    const result = (await client.callTool({ name: tool, arguments: args })) as {
      content: Array<{ type: string; text: string }>
    }
    // No queue flush: the log endpoint is deliberately unreachable and the
    // mirror write is awaited inside handleEmit before the tool returns.
    await client.close()
    await handle.mcp.close()
    const payload = JSON.parse(result.content[0]!.text) as Record<string, unknown>
    const lines = readFileSync(mirror, 'utf8').trim().split('\n')
    expect(lines).toHaveLength(1)
    const envelope = JSON.parse(lines[0]!) as {
      record: AtribRecord
      _local?: { producer?: string }
    }
    return {
      record: envelope.record,
      record_hash: payload['record_hash'] as string,
      producer: envelope._local?.producer,
      payload,
    }
  } finally {
    if (priorMirror === undefined) delete process.env['ATRIB_MIRROR_FILE']
    else process.env['ATRIB_MIRROR_FILE'] = priorMirror
    rmSync(caseTmp, { recursive: true, force: true })
  }
}

describe('attest-recall corpus: byte-identity', () => {
  let priorKey: string | undefined
  let priorLog: string | undefined

  beforeEach(() => {
    priorKey = process.env['ATRIB_PRIVATE_KEY']
    priorLog = process.env['ATRIB_LOG_ENDPOINT']
    process.env['ATRIB_LOG_ENDPOINT'] = 'http://127.0.0.1:0/v1/entries'
  })

  afterEach(() => {
    if (priorKey === undefined) delete process.env['ATRIB_PRIVATE_KEY']
    else process.env['ATRIB_PRIVATE_KEY'] = priorKey
    if (priorLog === undefined) delete process.env['ATRIB_LOG_ENDPOINT']
    else process.env['ATRIB_LOG_ENDPOINT'] = priorLog
    vi.restoreAllMocks()
  })

  for (const name of BYTE_IDENTITY_CASES) {
    it(name, { timeout: 20_000 }, async () => {
      const fixture = loadCase<ByteIdentityCase>('byte-identity', `${name}.json`)
      process.env['ATRIB_PRIVATE_KEY'] = fixture.input.private_key_seed_base64url
      vi.spyOn(Date, 'now').mockReturnValue(fixture.input.timestamp_ms)

      const legacy = await signThroughUnionServer(
        fixture.input.legacy.tool,
        fixture.input.legacy.arguments,
      )
      const attest = await signThroughUnionServer(
        fixture.input.attest.tool,
        fixture.input.attest.arguments,
      )

      // Old-name and new-name calls with equivalent args MUST produce
      // identical canonical signed bytes given identical key, timestamp,
      // and chain inputs (W1).
      const legacyCanonical = canonicalRecord(legacy.record)
      const attestCanonical = canonicalRecord(attest.record)
      expect(Buffer.from(attestCanonical).equals(Buffer.from(legacyCanonical))).toBe(true)

      // Both match the pinned fixture record byte-for-byte.
      const pinnedCanonical = canonicalRecord(fixture.expected.record)
      expect(Buffer.from(legacyCanonical).equals(Buffer.from(pinnedCanonical))).toBe(true)
      expect(hexEncode(sha256(legacyCanonical))).toBe(fixture.expected.canonical_record_sha256)
      expect(legacy.record_hash).toBe(fixture.expected.record_hash)
      expect(attest.record_hash).toBe(fixture.expected.record_hash)

      // Only the sidecar producer label differs (persisted-label rule L1).
      expect(legacy.producer).toBe(fixture.expected.legacy_producer_label)
      expect(attest.producer).toBe(fixture.expected.attest_producer_label)

      // The attest result carries the mapped event_type.
      expect(attest.payload['event_type']).toBe(fixture.expected.event_type)
    })
  }

  it('historical-pre-rename-record verifies unchanged', async () => {
    const fixture = loadCase<{
      input: { record: AtribRecord }
      expected: { record_hash: string; signature_valid: boolean }
    }>('byte-identity', 'historical-pre-rename-record.json')
    const verified = await verifyRecord(fixture.input.record)
    expect(verified).toBe(fixture.expected.signature_valid)
    const hash = `sha256:${hexEncode(sha256(canonicalRecord(fixture.input.record)))}`
    expect(hash).toBe(fixture.expected.record_hash)
  })
})

describe('attest-recall corpus: ref-mapping', () => {
  interface RefMappingCase {
    name: string
    arguments: Record<string, unknown>
    expected: { outcome: 'error' | 'signed'; message_contains?: string; event_type?: string }
  }
  const family = loadCase<{ cases: RefMappingCase[] }>('ref-mapping', 'ref-mapping.json')

  let priorKey: string | undefined
  let priorLog: string | undefined
  beforeEach(() => {
    priorKey = process.env['ATRIB_PRIVATE_KEY']
    priorLog = process.env['ATRIB_LOG_ENDPOINT']
    process.env['ATRIB_PRIVATE_KEY'] = Buffer.from(new Uint8Array(32).fill(42)).toString(
      'base64url',
    )
    process.env['ATRIB_LOG_ENDPOINT'] = 'http://127.0.0.1:0/v1/entries'
  })
  afterEach(() => {
    if (priorKey === undefined) delete process.env['ATRIB_PRIVATE_KEY']
    else process.env['ATRIB_PRIVATE_KEY'] = priorKey
    if (priorLog === undefined) delete process.env['ATRIB_LOG_ENDPOINT']
    else process.env['ATRIB_LOG_ENDPOINT'] = priorLog
  })

  for (const testCase of family.cases) {
    it(testCase.name, { timeout: 20_000 }, async () => {
      const caseTmp = mkdtempSync(join(tmpdir(), 'attest-refmap-'))
      const priorMirror = process.env['ATRIB_MIRROR_FILE']
      process.env['ATRIB_MIRROR_FILE'] = join(caseTmp, 'mirror.jsonl')
      try {
        const handle = await createAtribAttestServer()
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
        await handle.mcp.connect(serverTransport)
        const client = new Client({ name: 'ref-mapping-conformance', version: '0.0.0' })
        await client.connect(clientTransport)
        const result = (await client.callTool({
          name: 'attest',
          arguments: testCase.arguments,
        })) as { isError?: boolean; content: Array<{ type: string; text: string }> }
        await client.close()
        await handle.mcp.close()

        if (testCase.expected.outcome === 'error') {
          expect(result.isError).toBe(true)
          if (testCase.expected.message_contains) {
            expect(result.content[0]!.text).toContain(testCase.expected.message_contains)
          }
        } else {
          expect(result.isError).not.toBe(true)
          const payload = JSON.parse(result.content[0]!.text) as Record<string, unknown>
          expect(payload['signed']).toBe(true)
          if (testCase.expected.event_type) {
            expect(payload['event_type']).toBe(testCase.expected.event_type)
          }
        }
      } finally {
        if (priorMirror === undefined) delete process.env['ATRIB_MIRROR_FILE']
        else process.env['ATRIB_MIRROR_FILE'] = priorMirror
        rmSync(caseTmp, { recursive: true, force: true })
      }
    })
  }
})

describe('attest-recall corpus: frozen-constants', () => {
  interface FrozenConstants {
    expected: {
      synthetic_server_url: string
      event_types: Record<string, { uri: string; byte: string }>
      content_ids: Record<string, string>
    }
  }
  const fixture = loadCase<FrozenConstants>('frozen-constants', 'frozen-constants.json')

  it('pins the synthetic server URL and derived content_ids', () => {
    const url = fixture.expected.synthetic_server_url
    expect(url).toBe('mcp://atrib-emit')
    for (const [kind, contentId] of Object.entries(fixture.expected.content_ids)) {
      expect(computeContentId(url, kind)).toBe(contentId)
    }
  })

  it('pins the six normative event-type URIs', () => {
    expect(fixture.expected.event_types['tool_call']!.uri).toBe(EVENT_TYPE_TOOL_CALL_URI)
    expect(fixture.expected.event_types['transaction']!.uri).toBe(EVENT_TYPE_TRANSACTION_URI)
    expect(fixture.expected.event_types['observation']!.uri).toBe(EVENT_TYPE_OBSERVATION_URI)
    expect(fixture.expected.event_types['directory_anchor']!.uri).toBe(
      EVENT_TYPE_DIRECTORY_ANCHOR_URI,
    )
    expect(fixture.expected.event_types['annotation']!.uri).toBe(EVENT_TYPE_ANNOTATION_URI)
    expect(fixture.expected.event_types['revision']!.uri).toBe(EVENT_TYPE_REVISION_URI)
  })
})
