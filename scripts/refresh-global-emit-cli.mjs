#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// D082 / D128-class updater and guard for the global atrib-emit-cli that
// hook-class producers spawn (see D082: the supported install path is
// `npm install -g @atrib/emit`).
//
//   pnpm refresh:global-emit-cli               reinstall latest, guard, smoke
//   pnpm refresh:global-emit-cli -- --check    guard + smoke only, no install
//   pnpm refresh:global-emit-cli -- --version 1.0.0
//
// Gates, all hard (nonzero exit on failure):
//   1. The global @atrib/emit resolves to a real directory under the npm
//      global prefix. A symlink there (npm link into a checkout) is the
//      drift this script exists to catch: it couples machine-wide hook
//      signing to checkout branch and dist state, the failure mode behind
//      the 2026-07-14 outage and two earlier incidents of the same class.
//   2. dist/cli.js exists in the installed package.
//   3. A smoke envelope through the installed CLI signs cleanly: parseable
//      JSON, signed=true, a well-formed record_hash, zero warnings.
//
// The smoke record is a real signed observation on the operator's key. It
// uses a fixed maintenance context_id so successive smokes chain together
// and stay easy to filter in recall.

import { execFileSync, spawn } from 'node:child_process'
import { lstatSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

const args = process.argv.slice(2)
const checkOnly = args.includes('--check')
const versionIdx = args.indexOf('--version')
const version = versionIdx >= 0 ? args[versionIdx + 1] : 'latest'

function fail(msg) {
  console.error(`atrib: refresh-global-emit-cli FAIL: ${msg}`)
  process.exit(1)
}

let prefix = process.env.ATRIB_NPM_PREFIX
if (!prefix) {
  try {
    prefix = execFileSync('npm', ['prefix', '-g'], { encoding: 'utf8' }).trim()
  } catch (e) {
    fail(`could not resolve npm global prefix: ${e.message}`)
  }
}
const pkgDir = join(prefix, 'lib', 'node_modules', '@atrib', 'emit')
const cliJs = join(pkgDir, 'dist', 'cli.js')

if (!checkOnly) {
  console.log(`atrib: installing @atrib/emit@${version} into ${prefix} ...`)
  try {
    execFileSync('npm', ['install', '-g', `@atrib/emit@${version}`], {
      stdio: ['ignore', 'ignore', 'inherit'],
    })
  } catch (e) {
    fail(`npm install -g @atrib/emit@${version} failed: ${e.message}`)
  }
}

// Gate 1: no symlink drift. Check the package dir and its parents inside
// the prefix, so a linked @atrib scope dir cannot hide a linked package.
for (const p of [join(prefix, 'lib', 'node_modules', '@atrib'), pkgDir]) {
  let st
  try {
    st = lstatSync(p)
  } catch {
    fail(`${p} does not exist; run without --check to install`)
  }
  if (st.isSymbolicLink()) {
    fail(
      `${p} is a symlink (npm link drift). Machine-wide hook signing must not resolve through a checkout; reinstall from the registry with: npm install -g @atrib/emit`,
    )
  }
}

// Gate 2: the CLI entry exists.
if (!existsSync(cliJs)) fail(`${cliJs} missing from the installed package`)

// Gate 3: signed smoke through the installed CLI, invoked the same way the
// hook helper's primary strategy does (this node binary + cli.js path).
const contextId = createHash('sha256').update('atrib:refresh-global-emit-cli').digest('hex').slice(0, 32)
let installedVersion
try {
  installedVersion = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')).version
} catch (e) {
  fail(`could not read installed package.json: ${e.message}`)
}
const envelope = JSON.stringify({
  event_type: 'observation',
  context_id: contextId,
  producer: 'refresh-global-emit-cli',
  content: {
    what: `Global atrib-emit-cli smoke: @atrib/emit@${installedVersion} installed from the registry signs cleanly.`,
    why_noted: 'D082 guard gate. Fixed maintenance context chains successive smokes.',
  },
})

const child = spawn(process.execPath, [cliJs], { stdio: ['pipe', 'pipe', 'pipe'] })
let stdout = ''
let stderr = ''
child.stdout.on('data', (c) => (stdout += String(c)))
child.stderr.on('data', (c) => (stderr += String(c)))
const timer = setTimeout(() => {
  child.kill('SIGKILL')
  fail('smoke timed out after 30s')
}, 30_000)
child.stdin.end(envelope)
child.on('close', () => {
  clearTimeout(timer)
  let result
  try {
    result = JSON.parse(stdout)
  } catch {
    fail(`CLI produced no parseable JSON. stderr: ${stderr.slice(0, 400)}`)
  }
  const hashOk = /^sha256:[0-9a-f]{64}$/.test(result.record_hash || '')
  if (result.signed !== true || !hashOk) {
    fail(`smoke did not sign cleanly: ${JSON.stringify(result).slice(0, 400)}`)
  }
  if (Array.isArray(result.warnings) && result.warnings.length > 0) {
    fail(`smoke signed with warnings: ${JSON.stringify(result.warnings)}`)
  }
  console.log(
    `atrib: refresh-global-emit-cli OK: @atrib/emit@${installedVersion} at ${pkgDir} (no link drift), smoke record ${result.record_hash} log_index=${result.log_index}`,
  )
})
