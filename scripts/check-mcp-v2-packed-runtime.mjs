#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0

import { spawnSync } from 'node:child_process'
import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const INVENTORY_PATH = join(ROOT, 'scripts', 'mcp-v2-owned-surfaces.json')
const EXPECTED_PROTOCOL_VERSION = '2026-07-28'
const PROBE_TIMEOUT_MS = 30_000

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function workspaceManifests() {
  const manifests = new Map()
  const pending = [join(ROOT, 'packages'), join(ROOT, 'services')]

  while (pending.length > 0) {
    const directory = pending.pop()
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        pending.push(path)
      } else if (entry.isFile() && entry.name === 'package.json') {
        const manifest = readJson(path)
        if (typeof manifest.name === 'string') {
          manifests.set(manifest.name, { directory: dirname(path), manifest })
        }
      }
    }
  }

  return manifests
}

function requiredWorkspacePackages(inventory, manifests) {
  const required = new Set(
    inventory.surfaces.filter((surface) => surface.published).map((surface) => surface.package),
  )
  const pending = [...required]

  while (pending.length > 0) {
    const packageName = pending.pop()
    const entry = manifests.get(packageName)
    if (!entry) throw new Error(`Missing workspace manifest for ${packageName}`)

    for (const dependencyName of Object.keys(entry.manifest.dependencies ?? {})) {
      if (!manifests.has(dependencyName) || required.has(dependencyName)) continue
      required.add(dependencyName)
      pending.push(dependencyName)
    }
  }

  return [...required].sort()
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    env: process.env,
    ...options,
  })
  if (result.status !== 0) {
    const diagnostic =
      result.error?.message ||
      result.stderr.trim() ||
      result.stdout.trim() ||
      `exit status ${result.status}`
    throw new Error(`${command} ${args.join(' ')} failed: ${diagnostic}`)
  }
  return result.stdout.trim()
}

function packPackages(packageNames, manifests, packDirectory) {
  const archives = []
  for (const packageName of packageNames) {
    const output = run('pnpm', ['pack', '--pack-destination', packDirectory], {
      cwd: manifests.get(packageName).directory,
    })
    const archivePath = output.split('\n').at(-1)
    if (!archivePath) throw new Error(`${packageName}: pnpm pack returned no archive`)
    archives.push(isAbsolute(archivePath) ? archivePath : join(packDirectory, archivePath))
  }
  return archives
}

function installPackedPackages(archives, installDirectory) {
  writeFileSync(
    join(installDirectory, 'package.json'),
    JSON.stringify({ name: 'atrib-mcp-v2-packed-runtime-proof', private: true }),
  )
  run(
    'npm',
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--no-package-lock',
      '--save=false',
      ...archives,
    ],
    { cwd: installDirectory },
  )
}

function installedEntrypoint(installDirectory, surface) {
  const packageDirectory = join(installDirectory, 'node_modules', ...surface.package.split('/'))
  const manifest = readJson(join(packageDirectory, 'package.json'))
  const relativeEntrypoint = manifest.bin?.[surface.bin]
  if (typeof relativeEntrypoint !== 'string') {
    throw new Error(`${surface.id}: installed package is missing bin ${surface.bin}`)
  }
  return realpathSync(join(packageDirectory, relativeEntrypoint))
}

function writeWrapperFixture(installDirectory) {
  const fixturePath = join(installDirectory, 'echo-server.mjs')
  writeFileSync(
    fixturePath,
    `import { McpServer } from '@modelcontextprotocol/server'
import { serveStdio } from '@modelcontextprotocol/server/stdio'

const server = new McpServer({ name: 'packed-wrapper-fixture', version: '0.0.0' })
server.registerTool('echo', { inputSchema: {} }, async () => ({
  content: [{ type: 'text', text: 'echo' }],
}))
serveStdio(() => server)
`,
  )
  return fixturePath
}

function writeWrapperConfig(installDirectory, fixturePath) {
  const configPath = join(installDirectory, 'wrap-config.json')
  writeFileSync(
    configPath,
    JSON.stringify({
      name: 'packed-v2-proof',
      agent: 'release-check',
      upstream: {
        command: process.execPath,
        args: [fixturePath],
      },
      serverUrl: 'mcp://packed-v2-proof.local',
      logEndpoint: 'http://127.0.0.1:1/v1/entries',
      recordFile: join(installDirectory, 'wrapper-records.jsonl'),
      logFile: join(installDirectory, 'wrapper.log'),
    }),
  )
  return configPath
}

async function withTimeout(promise, label) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out`)), PROBE_TIMEOUT_MS)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

async function probeSurface(surface, installDirectory, wrapperConfigPath) {
  const args = [installedEntrypoint(installDirectory, surface)]
  if (surface.id === 'mcp-wrap-stdio') args.push(wrapperConfigPath)

  const transport = new StdioClientTransport({
    command: process.execPath,
    args,
    env: {
      ...process.env,
      ATRIB_PRIVATE_KEY: randomBytes(32).toString('base64url'),
      ATRIB_RECORD_FILE: join(installDirectory, `${surface.id}-records.jsonl`),
    },
    stderr: 'pipe',
  })
  let stderr = ''
  transport.stderr?.on('data', (chunk) => {
    stderr += String(chunk)
  })
  const client = new Client(
    { name: 'atrib-packed-runtime-proof', version: '0.0.0' },
    { versionNegotiation: { mode: { pin: EXPECTED_PROTOCOL_VERSION } } },
  )

  try {
    await withTimeout(client.connect(transport), `${surface.id} connect`)
    const listed = await withTimeout(client.listTools(), `${surface.id} tools/list`)
    if (client.getProtocolEra() !== 'modern') {
      throw new Error(`${surface.id}: expected modern protocol era`)
    }
    if (client.getNegotiatedProtocolVersion() !== EXPECTED_PROTOCOL_VERSION) {
      throw new Error(
        `${surface.id}: negotiated ${client.getNegotiatedProtocolVersion() ?? 'nothing'}`,
      )
    }
    if (listed.tools.length === 0) {
      throw new Error(`${surface.id}: tools/list returned no tools`)
    }
    if (surface.id === 'mcp-wrap-stdio' && !listed.tools.some((tool) => tool.name === 'echo')) {
      throw new Error('mcp-wrap-stdio: tools/list did not include the upstream echo tool')
    }
    return { id: surface.id, package: surface.package, tools: listed.tools.length }
  } catch (error) {
    const diagnostic = stderr.trim()
    const message = `${surface.id}: ${error instanceof Error ? error.message : String(error)}`
    throw new Error(diagnostic ? `${message}\nstderr:\n${diagnostic}` : message, {
      cause: error,
    })
  } finally {
    await client.close().catch(() => {})
  }
}

async function main() {
  const inventory = readJson(INVENTORY_PATH)
  if (inventory.protocol_version !== EXPECTED_PROTOCOL_VERSION) {
    throw new Error(`Inventory protocol version is ${inventory.protocol_version}`)
  }

  const tempDirectory = mkdtempSync(join(tmpdir(), 'atrib-mcp-v2-packed-runtime-'))
  const packDirectory = join(tempDirectory, 'packs')
  const installDirectory = join(tempDirectory, 'install')
  mkdirSync(packDirectory)
  mkdirSync(installDirectory)

  try {
    const manifests = workspaceManifests()
    const packageNames = requiredWorkspacePackages(inventory, manifests)
    const archives = packPackages(packageNames, manifests, packDirectory)
    installPackedPackages(archives, installDirectory)

    const wrapperFixturePath = writeWrapperFixture(installDirectory)
    const wrapperConfigPath = writeWrapperConfig(installDirectory, wrapperFixturePath)
    const surfaces = inventory.surfaces.filter(
      (surface) => surface.published && surface.transport === 'stdio',
    )
    const results = []
    for (const surface of surfaces) {
      results.push(await probeSurface(surface, installDirectory, wrapperConfigPath))
    }

    process.stdout.write(
      `MCP v2 packed-runtime proof passed: ${results.length} stdio surfaces from ${packageNames.length} fresh package archives negotiated ${EXPECTED_PROTOCOL_VERSION} and listed tools.\n`,
    )
  } finally {
    if (process.env.ATRIB_MCP_V2_KEEP_TEMP === '1') {
      process.stderr.write(`MCP v2 packed-runtime temp preserved at ${tempDirectory}\n`)
    } else {
      rmSync(tempDirectory, { recursive: true, force: true })
    }
  }
}

main().catch((error) => {
  process.stderr.write(
    `MCP v2 packed-runtime proof failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  )
  process.exit(1)
})
