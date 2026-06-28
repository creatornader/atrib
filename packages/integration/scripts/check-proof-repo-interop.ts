// SPDX-License-Identifier: Apache-2.0

import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import {
  PROOF_REPO_SURFACE_NAMES,
  classifyMissingProofRepoSurface,
  classifyProofRepoSurface,
  type ProofRepoSurfaceInput,
  type ProofRepoSurfaceName,
} from '../src/proof-x401-sdk-compat.js'

const execFileAsync = promisify(execFile)

function argValue(name: string): string | null {
  const index = process.argv.indexOf(name)
  if (index === -1) return null
  const value = process.argv[index + 1]
  return value && !value.startsWith('--') ? value : null
}

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target)
    return true
  } catch {
    return false
  }
}

function bareRepoName(repo: ProofRepoSurfaceName): string {
  return repo.slice('proof/'.length)
}

async function readMaybe(file: string): Promise<string> {
  try {
    return await readFile(file, 'utf8')
  } catch {
    return ''
  }
}

async function cloneProofRepos(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'atrib-proof-repos-'))
  for (const repo of PROOF_REPO_SURFACE_NAMES) {
    const out = path.join(root, bareRepoName(repo))
    await execFileAsync('gh', ['repo', 'clone', repo, out, '--', '--depth', '1'], {
      timeout: 120000,
      maxBuffer: 1024 * 1024,
    })
  }
  return root
}

async function repoInput(
  root: string,
  repo: ProofRepoSurfaceName,
): Promise<ProofRepoSurfaceInput | null> {
  const dir = path.join(root, bareRepoName(repo))
  if (!(await exists(dir))) return null

  const packageJson = await readMaybe(path.join(dir, 'package.json'))
  const readme = await readMaybe(path.join(dir, 'README.md'))
  const sourceCandidates = [
    'src/constants.ts',
    'src/types.ts',
    'src/index.ts',
    'src/index.node.ts',
    'src/proof_verify_id.ts',
    'app/x401/route.ts',
    'app/x401/token-exchange/route.ts',
    'app/lib/x401.ts',
    'spec/latest.md',
    'spec.md',
  ]
  const sourceText = (
    await Promise.all(sourceCandidates.map((candidate) => readMaybe(path.join(dir, candidate))))
  )
    .filter(Boolean)
    .join('\n')

  return {
    repo,
    readme,
    packageJson,
    sourceText,
  }
}

async function main(): Promise<void> {
  const explicitRoot = argValue('--repo-root') ?? process.env.PROOF_REPO_ROOT ?? null
  const liveClone = process.argv.includes('--live-clone')
  let repoRoot = explicitRoot
  let cleanupRoot: string | null = null

  if (!repoRoot && liveClone) {
    repoRoot = await cloneProofRepos()
    cleanupRoot = repoRoot
  }

  if (!repoRoot) {
    console.error(
      'Pass --repo-root <dir> for local Proof clones, set PROOF_REPO_ROOT, or pass --live-clone.',
    )
    process.exitCode = 2
    return
  }

  try {
    const inputs = await Promise.all(
      PROOF_REPO_SURFACE_NAMES.map(async (repo) => ({
        repo,
        input: await repoInput(repoRoot, repo),
      })),
    )
    const reports = inputs.map(({ repo, input }) =>
      input ? classifyProofRepoSurface(input) : classifyMissingProofRepoSurface(repo),
    )
    const runtimeReady = reports.some(
      (report) => report.repo === 'proof/x401-node' && report.runtime_dependency_allowed,
    )
    const summary = {
      checked_repos: reports.length,
      runtime_ready: runtimeReady,
      unchecked_repos: reports
        .filter((report) => report.interop_status === 'not_checked')
        .map((report) => report.repo),
      runtime_dependency_allowed: reports
        .filter((report) => report.runtime_dependency_allowed)
        .map((report) => report.repo),
    }

    console.log(
      JSON.stringify(
        {
          repo_root: repoRoot,
          summary,
          reports,
        },
        null,
        2,
      ),
    )

    if (process.argv.includes('--require-runtime-ready') && !runtimeReady) {
      process.exitCode = 1
    }
  } finally {
    if (cleanupRoot) await rm(cleanupRoot, { recursive: true, force: true })
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exitCode = 2
})
