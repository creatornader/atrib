import { mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { writeAdvisoryIndexFile } from '../src/advisory-index.js'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'atrib-advisory-index-test-'))
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

describe('writeAdvisoryIndexFile', () => {
  it('replaces the index and leaves no temp file of its own', async () => {
    const path = join(tmpDir, '.atrib-example-index-v1.json')
    await writeAdvisoryIndexFile(path, 'first\n')
    await writeAdvisoryIndexFile(path, 'second\n')

    expect(await readFile(path, 'utf8')).toBe('second\n')
    expect(await readdir(tmpDir)).toEqual(['.atrib-example-index-v1.json'])
  })

  it('sweeps temp files abandoned by a killed writer and keeps recent ones', async () => {
    const path = join(tmpDir, '.atrib-example-index-v1.json')
    const abandoned = `${path}.4242.dead.tmp`
    const inProgress = `${path}.4243.live.tmp`
    const otherIndex = join(tmpDir, '.atrib-other-index-v1.json.4242.dead.tmp')
    const unrelated = join(tmpDir, 'producer.jsonl')
    for (const file of [abandoned, inProgress, otherIndex, unrelated]) await writeFile(file, 'x')
    const old = new Date(Date.now() - 60 * 60 * 1000)
    for (const file of [abandoned, otherIndex, unrelated]) await utimes(file, old, old)

    await writeAdvisoryIndexFile(path, 'index\n')

    expect((await readdir(tmpDir)).sort()).toEqual(
      [
        '.atrib-example-index-v1.json',
        '.atrib-example-index-v1.json.4243.live.tmp',
        '.atrib-other-index-v1.json.4242.dead.tmp',
        'producer.jsonl',
      ].sort(),
    )
  })

  it('throws when the directory is missing and leaves nothing behind', async () => {
    const path = join(tmpDir, 'missing', '.atrib-example-index-v1.json')
    await expect(writeAdvisoryIndexFile(path, 'index\n')).rejects.toThrow()
    expect(await readdir(tmpDir)).toEqual([])
  })
})
