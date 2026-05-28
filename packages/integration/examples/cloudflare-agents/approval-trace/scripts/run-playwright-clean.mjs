// SPDX-License-Identifier: Apache-2.0

import { spawn } from 'node:child_process'

const env = { ...process.env }
delete env.NO_COLOR

const command = process.platform === 'win32' ? 'playwright.cmd' : 'playwright'
const child = spawn(command, ['test', '--config', 'playwright.config.ts'], {
  env,
  stdio: 'inherit',
})

child.on('error', (error) => {
  console.error(error)
  process.exitCode = 1
})

child.on('exit', (code) => {
  process.exitCode = code ?? 1
})
