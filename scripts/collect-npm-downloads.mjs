#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// Collects last-week download counts for every designed-public workspace
// package (npm downloads API) plus the atrib Python distribution (pypistats)
// and writes a dated snapshot to metrics/npm-downloads-<YYYY-MM-DD>.json.
//
// METRICS.md Tier 2 wiring: run monthly (or ad hoc) via
//   pnpm metrics:npm-downloads
// and commit the snapshot. Package status (current vs deprecated) is derived
// from package.json descriptions, the same ground truth check-doc-sync uses.

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function readWorkspacePackages() {
  const yaml = readFileSync(join(ROOT, 'pnpm-workspace.yaml'), 'utf8')
  const globs = [...yaml.matchAll(/^\s*-\s*['"]?([^'"\n]+?)['"]?\s*$/gm)].map((m) => m[1])
  const pkgs = []
  for (const pattern of globs) {
    const dirs = pattern.endsWith('/*')
      ? readdirSync(join(ROOT, pattern.slice(0, -2)), { withFileTypes: true })
          .filter((e) => e.isDirectory())
          .map((e) => join(pattern.slice(0, -2), e.name))
      : [pattern]
    for (const dir of dirs) {
      try {
        const pkg = JSON.parse(readFileSync(join(ROOT, dir, 'package.json'), 'utf8'))
        if (pkg.private) continue
        pkgs.push({
          name: pkg.name,
          status: /^(Legacy home|Deprecated)/.test(pkg.description || '') ? 'deprecated' : 'current',
        })
      } catch {
        /* not a package */
      }
    }
  }
  return pkgs
}

async function npmLastWeek(name) {
  const url = `https://api.npmjs.org/downloads/point/last-week/${encodeURIComponent(name).replace('%40', '@')}`
  const res = await fetch(url)
  if (res.status === 404) return { downloads: null, note: 'no download data (404)' }
  if (!res.ok) return { downloads: null, note: `npm API ${res.status}` }
  const body = await res.json()
  return { downloads: body.downloads ?? null }
}

async function pypiLastWeek(name) {
  const res = await fetch(`https://pypistats.org/api/packages/${name}/recent`)
  if (!res.ok) return { downloads: null, note: `pypistats API ${res.status}` }
  const body = await res.json()
  return { downloads: body?.data?.last_week ?? null }
}

const packages = readWorkspacePackages()
// The unscoped seed package, deprecated in favor of @atrib/daemon, still
// resolves installs from stragglers; track it until it flatlines.
packages.push({ name: 'atribd', status: 'deprecated' })

const rows = []
for (const pkg of packages) {
  const result = await npmLastWeek(pkg.name)
  rows.push({ registry: 'npm', period: 'last-week', ...pkg, ...result })
}
rows.push({ registry: 'pypi', period: 'last-week', name: 'atrib', status: 'current', ...(await pypiLastWeek('atrib')) })

const date = new Date().toISOString().slice(0, 10)
const snapshot = { collected_at: new Date().toISOString(), packages: rows }
mkdirSync(join(ROOT, 'metrics'), { recursive: true })
const outPath = join(ROOT, 'metrics', `npm-downloads-${date}.json`)
writeFileSync(outPath, JSON.stringify(snapshot, null, 2) + '\n')

const pad = (s, n) => String(s).padEnd(n)
for (const r of rows) {
  console.log(`${pad(r.registry, 5)} ${pad(r.name, 24)} ${pad(r.status, 11)} ${r.downloads ?? `- (${r.note})`}`)
}
console.log(`\nwrote ${outPath}`)
