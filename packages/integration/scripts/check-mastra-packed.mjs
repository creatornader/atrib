// SPDX-License-Identifier: Apache-2.0

import { spawnSync } from 'node:child_process'
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const integration = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const workspace = resolve(integration, '..', '..')
const consumer = mkdtempSync(join(tmpdir(), 'atrib-mastra2-packed-'))
const archiveDirectory = join(consumer, 'archives')
mkdirSync(archiveDirectory)
const manifest = JSON.parse(readFileSync(join(integration, 'package.json'), 'utf8'))
const rootManifest = JSON.parse(readFileSync(join(workspace, 'package.json'), 'utf8'))
const mcpManifest = JSON.parse(readFileSync(join(workspace, 'packages/mcp/package.json'), 'utf8'))
run('pnpm', ['pack', '--pack-destination', archiveDirectory], join(workspace, 'packages/mcp'))
const archive = `file:${join(archiveDirectory, `atrib-mcp-${mcpManifest.version}.tgz`)}`
const dependencies = { '@atrib/mcp': archive }
for (const name of [
  '@mastra/core',
  '@mastra/mcp',
  'zod',
  'canonicalize',
  'ai',
  'tsx',
  'typescript',
  'vitest',
  '@types/node',
]) {
  dependencies[name] =
    manifest.devDependencies[name] ??
    manifest.dependencies[name] ??
    rootManifest.devDependencies[name]
  if (!dependencies[name]) throw new Error(`missing consumer dependency: ${name}`)
}
writeFileSync(
  join(consumer, 'package.json'),
  JSON.stringify(
    {
      name: 'atrib-mastra2-packed-check',
      private: true,
      type: 'module',
      dependencies,
      pnpm: { overrides: { '@atrib/mcp': archive } },
    },
    null,
    2,
  ) + '\n',
)
const fixtureDirectory = join(consumer, 'packages/integration')
for (const directory of ['test', 'src', 'examples'])
  mkdirSync(join(fixtureDirectory, directory), { recursive: true })
for (const relative of [
  'test/mastra-runtime-receipt.test.ts',
  'test/mastra-mcp2-compat.test.ts',
  'test/setup.ts',
  'src/mastra-runtime-receipt.ts',
  'vitest.config.ts',
]) {
  copyFileSync(join(integration, relative), join(fixtureDirectory, relative))
}
cpSync(
  join(integration, 'examples/mastra-runtime'),
  join(fixtureDirectory, 'examples/mastra-runtime'),
  { recursive: true },
)
writeFileSync(
  join(fixtureDirectory, 'package.json'),
  JSON.stringify(
    {
      name: 'mastra-runtime-fixture',
      private: true,
      type: 'module',
      devDependencies: manifest.devDependencies,
    },
    null,
    2,
  ) + '\n',
)
run('pnpm', ['install', '--ignore-scripts'], consumer)
run(process.execPath, [join(consumer, 'node_modules/vitest/vitest.mjs'), 'run'], fixtureDirectory)
run(
  process.execPath,
  [
    join(consumer, 'node_modules/typescript/bin/tsc'),
    '--ignoreConfig',
    '--noEmit',
    '--target',
    'ES2022',
    '--module',
    'ESNext',
    '--moduleResolution',
    'Bundler',
    '--types',
    'node',
    '--strict',
    '--exactOptionalPropertyTypes',
    '--skipLibCheck',
    'test/mastra-runtime-receipt.test.ts',
    'test/mastra-mcp2-compat.test.ts',
    'examples/mastra-runtime/mastra-runtime-smoke.ts',
    'examples/mastra-runtime/mastra-runtime-server.ts',
    'examples/mastra-runtime/mastra-workflow-suspend-resume-smoke.ts',
    'examples/mastra-runtime/mastra-compat-server.ts',
  ],
  fixtureDirectory,
)
process.stdout.write(
  JSON.stringify({
    ok: true,
    consumer,
    core: dependencies['@mastra/core'],
    mcp: dependencies['@mastra/mcp'],
    archive,
  }) + '\n',
)

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', timeout: 180000 })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed (${result.status})`)
}
