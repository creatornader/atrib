#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0

import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  encoding: 'utf8',
}).trim()
const directory = mkdtempSync(join(tmpdir(), 'atrib-operating-fresh-'))

try {
  const archive = execFileSync('git', ['archive', '--format=tar', 'HEAD'], {
    cwd: repoRoot,
    maxBuffer: 256 * 1024 * 1024,
  })
  execFileSync('tar', ['-xf', '-', '-C', directory], {
    input: archive,
    stdio: ['pipe', 'inherit', 'inherit'],
  })
  execFileSync('pnpm', ['install', '--frozen-lockfile', '--filter', '@atrib/operating-graph...'], {
    cwd: directory,
    stdio: 'inherit',
  })
  execFileSync('pnpm', ['--filter', '@atrib/operating-graph...', 'build'], {
    cwd: directory,
    stdio: 'inherit',
  })
  execFileSync('pnpm', ['--filter', '@atrib/operating-graph', 'test'], {
    cwd: directory,
    stdio: 'inherit',
  })
  process.stdout.write('fresh-machine proof passed from git archive HEAD\n')
} finally {
  rmSync(directory, { recursive: true, force: true })
}
