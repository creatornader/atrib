import { randomBytes } from 'node:crypto'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as ed25519 from '@noble/ed25519'
import { describe, expect, it } from 'vitest'
import { buildDirectoryAnchor } from '../src/anchor.js'
import { AnchorHistory } from '../src/anchor-history.js'

const ORIGIN = 'directory.test.local/v6'

async function setup() {
  const key = randomBytes(32)
  const creator = Buffer.from(await ed25519.getPublicKeyAsync(key)).toString('base64url')
  const path = join(await mkdtemp(join(tmpdir(), 'atrib-anchor-history-')), 'anchors.jsonl')
  const history = await AnchorHistory.create(ORIGIN, creator, path)
  const build = (epoch: number) =>
    buildDirectoryAnchor({
      directoryOrigin: ORIGIN,
      operatorPrivateKey: key,
      epoch,
      rootHash: `root-${epoch}`,
      previousAnchorRecordHash: history.latestCommittedHash(),
    })
  return { history, path, creator, build }
}

describe('directory anchor journal', () => {
  it('refuses a wrong commit without writing a line that would stop the next start', async () => {
    const { history, path, creator, build } = await setup()
    const first = await build(1)
    await history.prepare(first.record, first.record_hash)
    await expect(history.commit('sha256:' + '0'.repeat(64))).rejects.toThrow(/unknown record/)
    await history.commit(first.record_hash)
    // A retried commit of the committed head is a no-op.
    await history.commit(first.record_hash)
    const lines = (await readFile(path, 'utf8')).trim().split('\n')
    expect(lines).toHaveLength(2)
    const reopened = await AnchorHistory.create(ORIGIN, creator, path)
    expect(reopened.latestCommittedHash()).toBe(first.record_hash)
  })

  it('abandons a refused pending record and replays the abandonment after restart', async () => {
    const { history, path, creator, build } = await setup()
    const refused = await build(1)
    await history.prepare(refused.record, refused.record_hash)
    await history.abandon(refused.record_hash, 'log returned 400')
    expect(history.pending()).toBeUndefined()
    const replacement = await build(1)
    await history.prepare(replacement.record, replacement.record_hash)
    await history.commit(replacement.record_hash)
    await expect(history.abandon(replacement.record_hash, 'late')).rejects.toThrow(/not pending/)

    const reopened = await AnchorHistory.create(ORIGIN, creator, path)
    expect(reopened.latestCommittedHash()).toBe(replacement.record_hash)
    expect(reopened.getByHash(refused.record_hash)).toBeUndefined()
    expect(reopened.pending()).toBeUndefined()
  })
})
