// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  base64urlEncode,
  canonicalRecord,
  genesisChainRoot,
  getPublicKey,
  hexEncode,
  inheritChainContext,
  readMirrorTail,
  sha256,
  signRecord,
} from '../src/index.js'
import type { AtribRecord } from '../src/index.js'

const TEST_KEY = new Uint8Array(32).fill(17)
const CTX_A = 'a'.repeat(32)
const CTX_B = 'b'.repeat(32)

async function makeRecord(overrides: Partial<AtribRecord> = {}): Promise<AtribRecord> {
  const pubKey = await getPublicKey(TEST_KEY)
  const contextId = overrides.context_id ?? CTX_A
  const unsigned = {
    spec_version: 'atrib/1.0' as const,
    content_id: overrides.content_id ?? `sha256:${'c'.repeat(64)}`,
    creator_key: base64urlEncode(pubKey),
    chain_root: overrides.chain_root ?? genesisChainRoot(contextId),
    event_type: 'https://atrib.dev/v1/types/tool_call' as const,
    context_id: contextId,
    timestamp: overrides.timestamp ?? 1_700_000_000_000,
    signature: '',
  }
  return signRecord(unsigned as AtribRecord, TEST_KEY)
}

let tmpDir: string
let mirrorPath: string

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'atrib-mirror-test-'))
  mirrorPath = join(tmpDir, 'mirror.jsonl')
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

describe('readMirrorTail', () => {
  it('returns null when file does not exist', async () => {
    expect(await readMirrorTail({ path: join(tmpDir, 'missing.jsonl') })).toBeNull()
  })

  it('returns null when file is empty', async () => {
    await writeFile(mirrorPath, '')
    expect(await readMirrorTail({ path: mirrorPath })).toBeNull()
  })

  it('returns the most recent record from a bare-record-per-line mirror', async () => {
    const r1 = await makeRecord({ timestamp: 1, content_id: `sha256:${'1'.repeat(64)}` })
    const r2 = await makeRecord({ timestamp: 2, content_id: `sha256:${'2'.repeat(64)}` })
    await writeFile(mirrorPath, `${JSON.stringify(r1)}\n${JSON.stringify(r2)}\n`)

    const result = await readMirrorTail({ path: mirrorPath })
    expect(result?.content_id).toBe(r2.content_id)
  })

  it('returns the most recent record from an envelope-per-line mirror', async () => {
    const r1 = await makeRecord({ timestamp: 1, content_id: `sha256:${'1'.repeat(64)}` })
    const r2 = await makeRecord({ timestamp: 2, content_id: `sha256:${'2'.repeat(64)}` })
    await writeFile(
      mirrorPath,
      `${JSON.stringify({ record: r1, written_at: 'x' })}\n${JSON.stringify({ record: r2 })}\n`,
    )

    const result = await readMirrorTail({ path: mirrorPath })
    expect(result?.content_id).toBe(r2.content_id)
  })

  it('handles a mixed bare/envelope mirror (per producer file shape may vary)', async () => {
    const r1 = await makeRecord({ timestamp: 1, content_id: `sha256:${'1'.repeat(64)}` })
    const r2 = await makeRecord({ timestamp: 2, content_id: `sha256:${'2'.repeat(64)}` })
    await writeFile(
      mirrorPath,
      `${JSON.stringify(r1)}\n${JSON.stringify({ record: r2, _local: { extra: true } })}\n`,
    )

    const result = await readMirrorTail({ path: mirrorPath })
    expect(result?.content_id).toBe(r2.content_id)
  })

  it('skips malformed lines and blank lines without throwing', async () => {
    const r1 = await makeRecord({ timestamp: 1, content_id: `sha256:${'1'.repeat(64)}` })
    await writeFile(mirrorPath, `\n{not-json}\n${JSON.stringify(r1)}\n   \n`)

    const result = await readMirrorTail({ path: mirrorPath })
    expect(result?.content_id).toBe(r1.content_id)
  })

  it('filters by context_id when supplied; returns most recent matching record', async () => {
    const a1 = await makeRecord({
      context_id: CTX_A,
      content_id: `sha256:${'a'.repeat(64)}`,
    })
    const b1 = await makeRecord({
      context_id: CTX_B,
      content_id: `sha256:${'b'.repeat(64)}`,
    })
    const a2 = await makeRecord({
      context_id: CTX_A,
      content_id: `sha256:${'2'.repeat(64)}`,
    })
    const b2 = await makeRecord({
      context_id: CTX_B,
      content_id: `sha256:${'3'.repeat(64)}`,
    })
    await writeFile(
      mirrorPath,
      [a1, b1, a2, b2].map((r) => JSON.stringify(r)).join('\n') + '\n',
    )

    const onA = await readMirrorTail({ path: mirrorPath, contextId: CTX_A })
    expect(onA?.content_id).toBe(a2.content_id)

    const onB = await readMirrorTail({ path: mirrorPath, contextId: CTX_B })
    expect(onB?.content_id).toBe(b2.content_id)
  })

  it('returns null when contextId filter excludes every line', async () => {
    const r1 = await makeRecord({ context_id: CTX_A })
    await writeFile(mirrorPath, JSON.stringify(r1) + '\n')

    const result = await readMirrorTail({ path: mirrorPath, contextId: CTX_B })
    expect(result).toBeNull()
  })
})

describe('inheritChainContext', () => {
  const randomContextId = () => 'f'.repeat(32)

  it('uses caller-supplied context+chain verbatim', async () => {
    const result = await inheritChainContext({
      callerContextId: CTX_A,
      callerChainRoot: 'sha256:' + '1'.repeat(64),
      env: {},
      randomContextId,
    })
    expect(result).toEqual({
      contextId: CTX_A,
      chainRoot: 'sha256:' + '1'.repeat(64),
      inheritedFrom: 'caller-supplied',
    })
  })

  it('caller context only + env-tail set: chains to env-tail', async () => {
    const envHash = '7'.repeat(64)
    const result = await inheritChainContext({
      callerContextId: CTX_A,
      env: { [`ATRIB_CHAIN_TAIL_${CTX_A}`]: `sha256:${envHash}` },
      randomContextId,
    })
    expect(result.contextId).toBe(CTX_A)
    expect(result.chainRoot).toBe(`sha256:${envHash}`)
    expect(result.inheritedFrom).toBe('env-tail')
  })

  it('caller context only + mirror tail on same context: chains to mirror tail', async () => {
    const r1 = await makeRecord({ context_id: CTX_A })
    const r1Hex = hexEncode(sha256(canonicalRecord(r1)))
    await writeFile(mirrorPath, JSON.stringify(r1) + '\n')

    const result = await inheritChainContext({
      callerContextId: CTX_A,
      mirrorPath,
      env: {},
      randomContextId,
    })
    expect(result.contextId).toBe(CTX_A)
    expect(result.chainRoot).toBe(`sha256:${r1Hex}`)
    expect(result.inheritedFrom).toBe('mirror-tail')
  })

  it('caller context only + mirror tail on DIFFERENT context: falls through to genesis (no env)', async () => {
    const r1 = await makeRecord({ context_id: CTX_B })
    await writeFile(mirrorPath, JSON.stringify(r1) + '\n')

    const result = await inheritChainContext({
      callerContextId: CTX_A,
      mirrorPath,
      env: {},
      randomContextId,
    })
    expect(result.contextId).toBe(CTX_A)
    expect(result.chainRoot).toBe(genesisChainRoot(CTX_A))
    expect(result.inheritedFrom).toBe('fresh')
  })

  it('caller context only + env-tail + mirror tail: env wins', async () => {
    const r1 = await makeRecord({ context_id: CTX_A })
    await writeFile(mirrorPath, JSON.stringify(r1) + '\n')
    const envHash = '7'.repeat(64)

    const result = await inheritChainContext({
      callerContextId: CTX_A,
      mirrorPath,
      env: { [`ATRIB_CHAIN_TAIL_${CTX_A}`]: `sha256:${envHash}` },
      randomContextId,
    })
    expect(result.chainRoot).toBe(`sha256:${envHash}`)
    expect(result.inheritedFrom).toBe('env-tail')
  })

  it('no caller context + mirror tail present: inherits BOTH context and chain', async () => {
    const r1 = await makeRecord({ context_id: CTX_B })
    const r1Hex = hexEncode(sha256(canonicalRecord(r1)))
    await writeFile(mirrorPath, JSON.stringify(r1) + '\n')

    const result = await inheritChainContext({
      mirrorPath,
      env: {},
      randomContextId,
    })
    expect(result.contextId).toBe(CTX_B)
    expect(result.chainRoot).toBe(`sha256:${r1Hex}`)
    expect(result.inheritedFrom).toBe('mirror-context-and-tail')
  })

  it('no caller context + no mirror: random fresh context + genesis', async () => {
    const result = await inheritChainContext({
      env: {},
      randomContextId,
    })
    expect(result.contextId).toBe('f'.repeat(32))
    expect(result.chainRoot).toBe(genesisChainRoot('f'.repeat(32)))
    expect(result.inheritedFrom).toBe('fresh')
  })

  it('no caller context + missing mirror file: random fresh context + genesis', async () => {
    const result = await inheritChainContext({
      mirrorPath: join(tmpDir, 'does-not-exist.jsonl'),
      env: {},
      randomContextId,
    })
    expect(result.contextId).toBe('f'.repeat(32))
    expect(result.inheritedFrom).toBe('fresh')
  })
})
