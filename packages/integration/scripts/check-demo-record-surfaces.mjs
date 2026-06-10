#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const PKG_DIR = join(SCRIPT_DIR, '..')
const REPO_ROOT = join(PKG_DIR, '..', '..')
const MANIFEST_PATH = join(PKG_DIR, 'demo-record-surfaces.json')
const README_PATH = join(PKG_DIR, 'README.md')
const PACKAGE_JSON_PATH = join(PKG_DIR, 'package.json')

const EXEMPT_SCRIPTS = new Set(['test', 'typecheck', 'build'])
const CLASS_ENDPOINT_RULES = {
  'offline-local': new Set(['local-only', 'public-read']),
  'public-proof': new Set(['public-write']),
  'live-capture': new Set(['local-only', 'upstream-capture']),
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function fail(message) {
  failures.push(message)
}

function rel(path) {
  return relative(REPO_ROOT, path)
}

const failures = []
const manifest = readJson(MANIFEST_PATH)
const pkg = readJson(PACKAGE_JSON_PATH)
const readme = readFileSync(README_PATH, 'utf8')

if (manifest.schema !== 'atrib.integration.demo-record-surfaces.v1') {
  fail(`unexpected manifest schema: ${manifest.schema}`)
}

const knownClasses = new Set(Object.keys(manifest.record_classes ?? {}))
const knownEndpointPostures = new Set(Object.keys(manifest.endpoint_postures ?? {}))
const surfaceIds = new Set()
const coveredScripts = new Map()

for (const surface of manifest.surfaces ?? []) {
  if (!surface.id || typeof surface.id !== 'string') fail('surface missing string id')
  if (surfaceIds.has(surface.id)) fail(`duplicate surface id: ${surface.id}`)
  surfaceIds.add(surface.id)

  if (!knownClasses.has(surface.record_class)) {
    fail(`${surface.id}: unknown record_class ${surface.record_class}`)
  }
  if (!knownEndpointPostures.has(surface.endpoint_posture)) {
    fail(`${surface.id}: unknown endpoint_posture ${surface.endpoint_posture}`)
  }
  const allowed = CLASS_ENDPOINT_RULES[surface.record_class]
  if (allowed && !allowed.has(surface.endpoint_posture)) {
    fail(
      `${surface.id}: ${surface.record_class} cannot use endpoint_posture ${surface.endpoint_posture}`,
    )
  }

  const surfacePath = join(PKG_DIR, surface.path ?? '')
  if (!surface.path || !existsSync(surfacePath)) {
    fail(`${surface.id}: missing path ${surface.path}`)
  }

  if (!Array.isArray(surface.commands)) {
    fail(`${surface.id}: commands must be an array`)
  } else {
    for (const command of surface.commands) {
      if (typeof command !== 'string' || command.length === 0) {
        fail(`${surface.id}: command entries must be non-empty strings`)
        continue
      }
      if (coveredScripts.has(command)) {
        fail(`${command}: listed by both ${coveredScripts.get(command)} and ${surface.id}`)
      }
      coveredScripts.set(command, surface.id)
    }
  }
}

for (const command of Object.keys(pkg.scripts ?? {})) {
  if (EXEMPT_SCRIPTS.has(command)) continue
  if (!coveredScripts.has(command)) {
    fail(`package script "${command}" is missing from demo-record-surfaces.json`)
  }
}

for (const command of coveredScripts.keys()) {
  if (!pkg.scripts?.[command]) {
    fail(`manifest command "${command}" is not in packages/integration/package.json`)
  }
}

const exampleDir = join(PKG_DIR, 'examples')
for (const entry of readdirSync(exampleDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const examplePath = `examples/${entry.name}`
  const hasSurface = (manifest.surfaces ?? []).some(
    (surface) => surface.path === examplePath || surface.path.startsWith(`${examplePath}/`),
  )
  if (!hasSurface) fail(`${examplePath}: no demo record surface classification`)
}

const readmeRequired = [
  'Offline and local demos',
  'Public proof generators',
  'Live capture artifacts',
  'demo-record-surfaces.json',
  'endpoint posture',
]
for (const needle of readmeRequired) {
  if (!readme.includes(needle)) fail(`${rel(README_PATH)} missing "${needle}"`)
}

if (failures.length > 0) {
  console.error(`demo-record-surfaces: ${failures.length} failure(s)`)
  for (const failure of failures) console.error(`  FAIL ${failure}`)
  process.exit(1)
}

console.log(
  `demo-record-surfaces: ${surfaceIds.size} surface(s), ${coveredScripts.size} script(s), ${knownClasses.size} record class(es)`,
)
