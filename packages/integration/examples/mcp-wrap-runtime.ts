// SPDX-License-Identifier: Apache-2.0

import { cpSync, existsSync, rmSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'

const WRAPPER_RUNTIME_FILES = [
  'config.js',
  'keys.js',
  'lifecycle.js',
  'main.js',
  'mirror.js',
  'paths.js',
  'wrap.js',
] as const

export async function snapshotWrapperMain(options: {
  integrationDir: string
  tempDir: string
}): Promise<string> {
  const sourceDist = join(options.integrationDir, '..', 'mcp-wrap', 'dist')
  const targetDist = join(options.tempDir, 'mcp-wrap-dist')
  const targetMain = join(targetDist, 'main.js')
  const sourceNodeModules =
    [
      join(options.integrationDir, 'node_modules'),
      join(options.integrationDir, '..', '..', 'node_modules'),
    ].find((candidate) => existsSync(candidate)) ?? join(options.integrationDir, 'node_modules')
  const targetNodeModules = join(options.tempDir, 'node_modules')
  const deadline = Date.now() + 5000
  let lastError: unknown

  if (!existsSync(sourceNodeModules)) {
    throw new Error('missing workspace node_modules. Run `pnpm install` first.')
  }
  if (!existsSync(targetNodeModules)) {
    symlinkSync(sourceNodeModules, targetNodeModules, 'junction')
  }

  const hasRuntimeFiles = (directory: string) =>
    WRAPPER_RUNTIME_FILES.every((file) => existsSync(join(directory, file)))

  while (Date.now() < deadline) {
    try {
      if (!hasRuntimeFiles(sourceDist)) {
        await new Promise((resolve) => setTimeout(resolve, 100))
        continue
      }
      rmSync(targetDist, { recursive: true, force: true })
      cpSync(sourceDist, targetDist, { recursive: true })
      if (hasRuntimeFiles(targetDist)) return targetMain
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  const suffix = lastError instanceof Error ? ` Last error: ${lastError.message}` : ''
  throw new Error(
    `missing @atrib/mcp-wrap dist/main.js. Run \`pnpm --filter @atrib/mcp-wrap build\` first.${suffix}`,
  )
}
