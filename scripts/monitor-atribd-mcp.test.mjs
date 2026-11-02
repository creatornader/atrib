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

// With --notify-to, each transition is a phone push plus a separate keyed
// agent notice (no push, --rousr-strict). An open alert is re-raised to the
// agents once per reminder interval, and an agent notice that fails is
// retried next cycle without another push.
{
  const keyedState = join(temp, 'keyed-state.json')
  const argsFile = join(temp, 'keyed-args.log')
  writeFileSync(argsFile, '')
  const recorder = join(temp, 'recorder.mjs')
  // Records argv; exits 3 for agent notices while FAIL_AGENT is set.
  writeFileSync(
    recorder,
    "import { appendFileSync } from 'node:fs'; const a = process.argv.slice(2); appendFileSync(process.env.ARGS_FILE, JSON.stringify(a) + '\\n'); if (process.env.FAIL_AGENT && a.includes('--rousr-key')) process.exit(3)\n",
  )
  const keyed = (endpoint, now, env = {}) => {
    const result = spawnSync(
      process.execPath,
      [
        monitor,
        '--endpoint',
        endpoint,
        '--state-file',
        keyedState,
        '--notifier',
        recorder,
        '--notify-to',
        '@atrib',
        '--now',
        now,
      ],
      { encoding: 'utf8', env: { ...process.env, ARGS_FILE: argsFile, ...env } },
    )
    assert.equal(result.status, 0, result.stderr)
    return JSON.parse(result.stdout)
  }
  let seen = 0
  const newCalls = () => {
    const all = readFileSync(argsFile, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
    const fresh = all.slice(seen)
    seen = all.length
    return fresh
  }
  const flag = (args, name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
  const isAgent = (args) => args.includes('--rousr-key')

  keyed(unavailable, '2026-10-31T00:00:00.000Z')
  assert.equal(newCalls().length, 0)
  const opened = keyed(unavailable, '2026-10-31T00:05:00.000Z')
  assert.deepEqual(
    opened.notifications.map((n) => n.kind),
    ['availability_opened', 'availability_agent_open'],
  )
  let calls = newCalls()
  assert.equal(calls.length, 2)
  const [push, agent] = calls
  assert.equal(flag(push, '--source'), 'atribd-monitor')
  assert.ok(!isAgent(push))
  assert.equal(flag(agent, '--rousr-key'), 'atribd-mcp:availability')
  assert.equal(flag(agent, '--to'), '@atrib')
  assert.ok(agent.includes('--no-push') && agent.includes('--rousr-strict'))

  // Inside the reminder interval: nothing more is sent.
  assert.equal(keyed(unavailable, '2026-10-31T06:00:00.000Z').notifications.length, 0)
  assert.equal(newCalls().length, 0)

  // A day later: one reminder, to the agents only.
  assert.equal(
    keyed(unavailable, '2026-11-01T00:06:00.000Z').notifications[0]?.kind,
    'availability_agent_reminder',
  )
  calls = newCalls()
  assert.equal(calls.length, 1)
  assert.ok(isAgent(calls[0]))

  // An alert that was already open before agent notices existed is raised
  // on the first keyed run instead of waiting a day.
  const seeded = JSON.parse(readFileSync(keyedState, 'utf8'))
  delete seeded.reminded_at
  delete seeded.agent_pending
  writeFileSync(keyedState, JSON.stringify(seeded))
  assert.equal(
    keyed(unavailable, '2026-11-01T00:11:00.000Z').notifications[0]?.kind,
    'availability_agent_reminder',
  )
  newCalls()

  const keyedServer = spawn(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      "import { createServer } from 'node:http'; const server = createServer((_req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ status: 'ready', report: { daemon: { version: 'test', protocol_version: '2026-07-28' }, compatibility: { profile: 'test' } } })); }); server.listen(0, '127.0.0.1', () => process.stdout.write(String(server.address().port)));",
    ],
    { stdio: ['ignore', 'pipe', 'inherit'] },
  )
  const keyedPort = await new Promise((resolve, reject) => {
    keyedServer.stdout.once('data', (chunk) => resolve(Number(chunk.toString())))
    keyedServer.once('error', reject)
  })
  const healthy = `http://127.0.0.1:${keyedPort}/mcp/ready`
  try {
    // Recovery while the agent notifier fails: the phone push goes out once,
    // the resolve is kept pending, and the cycle still saves state.
    const recovered = keyed(healthy, '2026-11-01T00:16:00.000Z', { FAIL_AGENT: '1' })
    assert.deepEqual(
      recovered.notifications.map((n) => [n.kind, n.status]),
      [
        ['availability_recovered', 'sent'],
        ['availability_agent_resolve', 'failed'],
      ],
    )
    assert.equal(recovered.alerts.availability_alert, false)
    assert.equal(recovered.alerts.agent_pending.availability, 'resolved')
    newCalls()

    // Next cycle: only the resolve is retried, with no second push.
    const retried = keyed(healthy, '2026-11-01T00:21:00.000Z')
    assert.deepEqual(
      retried.notifications.map((n) => [n.kind, n.status]),
      [['availability_agent_resolve', 'sent']],
    )
    calls = newCalls()
    assert.equal(calls.length, 1)
    assert.ok(isAgent(calls[0]) && calls[0].includes('--resolve'))
    assert.equal(retried.alerts.agent_pending.availability, null)
    assert.equal(retried.alerts.reminded_at.availability, null)

    // Settled: nothing further.
    assert.equal(keyed(healthy, '2026-11-01T00:26:00.000Z').notifications.length, 0)
  } finally {
    keyedServer.kill()
  }
}

// A notifier that rejects the call (an older one) never aborts the cycle:
// state is still saved and the agent notice stays pending.
{
  const rejectState = join(temp, 'reject-state.json')
  const rejecting = join(temp, 'rejecting.mjs')
  writeFileSync(
    rejecting,
    "process.stderr.write('unknown argument: --rousr-key\\n'); process.exit(2)\n",
  )
  const reject = (now) => {
    const result = spawnSync(
      process.execPath,
      [
        monitor,
        '--endpoint',
        unavailable,
        '--state-file',
        rejectState,
        '--notifier',
        rejecting,
        '--notify-to',
        '@atrib',
        '--now',
        now,
      ],
      { encoding: 'utf8' },
    )
    assert.equal(result.status, 0, result.stderr)
    return JSON.parse(result.stdout)
  }
  reject('2026-10-31T00:00:00.000Z')
  const second = reject('2026-10-31T00:05:00.000Z')
  assert.equal(second.alerts.availability_alert, true)
  assert.ok(second.notifications.every((n) => n.status === 'failed'))
  assert.equal(JSON.parse(readFileSync(rejectState, 'utf8')).agent_pending.availability, 'firing')
}

// The compatibility alert follows the same path: opened from a health report
// with an active regression, keyed atribd-mcp:compatibility.
{
  const compatState = join(temp, 'compat-state.json')
  const compatArgs = join(temp, 'compat-args.log')
  writeFileSync(compatArgs, '')
  const recorder = join(temp, 'compat-recorder.mjs')
  writeFileSync(
    recorder,
    "import { appendFileSync } from 'node:fs'; appendFileSync(process.env.ARGS_FILE, JSON.stringify(process.argv.slice(2)) + '\\n')\n",
  )
  const regressed = spawn(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      "import { createServer } from 'node:http'; const server = createServer((_req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ status: 'ready', report: { daemon: { version: 'test', protocol_version: '2026-07-28' }, compatibility: { profile: 'test', expected_modern: true, modern_requests: 3, legacy_requests: 1, legacy_after_modern_requests: 1, regression: { active: true, window_ms: 86400000, last_legacy_after_modern_at: '2026-10-31T00:00:00.000Z' }, clients: {} } } })); }); server.listen(0, '127.0.0.1', () => process.stdout.write(String(server.address().port)));",
    ],
    { stdio: ['ignore', 'pipe', 'inherit'] },
  )
  const regressedPort = await new Promise((resolve, reject) => {
    regressed.stdout.once('data', (chunk) => resolve(Number(chunk.toString())))
    regressed.once('error', reject)
  })
  try {
    const result = spawnSync(
      process.execPath,
      [
        monitor,
        '--endpoint',
        `http://127.0.0.1:${regressedPort}/mcp/ready`,
        '--state-file',
        compatState,
        '--notifier',
        recorder,
        '--notify-to',
        '@atrib',
        '--now',
        '2026-10-31T00:01:00.000Z',
      ],
      { encoding: 'utf8', env: { ...process.env, ARGS_FILE: compatArgs } },
    )
    assert.equal(result.status, 0, result.stderr)
    const out = JSON.parse(result.stdout)
    assert.equal(out.alerts.compatibility_alert, true)
    assert.deepEqual(
      out.notifications.map((n) => n.kind),
      ['compatibility_opened', 'compatibility_agent_open'],
    )
    const agent = readFileSync(compatArgs, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))[1]
    assert.equal(agent[agent.indexOf('--rousr-key') + 1], 'atribd-mcp:compatibility')
  } finally {
    regressed.kill()
  }
}
