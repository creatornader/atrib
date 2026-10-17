// SPDX-License-Identifier: Apache-2.0

import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const integration = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const workspace = resolve(integration, '..', '..')
const consumer = mkdtempSync(join(tmpdir(), 'atrib-langchain-mcp2-packed-'))
const archives = join(consumer, 'archives')
mkdirSync(archives)
const manifest = JSON.parse(readFileSync(join(integration, 'package.json'), 'utf8'))
const dependencies = {}
for (const name of ['mcp', 'verify', 'agent']) {
  const directory = join(workspace, 'packages', name)
  const pkg = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
  run(['pack', '--pack-destination', archives], directory)
  dependencies[pkg.name] = `file:${join(archives, `atrib-${name}-${pkg.version}.tgz`)}`
}
for (const name of [
  '@langchain/core',
  '@langchain/langgraph',
  '@langchain/mcp-adapters',
  '@modelcontextprotocol/sdk',
  '@modelcontextprotocol/server',
  'zod',
  'canonicalize',
  'vitest',
  'typescript',
  '@types/node',
]) {
  dependencies[name] = manifest.devDependencies[name] ?? manifest.dependencies[name]
}
writeFileSync(
  join(consumer, 'package.json'),
  JSON.stringify(
    {
      name: 'atrib-langchain-packed-check',
      private: true,
      type: 'module',
      dependencies,
      pnpm: {
        overrides: Object.fromEntries(
          Object.entries(dependencies).filter(([name]) => name.startsWith('@atrib/')),
        ),
      },
    },
    null,
    2,
  ) + '\n',
)
for (const directory of ['test', 'src']) mkdirSync(join(consumer, directory))
for (const relative of [
  'test/langchain-sdk-compat.test.ts',
  'test/setup.ts',
  'src/langgraph-store-attribution.ts',
]) {
  copyFileSync(join(integration, relative), join(consumer, relative))
}
copyFileSync(join(integration, 'vitest.config.ts'), join(consumer, 'vitest.config.ts'))
run(['install', '--ignore-scripts'], consumer)
run(['exec', 'vitest', 'run', 'test/langchain-sdk-compat.test.ts'], consumer)
run(
  [
    'exec',
    'tsc',
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
    'test/langchain-sdk-compat.test.ts',
  ],
  consumer,
)
process.stdout.write(
  JSON.stringify({
    ok: true,
    consumer,
    archives: Object.keys(dependencies).filter((name) => name.startsWith('@atrib/')),
    adapter: dependencies['@langchain/mcp-adapters'],
  }) + '\n',
)

function run(args, cwd) {
  const result = spawnSync('pnpm', args, { cwd, stdio: 'inherit', timeout: 180000 })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`pnpm ${args.join(' ')} failed (${result.status})`)
}
