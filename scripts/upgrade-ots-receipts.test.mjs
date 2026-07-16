// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { upgradeOtsReceipts } from './upgrade-ots-receipts.mjs'

const pending = {
  ots_b64: 'cGVuZGluZw==',
  commitment_hex: 'a'.repeat(64),
  status: 'pending',
}
const complete = {
  ...pending,
  ots_b64: 'Y29tcGxldGU=',
  status: 'complete',
  attested_time_ms: 1_784_000_000_000,
}

async function fixture(lines) {
  const directory = await mkdtemp(join(tmpdir(), 'atrib-ots-worker-'))
  const path = join(directory, 'records.jsonl')
  await writeFile(path, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`)
  return { directory, path }
}

test('upgrades a pending receipt in the local sidecar', async () => {
  const { directory, path } = await fixture([{ record: {}, _local: { ots_receipts: [pending] } }])
  const report = await upgradeOtsReceipts({ mirrorDir: directory, upgradeReceipt: async () => complete, logger: () => {} })
  const line = JSON.parse((await readFile(path, 'utf8')).trim())
  assert.equal(report.upgraded, 1)
  assert.deepEqual(line._local.ots_receipts, [complete])
})

test('leaves an already upgraded receipt unchanged', async () => {
  const { directory, path } = await fixture([{ record: {}, _local: { ots_receipts: [complete] } }])
  let calls = 0
  const before = await readFile(path, 'utf8')
  const report = await upgradeOtsReceipts({ mirrorDir: directory, upgradeReceipt: async () => { calls += 1; return complete }, logger: () => {} })
  assert.equal(report.upgraded, 0)
  assert.equal(calls, 0)
  assert.equal(await readFile(path, 'utf8'), before)
})

test('skips a malformed sidecar line', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'atrib-ots-worker-'))
  await writeFile(join(directory, 'records.jsonl'), '{not-json}\n')
  const report = await upgradeOtsReceipts({ mirrorDir: directory, upgradeReceipt: async () => complete, logger: () => {} })
  assert.equal(report.malformed, 1)
  assert.equal(report.upgraded, 0)
})

test('keeps a pending receipt when the upgrader has no result', async () => {
  const { directory, path } = await fixture([{ record: {}, _local: { ots_receipts: [pending] } }])
  const report = await upgradeOtsReceipts({ mirrorDir: directory, upgradeReceipt: async () => null, logger: () => {} })
  const line = JSON.parse((await readFile(path, 'utf8')).trim())
  assert.equal(report.upgraded, 0)
  assert.deepEqual(line._local.ots_receipts, [pending])
})
