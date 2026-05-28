import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const sourcePath = join(root, '.tmp', 'secrets.json')
const targetPath = join(root, '.tmp', 'dev.vars')

const allowed = new Set([
  'ATRIB_AGENT_PRIVATE_KEY',
  'ATRIB_HUMAN_APPROVER_PRIVATE_KEY',
  'ATRIB_ACTION_MCP_PRIVATE_KEY',
])

function quoteEnv(value) {
  return JSON.stringify(String(value))
}

const raw = await readFile(sourcePath, 'utf8')
const secrets = JSON.parse(raw)
const lines = []

for (const [key, value] of Object.entries(secrets)) {
  if (!allowed.has(key)) continue
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${key} must be a non-empty string`)
  }
  lines.push(`${key}=${quoteEnv(value)}`)
}

if (lines.length !== allowed.size) {
  throw new Error('Missing required demo signing keys in .tmp/secrets.json')
}

await mkdir(dirname(targetPath), { recursive: true })
await writeFile(targetPath, `${lines.join('\n')}\n`, { mode: 0o600 })
await chmod(targetPath, 0o600)
