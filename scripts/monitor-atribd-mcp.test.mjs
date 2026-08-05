#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0

import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const scriptsDir = fileURLToPath(new URL('.', import.meta.url))
const monitor = join(scriptsDir, 'monitor-atribd-mcp.mjs')
const temp = mkdtempSync(join(tmpdir(), 'atribd-monitor-test-'))
const stateFile = join(temp, 'state.json')
const notificationsFile = join(temp, 'notifications.log')
const notifier = join(temp, 'notifier.mjs')

writeFileSync(
  notifier,
  "import { appendFileSync } from 'node:fs'; appendFileSync(process.env.NOTIFICATIONS_FILE, 'sent\\n')\n",
)

function run(endpoint) {
  const result = spawnSync(
    process.execPath,
    [monitor, '--endpoint', endpoint, '--state-file', stateFile, '--notifier', notifier],
    {
      encoding: 'utf8',
      env: { ...process.env, NOTIFICATIONS_FILE: notificationsFile },
    },
  )
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}

const unavailable = 'http://127.0.0.1:1/mcp/ready'
const first = run(unavailable)
assert.equal(first.alerts.availability_alert, false)
assert.equal(first.alerts.availability_failures, 1)
assert.equal(first.notifications.length, 0)

const second = run(unavailable)
assert.equal(second.alerts.availability_alert, true)
assert.equal(second.alerts.availability_failures, 2)
assert.equal(second.notifications[0]?.kind, 'availability_opened')
assert.equal(readFileSync(notificationsFile, 'utf8'), 'sent\n')

const server = spawn(
  process.execPath,
  [
    '--input-type=module',
    '--eval',
    "import { createServer } from 'node:http'; const server = createServer((_req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ status: 'ready', report: { daemon: { version: 'test', protocol_version: '2026-07-28' }, compatibility: { profile: 'test' } } })); }); server.listen(0, '127.0.0.1', () => process.stdout.write(String(server.address().port)));",
  ],
  { stdio: ['ignore', 'pipe', 'inherit'] },
)
const port = await new Promise((resolve, reject) => {
  server.stdout.once('data', (chunk) => resolve(Number(chunk.toString())))
  server.once('error', reject)
  server.once('exit', (code) => reject(new Error(`test server exited with ${code}`)))
})
try {
  const recovered = run(`http://127.0.0.1:${port}/mcp/ready`)
  assert.equal(recovered.alerts.availability_alert, false)
  assert.equal(recovered.alerts.availability_failures, 0)
  assert.equal(recovered.notifications[0]?.kind, 'availability_recovered')
  assert.equal(readFileSync(notificationsFile, 'utf8'), 'sent\nsent\n')
} finally {
  server.kill()
}
