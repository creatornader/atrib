// SPDX-License-Identifier: Apache-2.0
/* eslint-disable no-console */
/* global Buffer, console, process */

import { randomBytes } from 'node:crypto'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const projectSecretsPath = join(root, '.tmp', 'secrets.json')
const sharedSecretsPath = process.env.ATRIB_APPROVAL_TRACE_SECRETS_PATH
  ? resolve(process.env.ATRIB_APPROVAL_TRACE_SECRETS_PATH)
  : resolve(process.env.HOME ?? root, '.atrib', 'secrets', 'cloudflare-approval-trace.json')

const required = [
  'ATRIB_AGENT_PRIVATE_KEY',
  'ATRIB_HUMAN_APPROVER_PRIVATE_KEY',
  'ATRIB_ACTION_MCP_PRIVATE_KEY',
]

function base64url(bytes) {
  return Buffer.from(bytes)
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '')
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return {}
  }
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  await chmod(path, 0o600)
}

const shared = await readJson(sharedSecretsPath)
const project = await readJson(projectSecretsPath)
const secrets = { ...project, ...shared }

let changed = false
for (const name of required) {
  if (typeof secrets[name] !== 'string' || secrets[name].length === 0) {
    secrets[name] = base64url(randomBytes(32))
    changed = true
  }
}

await writeJson(sharedSecretsPath, secrets)
await writeJson(projectSecretsPath, secrets)

console.error(
  `approval-trace secrets ready: ${changed ? 'initialized' : 'reused'} ${sharedSecretsPath}`,
)
