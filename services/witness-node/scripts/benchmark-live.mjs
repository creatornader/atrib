#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0

import { randomBytes } from 'node:crypto'
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { WitnessStore } from '../dist/store.js'
import { witnessOnce } from '../dist/witness.js'

const logBaseUrl = process.env.ATRIB_WITNESS_LOG_URL ?? 'https://log.atrib.dev'
const logOrigin = process.env.ATRIB_WITNESS_LOG_ORIGIN ?? 'log.atrib.dev/v1'
const logPublicKey = process.env.ATRIB_WITNESS_LOG_PUBLIC_KEY
if (!logPublicKey || !/^[A-Za-z0-9_-]{43}$/.test(logPublicKey)) {
  throw new Error('ATRIB_WITNESS_LOG_PUBLIC_KEY must be a pinned 32-byte base64url key')
}

const stateDirectory = mkdtempSync(join(tmpdir(), 'atrib-witness-benchmark-'))
const store = new WitnessStore(stateDirectory)
const identity = { name: 'benchmark.invalid', privateKey: randomBytes(32) }
const log = {
  logBaseUrl,
  logKey: { name: logOrigin, publicKey: logPublicKey },
}

try {
  const cold = await measure('cold_start')
  const steady = await measure('second_poll')
  process.stdout.write(
    `${JSON.stringify(
      {
        status: 'measured',
        log_origin: logOrigin,
        tree_size: steady.tree_size,
        state_bytes: directoryBytes(stateDirectory),
        process: {
          rss_bytes: process.memoryUsage().rss,
          heap_used_bytes: process.memoryUsage().heapUsed,
          max_rss_kib: process.resourceUsage().maxRSS,
        },
        measurements: [cold, steady],
      },
      null,
      2,
    )}\n`,
  )
} finally {
  rmSync(stateDirectory, { recursive: true, force: true })
}

async function measure(name) {
  let requestCount = 0
  let responseBytes = 0
  const cpuBefore = process.cpuUsage()
  const started = performance.now()
  const result = await witnessOnce({
    log,
    identity,
    store,
    fetch: async (input, init) => {
      requestCount += 1
      const response = await fetch(input, init)
      const body = await response.arrayBuffer()
      responseBytes += body.byteLength
      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      })
    },
  })
  const cpu = process.cpuUsage(cpuBefore)
  return {
    name,
    result: result.status,
    tree_size: result.treeSize,
    duration_ms: Math.round((performance.now() - started) * 100) / 100,
    cpu_user_ms: Math.round(cpu.user / 10) / 100,
    cpu_system_ms: Math.round(cpu.system / 10) / 100,
    request_count: requestCount,
    response_bytes: responseBytes,
    rss_bytes: process.memoryUsage().rss,
    heap_used_bytes: process.memoryUsage().heapUsed,
  }
}

function directoryBytes(root) {
  let total = 0
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    total += entry.isDirectory() ? directoryBytes(path) : statSync(path).size
  }
  return total
}
