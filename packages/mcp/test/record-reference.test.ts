import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  base64urlEncode,
  canonicalRecord,
  clearRecordReferenceResolverCacheForTests,
  defaultRecordReferenceResolver,
  genesisChainRoot,
  getPublicKey,
  hexEncode,
  sha256,
  signRecord,
} from '../src/index.js'
import type { AtribRecord } from '../src/index.js'

const TEST_KEY = new Uint8Array(32).fill(23)
const CTX = 'c'.repeat(32)

let tmpDir: string
let priorRecordsDir: string | undefined

async function makeRecord(): Promise<{ record: AtribRecord; recordHash: string }> {
  const pubKey = await getPublicKey(TEST_KEY)
  const unsigned = {
    spec_version: 'atrib/1.0' as const,
    content_id: `sha256:${'d'.repeat(64)}`,
    creator_key: base64urlEncode(pubKey),
    chain_root: genesisChainRoot(CTX),
    event_type: 'https://atrib.dev/v1/types/tool_call',
    context_id: CTX,
    timestamp: 1_700_000_000_000,
    signature: '',
  }
  const record = await signRecord(unsigned as AtribRecord, TEST_KEY)
  return {
    record,
    recordHash: `sha256:${hexEncode(sha256(canonicalRecord(record)))}`,
  }
}

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'atrib-record-ref-test-'))
  priorRecordsDir = process.env['ATRIB_RECORDS_DIR']
  process.env['ATRIB_RECORDS_DIR'] = tmpDir
  clearRecordReferenceResolverCacheForTests()
})

afterEach(async () => {
  if (priorRecordsDir === undefined) delete process.env['ATRIB_RECORDS_DIR']
  else process.env['ATRIB_RECORDS_DIR'] = priorRecordsDir
  clearRecordReferenceResolverCacheForTests()
  await rm(tmpDir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('defaultRecordReferenceResolver', () => {
  it('finds records in local mirrors before consulting the log', async () => {
    const { record, recordHash } = await makeRecord()
    await writeFile(join(tmpDir, 'producer.jsonl'), `${JSON.stringify({ record })}\n`)
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    await expect(defaultRecordReferenceResolver(recordHash)).resolves.toBe('found')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('returns not-found when local mirrors and log lookup miss', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 404 } as Response)

    await expect(defaultRecordReferenceResolver(`sha256:${'f'.repeat(64)}`)).resolves.toBe(
      'not-found',
    )
  })
})
