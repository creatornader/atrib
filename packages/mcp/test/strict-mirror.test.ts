// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStrictMirrorRetention, readStrictMirror } from '../src/mirror.js'
import * as signing from '../src/signing.js'
import {
  base64urlEncode,
  getPublicKey,
  signRecord,
  genesisChainRoot,
  commitEvidenceBody,
  createJsonCommitment,
  hexEncode,
  sha256,
} from '../src/index.js'

const dirs: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(dirs.map((path) => rm(path, { recursive: true, force: true })))
})
async function fixture({
  id = '1',
  timestamp = 1,
  artifact,
}: {
  id?: string
  timestamp?: number
  artifact?: Uint8Array
} = {}) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'atrib-strict-mirror-')))
  dirs.push(dir)
  const opening = {
    nonce: 'AAAAAAAAAAAAAAAAAAAAAA',
    subject: { namespace: 'urn:test:', id: '1' },
    assertion: {
      descriptor: {
        service: 'urn:mcp:',
        operation: 'write',
        resource: { namespace: 'urn:test:', id: 'file' },
        parameters: { text: 'private' },
      },
      execution: { namespace: 'urn:run:', id },
    },
    source: {
      kind: 'declared' as const,
      identity: { namespace: 'urn:host:', id: 'test' },
      method: 'https://atrib.dev/evidence/v1/method/declared',
    },
    basis: artifact
      ? [
          {
            kind: 'artifact' as const,
            hash: `sha256:${hexEncode(sha256(artifact))}`,
            relation: 'source' as const,
          },
        ]
      : [],
  }
  const key = new Uint8Array(32).fill(19)
  const record = await signRecord(
    {
      spec_version: 'atrib/1.0',
      creator_key: base64urlEncode(await getPublicKey(key)),
      context_id: 'a'.repeat(32),
      chain_root: genesisChainRoot('a'.repeat(32)),
      timestamp,
      event_type: 'https://atrib.dev/evidence/v1/request',
      args_hash: commitEvidenceBody('request', opening),
      signature: '',
    },
    key,
  )
  return {
    dir,
    path: join(dir, 'mirror.jsonl'),
    unit: {
      record,
      opening,
      artifacts: artifact ? [{ hash: opening.basis[0].hash, bytes: artifact }] : [],
    },
    key: createJsonCommitment(
      {
        source: opening.source.identity,
        subject: opening.subject,
        execution: opening.assertion.execution,
      },
      'plain-sha256',
    ).hash,
  }
}
describe('strict mirror retention', () => {
  it('retains a complete private unit and refuses reservation replay after restart', async () => {
    const { path, unit, dir, key } = await fixture()
    expect((await createStrictMirrorRetention({ path }).reserve(key, unit)).acquired).toBe(true)
    expect((await createStrictMirrorRetention({ path }).reserve(key, unit)).acquired).toBe(false)
    const envelope = JSON.parse((await readFile(path, 'utf8')).trim())
    expect(envelope.record).toEqual(unit.record)
    expect(envelope._local.evidence.opening).toEqual(unit.opening)
    expect(typeof envelope.written_at).toBe('number')
    expect(Number.isSafeInteger(envelope.written_at)).toBe(true)
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect((await stat(dir)).mode & 0o777).toBe(0o700)
  })
  it('fails closed on a truncated journal without repairing its bytes', async () => {
    const { path, unit, key } = await fixture()
    await writeFile(path, '{"record":', { mode: 0o600 })
    await expect(createStrictMirrorRetention({ path }).reserve(key, unit)).rejects.toThrow(
      /truncated/,
    )
    expect(await readFile(path, 'utf8')).toBe('{"record":')
  })
  it('refuses symlink targets', async () => {
    const { path, unit, dir, key } = await fixture()
    const target = join(dir, 'target')
    await writeFile(target, '', { mode: 0o600 })
    await symlink(target, path)
    await expect(createStrictMirrorRetention({ path }).reserve(key, unit)).rejects.toThrow()
    expect(await readFile(target, 'utf8')).toBe('')
  })
  it('never grants two concurrent reservations', async () => {
    const { path, unit, key } = await fixture()
    const attempts = await Promise.allSettled(
      Array.from({ length: 8 }, () => createStrictMirrorRetention({ path }).reserve(key, unit)),
    )
    expect(
      attempts.filter((result) => result.status === 'fulfilled' && result.value.acquired),
    ).toHaveLength(1)
    expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(8)
    expect(
      attempts.filter((result) => result.status === 'fulfilled' && !result.value.acquired),
    ).toHaveLength(7)
  })
  it('retains unrelated concurrent reservations without refusing contention', async () => {
    const fixtures = await Promise.all(
      Array.from({ length: 8 }, (_, id) => fixture({ id: `${id}` })),
    )
    const path = fixtures[0].path
    const attempts = await Promise.allSettled(
      fixtures.map(({ key, unit }) => createStrictMirrorRetention({ path }).reserve(key, unit)),
    )
    expect(
      attempts.filter((result) => result.status === 'fulfilled' && result.value.acquired),
    ).toHaveLength(8)
    expect(await readStrictMirror(path)).toHaveLength(8)
  })
  it('reads and appends signed history after a fast clock is corrected', async () => {
    const correctedNow = Date.now()
    const futureNow = correctedNow + 10 * 60 * 1000
    const clock = vi.spyOn(Date, 'now').mockReturnValue(futureNow)
    const { path, unit, key } = await fixture({ timestamp: futureNow })
    const retention = createStrictMirrorRetention({ path })
    await retention.reserve(key, unit)
    clock.mockReturnValue(correctedNow)
    // Local write time is unsigned and cannot be the signature-verification clock.
    const entry = JSON.parse((await readFile(path, 'utf8')).trim())
    entry.written_at = 0
    await writeFile(path, JSON.stringify(entry) + '\n')
    expect((await readStrictMirror(path))[0].record).toEqual(unit.record)
    const next = await fixture({ id: 'next', timestamp: Date.now() })
    expect((await retention.reserve(next.key, next.unit)).acquired).toBe(true)
  })
  it('returns a validated journal snapshot with the original reservation', async () => {
    const { path, unit, key } = await fixture()
    const retention = createStrictMirrorRetention({ path })
    await retention.reserve(key, unit)
    const next = await fixture({ id: 'next' })
    await retention.retain(next.unit)
    const replay = await retention.reserve(key, unit)
    expect(replay.acquired).toBe(false)
    expect(replay.unit).toEqual(unit)
    expect(replay.units).toEqual([unit, next.unit])
    replay.unit.record.timestamp++
    replay.units![0].opening.subject.id = 'tampered'
    const repeated = await retention.reserve(key, unit)
    expect(repeated.unit).toEqual(unit)
    expect(repeated.units).toEqual([unit, next.unit])
  })
  it('reuses verified history across fresh retention instances for the same file', async () => {
    const { path, unit, key } = await fixture()
    await createStrictMirrorRetention({ path }).reserve(key, unit)
    const verify = vi.spyOn(signing, 'verifyRecord')
    const next = await fixture({ id: 'next' })
    await createStrictMirrorRetention({ path }).retain(next.unit)
    expect(verify).toHaveBeenCalledTimes(1)
  })
  it.each(['rewrite', 'replacement', 'truncation'])(
    'invalidates cached verification after %s',
    async (change) => {
      const { path, unit, key } = await fixture()
      const retention = createStrictMirrorRetention({ path })
      await retention.reserve(key, unit)
      const original = await stat(path)
      const text = await readFile(path, 'utf8')
      const entry = JSON.parse(text.trim())
      entry.record.timestamp++
      const corrupt = change === 'truncation' ? text.slice(0, -1) : JSON.stringify(entry) + '\n'
      if (change === 'replacement') {
        await writeFile(`${path}.replacement`, corrupt, { mode: 0o600 })
        await rename(`${path}.replacement`, path)
      } else {
        await writeFile(path, corrupt)
      }
      await utimes(path, original.atime, original.mtime)
      await expect(retention.reserve(key, unit)).rejects.toThrow()
    },
  )
  it('invalidates cached verification after another writer appends', async () => {
    const { path, unit, key } = await fixture()
    const retention = createStrictMirrorRetention({ path })
    await retention.reserve(key, unit)
    const next = await fixture({ id: 'next' })
    const verify = vi.spyOn(signing, 'verifyRecord')
    await writeFile(
      path,
      JSON.stringify({
        record: next.unit.record,
        _local: { evidence: { opening: next.unit.opening, artifacts: [] } },
        written_at: Date.now(),
      }) + '\n',
      { flag: 'a' },
    )
    const replay = await retention.reserve(key, unit)
    expect(replay.units).toEqual([unit, next.unit])
    expect(verify).toHaveBeenCalledTimes(3)
  })
  it.each([
    { artifact: new Uint8Array([251, 255]), encoded: '+/8=' },
    { artifact: new Uint8Array([255]), encoded: '/w==' },
  ])('round-trips canonical artifact padding: $encoded', async ({ artifact, encoded }) => {
    const { path, unit, key } = await fixture({ artifact })
    await createStrictMirrorRetention({ path }).reserve(key, unit)
    const entry = JSON.parse((await readFile(path, 'utf8')).trim())
    expect(entry._local.evidence.artifacts[0].base64).toBe(encoded)
    expect((await readStrictMirror(path))[0].artifacts[0].bytes).toEqual(artifact)
    expect((await createStrictMirrorRetention({ path }).reserve(key, unit)).acquired).toBe(false)
  })
  it.each(['', 'A'])('rejects excessive artifact padding with tail %j', async (tail) => {
    const { path, unit, key } = await fixture({ artifact: new Uint8Array([255]) })
    await createStrictMirrorRetention({ path }).reserve(key, unit)
    const entry = JSON.parse((await readFile(path, 'utf8')).trim())
    entry._local.evidence.artifacts[0].base64 = `/w${'='.repeat(65_536)}${tail}`
    await writeFile(path, JSON.stringify(entry) + '\n')
    await expect(readStrictMirror(path)).rejects.toThrow()
    await expect(createStrictMirrorRetention({ path }).reserve(key, unit)).rejects.toThrow()
  })
  it.each(['hash', 'bytes', 'missing'])(
    'refuses %s artifact corruption before returning replay units',
    async (corruption) => {
      const { path, unit, key } = await fixture({ artifact: new TextEncoder().encode('private') })
      const retention = createStrictMirrorRetention({ path })
      await retention.reserve(key, unit)
      const entry = JSON.parse((await readFile(path, 'utf8')).trim())
      if (corruption === 'hash')
        entry._local.evidence.artifacts[0].hash = `sha256:${'0'.repeat(64)}`
      else if (corruption === 'bytes') entry._local.evidence.artifacts[0].base64 = 'dGFtcGVyZWQ='
      else entry._local.evidence.artifacts = []
      await writeFile(path, JSON.stringify(entry) + '\n')
      await expect(retention.reserve(key, unit)).rejects.toThrow(/artifact/)
      await expect(readStrictMirror(path)).rejects.toThrow(/artifact/)
    },
  )
  it('derives prior reservations from signed Requests if local metadata is absent', async () => {
    const { path, unit, key } = await fixture()
    await createStrictMirrorRetention({ path }).reserve(key, unit)
    const entry = JSON.parse((await readFile(path, 'utf8')).trim())
    delete entry._local.evidence.reservation
    await writeFile(path, JSON.stringify(entry) + '\n')
    expect((await createStrictMirrorRetention({ path }).reserve(key, unit)).acquired).toBe(false)
  })
  it.each(['opening', 'record', 'missing-opening'])(
    'refuses corrupt %s during restart validation',
    async (part) => {
      const { path, unit, key } = await fixture()
      await createStrictMirrorRetention({ path }).reserve(key, unit)
      const entry = JSON.parse((await readFile(path, 'utf8')).trim())
      if (part === 'opening')
        entry._local.evidence.opening.assertion.descriptor.parameters.text = 'tampered'
      else if (part === 'record') entry.record.timestamp++
      else delete entry._local.evidence.opening
      await writeFile(path, JSON.stringify(entry) + '\n')
      await expect(createStrictMirrorRetention({ path }).reserve(key, unit)).rejects.toThrow()
    },
  )
  it('preserves an existing writer lock and requires manual recovery', async () => {
    const { path, unit, key } = await fixture()
    await writeFile(`${path}.lock`, '', { mode: 0o600 })
    await expect(createStrictMirrorRetention({ path }).reserve(key, unit)).rejects.toMatchObject({
      message: expect.stringMatching(/lock_busy.*manually/),
      cause: expect.objectContaining({ code: 'EEXIST' }),
    })
    expect(await readFile(`${path}.lock`, 'utf8')).toBe('')
  })
})
