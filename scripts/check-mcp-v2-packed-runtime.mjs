#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0

import { spawn, spawnSync } from 'node:child_process'
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
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const INVENTORY_PATH = join(ROOT, 'scripts', 'mcp-v2-owned-surfaces.json')
const EXPECTED_PROTOCOL_VERSION = '2026-07-28'
const PROBE_TIMEOUT_MS = 30_000

async function installedModules(installDirectory) {
  const path = join(installDirectory, 'probe-modules.mjs')
  writeFileSync(
    path,
    `export { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
export { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
export { parseConfig } from '@atrib/mcp-wrap'
import { canonicalRecord, hexEncode, sha256 } from '@atrib/mcp'
export { verifyRecord } from '@atrib/mcp'
export function recordHash(record) {
  return 'sha256:' + hexEncode(sha256(canonicalRecord(record)))
}
`,
  )
  return import(pathToFileURL(path).href)
}

async function startLocalEndpoints() {
  const server = createServer((req, res) => {
    req.resume()
    res.setHeader('content-type', 'application/json')
    if (req.url === '/v1/entries') {
      res.end(JSON.stringify({ logIndex: 0 }))
    } else if (req.url === '/v1/chat/completions') {
      res.end(
        JSON.stringify({
          model: 'packed-fixture',
          choices: [{ message: { content: 'Packed records were summarized locally.' } }],
        }),
      )
    } else {
      res.writeHead(404).end('{}')
    }
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return { server, origin: `http://127.0.0.1:${server.address().port}` }
}

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
import { z } from 'zod'

const server = new McpServer({ name: 'packed-wrapper-fixture', version: '0.0.0' })
server.registerTool('echo', { inputSchema: { text: z.string().min(1) } }, async ({ text }) => ({
  content: [{ type: 'text', text }],
}))
serveStdio(() => server)
`,
  )
  return fixturePath
}

function writeWrapperConfig(installDirectory, fixturePath, origin) {
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
      logEndpoint: `${origin}/v1/entries`,
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

function toolProbe(surface, state) {
  const content = { what: 'packed runtime tool-call proof' }
  const context_id = state.contextId
  switch (surface.id) {
    case 'attest-stdio':
    case 'atribd-stdio':
    case 'atribd-streamable-http':
      return { name: 'attest', args: { content, context_id }, invalid: { content: 42 } }
    case 'emit-stdio':
      return {
        name: 'emit',
        args: { event_type: 'https://atrib.dev/v1/types/observation', content, context_id },
        invalid: { event_type: 42 },
      }
    case 'annotate-stdio':
      return {
        name: 'atrib-annotate',
        args: {
          annotates: state.recordHash,
          importance: 'high',
          summary: 'packed proof',
          context_id,
        },
        invalid: { annotates: 42, importance: 'high', summary: 'packed proof' },
      }
    case 'revise-stdio':
      return {
        name: 'atrib-revise',
        args: {
          revises: state.recordHash,
          prior_position: 'old packed proof',
          new_position: 'new packed proof',
          reason: 'packed check',
          context_id,
        },
        invalid: { revises: 42 },
      }
    case 'recall-stdio':
      return { name: 'recall_by_content', args: { query: 'packed' }, invalid: { query: 42 } }
    case 'trace-stdio':
      return {
        name: 'trace',
        args: { record_hash: state.recordHash },
        invalid: { record_hash: 42 },
      }
    case 'summarize-stdio':
      return { name: 'summarize', args: { context_id }, invalid: { max_records: 0 } }
    case 'verify-mcp-stdio':
      return { name: 'atrib-verify', args: { records: [state.record] }, invalid: { records: 42 } }
    case 'mcp-wrap-stdio':
      return { name: 'echo', args: { text: 'packed echo' }, invalid: { text: 42 } }
    default:
      throw new Error(`${surface.id}: missing tool-call probe`)
  }
}

async function checkToolCalls(client, surface, state) {
  const probe = toolProbe(surface, state)
  const call = (args) =>
    withTimeout(
      client.callTool({ name: probe.name, arguments: args }),
      `${surface.id} ${probe.name}`,
    )
  const result = await call(probe.args)
  assert.notEqual(result.isError, true, JSON.stringify(result))
  const text = result.content
    .filter((item) => item.type === 'text')
    .map((item) => item.text)
    .join('\n')
  if (surface.id === 'mcp-wrap-stdio') {
    assert.equal(text, 'packed echo')
  } else {
    const payload = JSON.parse(text)
    if (
      [
        'attest-stdio',
        'emit-stdio',
        'annotate-stdio',
        'revise-stdio',
        'atribd-stdio',
        'atribd-streamable-http',
      ].includes(surface.id)
    ) {
      assert.equal(payload.signed, true, JSON.stringify(payload))
      assert.match(payload.record_hash, /^sha256:[0-9a-f]{64}$/)
      const record = readFileSync(state.env.ATRIB_MIRROR_FILE, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line).record)
        .find((entry) => state.hashRecord(entry) === payload.record_hash)
      assert.ok(record, `${surface.id}: signed record missing from mirror`)
      assert.equal(await state.verifyRecord(record), true, `${surface.id}: invalid signature`)
      state.record ??= record
      state.recordHash ??= payload.record_hash
    } else if (surface.id === 'recall-stdio') {
      assert.ok(payload.results.length > 0, 'recall did not find the packed record')
    } else if (surface.id === 'trace-stdio') {
      assert.ok(payload.visited.some((entry) => entry.record_hash === state.recordHash))
    } else if (surface.id === 'summarize-stdio') {
      assert.equal(payload.narrative, 'Packed records were summarized locally.')
      assert.ok(payload.records_summarized > 0)
    } else if (surface.id === 'verify-mcp-stdio') {
      assert.equal(payload.all_accepted, true)
      assert.deepEqual(payload.accepted_record_hashes, [state.recordHash])
    }
  }

  try {
    const invalid = await call({ ...probe.args, ...probe.invalid })
    assert.equal(invalid.isError, true, `${surface.id}: invalid arguments were accepted`)
    assert.match(JSON.stringify(invalid.content), /invalid|validation|expected|too small/i)
  } catch (error) {
    if (error.code !== -32602) throw error
  }
  const recovered = await call(probe.args)
  assert.notEqual(recovered.isError, true, `${surface.id}: valid call failed after invalid input`)
}

async function probeSurface(surface, installDirectory, wrapperConfigPath, state) {
  const args = [installedEntrypoint(installDirectory, surface)]
  if (surface.id === 'mcp-wrap-stdio') args.push(wrapperConfigPath)

  const transport = new state.StdioClientTransport({
    command: process.execPath,
    args,
    env: state.env,
    stderr: 'pipe',
  })
  let stderr = ''
  transport.stderr?.on('data', (chunk) => {
    stderr += String(chunk)
  })
  const client = new state.Client(
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
    await checkToolCalls(client, surface, state)
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

async function probeHttp(surface, installDirectory, state) {
  const child = spawn(
    process.execPath,
    [
      installedEntrypoint(installDirectory, surface),
      '--http',
      '--host',
      '127.0.0.1',
      '--port',
      '0',
      '--json',
    ],
    { env: state.env, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  let stderr = ''
  child.stderr.on('data', (chunk) => {
    stderr += String(chunk)
  })
  const client = new state.Client(
    { name: 'atrib-packed-http-proof', version: '0.0.0' },
    { versionNegotiation: { mode: { pin: EXPECTED_PROTOCOL_VERSION } } },
  )
  try {
    const endpoint = await withTimeout(
      new Promise((resolve, reject) => {
        let output = ''
        child.stdout.on('data', (chunk) => {
          output += String(chunk)
          if (!output.includes('\n')) return
          try {
            resolve(JSON.parse(output.split('\n')[0]).endpoint)
          } catch (error) {
            reject(error)
          }
        })
        child.once('error', reject)
        child.once('exit', (code) => reject(new Error(`daemon exited before readiness: ${code}`)))
      }),
      'packed HTTP readiness',
    )
    const transport = new state.StreamableHTTPClientTransport(new URL(endpoint))
    await withTimeout(client.connect(transport), 'packed HTTP connect')
    assert.equal(client.getNegotiatedProtocolVersion(), EXPECTED_PROTOCOL_VERSION)
    await checkToolCalls(client, surface, state)
  } catch (error) {
    throw new Error(`${surface.id}: ${error.message}\nstderr:\n${stderr}`, { cause: error })
  } finally {
    await client.close().catch(() => {})
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit')
      child.kill('SIGTERM')
      try {
        await withTimeout(exited, 'packed HTTP shutdown')
      } catch {
        child.kill('SIGKILL')
        await exited
      }
    }
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
  let endpoints

  try {
    const manifests = workspaceManifests()
    const packageNames = requiredWorkspacePackages(inventory, manifests)
    const archives = packPackages(packageNames, manifests, packDirectory)
    installPackedPackages(archives, installDirectory)

    endpoints = await startLocalEndpoints()
    const recordsDirectory = join(installDirectory, 'records')
    mkdirSync(recordsDirectory)
    const mirrorPath = join(recordsDirectory, 'packed.jsonl')
    const {
      Client,
      StdioClientTransport,
      StreamableHTTPClientTransport,
      verifyRecord,
      recordHash,
      parseConfig,
    } = await installedModules(installDirectory)
    const state = {
      Client,
      StdioClientTransport,
      StreamableHTTPClientTransport,
      verifyRecord,
      hashRecord: recordHash,
      contextId: randomBytes(16).toString('hex'),
      env: {
        PATH: process.env.PATH ?? '',
        ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
        HOME: installDirectory,
        USERPROFILE: installDirectory,
        ATRIB_PRIVATE_KEY: randomBytes(32).toString('base64url'),
        ATRIB_REQUIRE_EXPLICIT_CONTEXT_ID: '1',
        ATRIB_RECORDS_DIR: recordsDirectory,
        ATRIB_MIRROR_FILE: mirrorPath,
        ATRIB_RECORD_FILE: mirrorPath,
        ATRIB_AUTOCHAIN_SOURCE: mirrorPath,
        ATRIB_READ_PRIMITIVES_LOG: join(installDirectory, 'reads.jsonl'),
        ATRIB_LOG_ENDPOINT: `${endpoints.origin}/v1/entries`,
        ATRIB_SUMMARIZE_BASE_URL: `${endpoints.origin}/v1`,
        ATRIB_SUMMARIZE_API_KEY: 'packed-local-fixture',
      },
    }

    const wrapperFixturePath = writeWrapperFixture(installDirectory)
    const wrapperConfigPath = writeWrapperConfig(
      installDirectory,
      wrapperFixturePath,
      endpoints.origin,
    )
    const wrapperManifest = readJson(
      join(installDirectory, 'node_modules', '@atrib', 'mcp-wrap', 'package.json'),
    )
    assert.match(wrapperManifest.dependencies.zod, /^\^4\./)
    const wrapperConfig = readJson(wrapperConfigPath)
    assert.equal(parseConfig(wrapperConfig).name, wrapperConfig.name)
    assert.throws(() => parseConfig({ ...wrapperConfig, upstream: { command: 42 } }))
    const surfaces = inventory.surfaces.filter(
      (surface) => surface.published && surface.transport === 'stdio',
    )
    const results = []
    for (const surface of surfaces) {
      results.push(await probeSurface(surface, installDirectory, wrapperConfigPath, state))
    }

    const httpSurface = inventory.surfaces.find(
      (surface) => surface.id === 'atribd-streamable-http',
    )
    assert.ok(httpSurface, 'daemon HTTP surface missing from inventory')
    await probeHttp(httpSurface, installDirectory, state)

    process.stdout.write(
      `MCP v2 packed-runtime proof passed: ${results.length} stdio surfaces and daemon HTTP from ${packageNames.length} fresh package archives negotiated ${EXPECTED_PROTOCOL_VERSION}, executed tools, rejected invalid inputs, and recovered.\n`,
    )
  } finally {
    if (endpoints) await new Promise((resolve) => endpoints.server.close(resolve))
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
