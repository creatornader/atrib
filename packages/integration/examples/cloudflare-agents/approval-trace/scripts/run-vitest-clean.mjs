// SPDX-License-Identifier: Apache-2.0

import { spawn } from 'node:child_process'

const knownDependencySourcemapWarning =
  /^Sourcemap for ".*[/\\]node_modules[/\\](?:@modelcontextprotocol[/\\]sdk|cron-schedule)[/\\].*" points to missing source files\r?$/

function pipeFiltered(stream, target) {
  let pending = ''

  stream.setEncoding('utf8')
  stream.on('data', (chunk) => {
    pending += chunk
    const lines = pending.split('\n')
    pending = lines.pop() ?? ''

    for (const line of lines) {
      if (knownDependencySourcemapWarning.test(line)) continue
      target.write(`${line}\n`)
    }
  })

  stream.on('end', () => {
    if (pending && !knownDependencySourcemapWarning.test(pending)) {
      target.write(pending)
    }
  })
}

const command = process.platform === 'win32' ? 'vitest.cmd' : 'vitest'
const child = spawn(command, ['run'], {
  env: process.env,
  stdio: ['inherit', 'pipe', 'pipe'],
})

pipeFiltered(child.stdout, process.stdout)
pipeFiltered(child.stderr, process.stderr)

child.on('error', (error) => {
  console.error(error)
  process.exitCode = 1
})

child.on('exit', (code) => {
  process.exitCode = code ?? 1
})
