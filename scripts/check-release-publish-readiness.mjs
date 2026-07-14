#!/usr/bin/env node
// Fail before Changesets tries to publish a package that npm has never seen.
// First publishes need an npm owner account, then trusted publishing can take over.
//
// The Changesets ignore list deliberately does NOT exempt a package here:
// `changeset publish` attempts every non-private workspace package whose
// local version is absent from npm, and the ignore list only gates
// `changeset version`. An ignored-but-public unseeded package failed
// release.yml on every main push on 2026-07-10; the working protection is
// `"private": true` until the seed, and this gate enforces it.

import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const JSON_MODE = process.argv.includes('--json')
// The npm registry stores package descriptions truncated at 255 characters;
// @atrib/verify-mcp@1.0.0 shipped with its description cut mid-word. Gate
// the length here so the cut never reaches the registry again.
const NPM_DESCRIPTION_LIMIT = 255

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
      description: typeof manifest.description === 'string' ? manifest.description : '',
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
const missing = []
const lookupErrors = []
const oversizedDescriptions = []

// Every non-private package is checked, ignore list or not: the publish
// step does not consult the ignore list, so neither does the gate.
for (const pkg of publicWorkspacePackages()) {
  const entry = { ...pkg, ignored_by_changesets: ignored.has(pkg.name) }
  if (pkg.description.length > NPM_DESCRIPTION_LIMIT) {
    oversizedDescriptions.push({
      name: pkg.name,
      dir: pkg.dir,
      length: pkg.description.length,
      limit: NPM_DESCRIPTION_LIMIT,
    })
  }
  const result = npmPackageExists(pkg.name)
  if (result.exists === true) {
    checked.push(entry)
  } else if (result.exists === false) {
    missing.push(entry)
  } else {
    lookupErrors.push({ ...entry, error: result.error })
  }
}

const summary = {
  checked,
  missing,
  lookupErrors,
  oversizedDescriptions,
  changesets_ignore: [...ignored],
}

if (JSON_MODE) {
  console.log(JSON.stringify(summary, null, 2))
}

if (missing.length > 0 || lookupErrors.length > 0 || oversizedDescriptions.length > 0) {
  if (!JSON_MODE) {
    console.error('Release publish readiness failed.')

    if (missing.length > 0) {
      console.error('\nThese public workspace packages do not exist on npm:')
      for (const pkg of missing) {
        const note = pkg.ignored_by_changesets
          ? ' [in the Changesets ignore list, which does NOT stop changeset publish]'
          : ''
        console.error(`- ${pkg.name}@${pkg.version} (${pkg.dir})${note}`)
      }
      console.error(
        '\nEither complete the manual first publish and trusted-publisher setup, or keep the package "private": true until that setup is done. The Changesets ignore entry only gates changeset version; it does not protect the publish step.',
      )
      console.error('See docs/publishing-new-npm-package.md.')
    }

    if (lookupErrors.length > 0) {
      console.error('\nRegistry lookups failed:')
      for (const pkg of lookupErrors) {
        console.error(`- ${pkg.name}: ${pkg.error}`)
      }
    }

    if (oversizedDescriptions.length > 0) {
      console.error(
        '\nThese package descriptions exceed the npm registry limit and would be stored truncated:',
      )
      for (const pkg of oversizedDescriptions) {
        console.error(`- ${pkg.name} (${pkg.dir}): ${pkg.length} chars, limit ${pkg.limit}`)
      }
      console.error('Shorten the description field to a complete sentence within the limit.')
    }
  }
  process.exit(1)
}

if (!JSON_MODE) {
  console.log(
    `Release publish readiness ok: all ${checked.length} non-private workspace packages exist on npm with registry-safe description lengths (${ignored.size} name(s) in the Changesets ignore list).`,
  )
}
