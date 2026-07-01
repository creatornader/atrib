#!/usr/bin/env node
// Fail before Changesets tries to publish a package that npm has never seen.
// First publishes need an npm owner account, then trusted publishing can take over.

import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const JSON_MODE = process.argv.includes('--json')

function read(rel) {
  return readFileSync(join(ROOT, rel), 'utf8')
}

function readJson(rel) {
  return JSON.parse(read(rel))
}

function readWorkspaceGlobs() {
  const text = read('pnpm-workspace.yaml')
  const out = []
  let inPackages = false
  for (const line of text.split('\n')) {
    if (/^packages:\s*$/.test(line)) {
      inPackages = true
      continue
    }
    if (!inPackages) continue

    const m = line.match(/^\s*-\s*['"]?([^'"\s]+)['"]?\s*$/)
    if (m) out.push(m[1])
    else if (/^\S/.test(line)) inPackages = false
  }
  return out
}

function workspacePackageDirs() {
  const dirs = new Set()
  for (const glob of readWorkspaceGlobs()) {
    if (glob.endsWith('/*')) {
      const base = glob.slice(0, -2)
      for (const entry of readdirSync(join(ROOT, base), { withFileTypes: true })) {
        if (entry.isDirectory()) dirs.add(`${base}/${entry.name}`)
      }
      continue
    }
    dirs.add(glob)
  }
  return [...dirs].sort()
}

function publicWorkspacePackages() {
  const packages = []
  for (const dir of workspacePackageDirs()) {
    const manifestPath = join(dir, 'package.json')
    if (!existsSync(join(ROOT, manifestPath))) continue
    const manifest = readJson(manifestPath)
    if (manifest.private || !manifest.name) continue
    packages.push({
      name: manifest.name,
      version: manifest.version,
      dir,
    })
  }
  return packages
}

function npmPackageExists(name) {
  const args = ['view', name, 'name', '--json']
  const result = spawnSync('npm', args, {
    cwd: ROOT,
    encoding: 'utf8',
    env: process.env,
  })

  if (result.status === 0) {
    return { exists: true }
  }

  const output = `${result.stdout}\n${result.stderr}`
  if (/\bE404\b|404 Not Found|is not in this registry/.test(output)) {
    return { exists: false }
  }

  return {
    exists: null,
    error: output.trim() || `npm view exited with status ${result.status}`,
  }
}

const changesetsConfig = readJson('.changeset/config.json')
const ignored = new Set(changesetsConfig.ignore ?? [])
const checked = []
const skipped = []
const missing = []
const lookupErrors = []

for (const pkg of publicWorkspacePackages()) {
  if (ignored.has(pkg.name)) {
    skipped.push(pkg)
    continue
  }

  const result = npmPackageExists(pkg.name)
  if (result.exists === true) {
    checked.push(pkg)
  } else if (result.exists === false) {
    missing.push(pkg)
  } else {
    lookupErrors.push({ ...pkg, error: result.error })
  }
}

const summary = {
  checked,
  skipped,
  missing,
  lookupErrors,
}

if (JSON_MODE) {
  console.log(JSON.stringify(summary, null, 2))
}

if (missing.length > 0 || lookupErrors.length > 0) {
  if (!JSON_MODE) {
    console.error('Release publish readiness failed.')

    if (missing.length > 0) {
      console.error('\nThese public workspace packages do not exist on npm:')
      for (const pkg of missing) {
        console.error(`- ${pkg.name}@${pkg.version} (${pkg.dir})`)
      }
      console.error(
        '\nEither complete the manual first publish and trusted-publisher setup, or add the package to .changeset/config.json ignore until that setup is done.',
      )
      console.error('See docs/publishing-new-npm-package.md.')
    }

    if (lookupErrors.length > 0) {
      console.error('\nRegistry lookups failed:')
      for (const pkg of lookupErrors) {
        console.error(`- ${pkg.name}: ${pkg.error}`)
      }
    }
  }
  process.exit(1)
}

if (!JSON_MODE) {
  console.log(
    `Release publish readiness ok: ${checked.length} npm packages exist, ${skipped.length} package(s) ignored by Changesets.`,
  )
}
