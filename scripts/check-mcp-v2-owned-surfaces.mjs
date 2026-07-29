#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const INVENTORY_PATH = join(ROOT, 'scripts', 'mcp-v2-owned-surfaces.json')

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

export function validateEntrypointText(surface, text) {
  const errors = []
  for (const required of surface.require ?? []) {
    if (!text.includes(required)) {
      errors.push(`${surface.id}: ${surface.source} is missing ${JSON.stringify(required)}`)
    }
  }
  for (const forbidden of surface.forbid ?? []) {
    if (text.includes(forbidden)) {
      errors.push(
        `${surface.id}: ${surface.source} contains forbidden ${JSON.stringify(forbidden)}`,
      )
    }
  }
  return errors
}

function requireString(value, label, errors) {
  if (typeof value !== 'string' || value.length === 0) {
    errors.push(`${label} must be a non-empty string`)
  }
}

export function validateInventory(inventory, options = {}) {
  const root = options.root ?? ROOT
  const requireBuilt = options.requireBuilt ?? false
  const errors = []

  if (inventory.schema !== 'atrib.mcp-v2-owned-surfaces.v1') {
    errors.push('inventory schema must be atrib.mcp-v2-owned-surfaces.v1')
  }
  if (inventory.protocol_version !== '2026-07-28') {
    errors.push('inventory protocol_version must be 2026-07-28')
  }
  if (!Array.isArray(inventory.surfaces) || inventory.surfaces.length === 0) {
    errors.push('inventory surfaces must be a non-empty array')
    return errors
  }

  const ids = new Set()
  for (const surface of inventory.surfaces) {
    requireString(surface.id, 'surface.id', errors)
    requireString(surface.package, `${surface.id}.package`, errors)
    requireString(surface.workspace, `${surface.id}.workspace`, errors)
    requireString(surface.bin, `${surface.id}.bin`, errors)
    requireString(surface.entrypoint, `${surface.id}.entrypoint`, errors)
    requireString(surface.source, `${surface.id}.source`, errors)
    requireString(surface.artifact_file, `${surface.id}.artifact_file`, errors)
    requireString(surface.transport, `${surface.id}.transport`, errors)
    requireString(surface.process_proof, `${surface.id}.process_proof`, errors)

    if (ids.has(surface.id)) errors.push(`duplicate surface id: ${surface.id}`)
    ids.add(surface.id)

    const packagePath = join(root, surface.workspace, 'package.json')
    const sourcePath = join(root, surface.workspace, surface.source)
    const entrypointPath = join(root, surface.workspace, surface.entrypoint)
    const proofPath = join(root, surface.process_proof)

    if (!existsSync(packagePath)) {
      errors.push(`${surface.id}: missing ${surface.workspace}/package.json`)
      continue
    }
    const manifest = readJson(packagePath)
    if (manifest.name !== surface.package) {
      errors.push(
        `${surface.id}: package name ${JSON.stringify(manifest.name)} does not match ${JSON.stringify(surface.package)}`,
      )
    }
    if (manifest.bin?.[surface.bin] !== `./${surface.entrypoint}`) {
      errors.push(`${surface.id}: bin ${surface.bin} must point to ./${surface.entrypoint}`)
    }
    if (Boolean(surface.published) === Boolean(manifest.private)) {
      errors.push(
        `${surface.id}: published=${surface.published} conflicts with package private=${Boolean(manifest.private)}`,
      )
    }
    if (!existsSync(sourcePath)) {
      errors.push(`${surface.id}: missing source ${surface.workspace}/${surface.source}`)
    } else {
      errors.push(...validateEntrypointText(surface, readFileSync(sourcePath, 'utf8')))
    }
    if (!existsSync(proofPath)) {
      errors.push(`${surface.id}: missing process proof ${surface.process_proof}`)
    }
    if (requireBuilt && !existsSync(entrypointPath)) {
      errors.push(
        `${surface.id}: missing built entrypoint ${surface.workspace}/${surface.entrypoint}`,
      )
    }
  }

  const excluded = inventory.excluded_fixtures ?? []
  for (const fixture of excluded) {
    requireString(fixture.path, 'excluded_fixtures.path', errors)
    requireString(fixture.reason, `${fixture.path}.reason`, errors)
    if (fixture.path && !existsSync(join(root, fixture.path))) {
      errors.push(`excluded fixture does not exist: ${fixture.path}`)
    }
  }

  return errors
}

function packPublishedPackages(inventory) {
  const tempDir = mkdtempSync(join(tmpdir(), 'atrib-mcp-v2-packs-'))
  const errors = []
  const checked = []
  const packages = new Map()

  for (const surface of inventory.surfaces) {
    if (!surface.published) continue
    const entry = packages.get(surface.package) ?? {
      workspace: surface.workspace,
      surfaces: [],
    }
    entry.surfaces.push(surface)
    packages.set(surface.package, entry)
  }

  try {
    for (const [packageName, entry] of packages) {
      const packed = spawnSync('npm', ['pack', '--silent', '--pack-destination', tempDir], {
        cwd: join(ROOT, entry.workspace),
        encoding: 'utf8',
        env: process.env,
      })
      if (packed.status !== 0) {
        const diagnostic =
          packed.error?.message ||
          packed.stderr.trim() ||
          packed.stdout.trim() ||
          `exit status ${packed.status}`
        errors.push(`${packageName}: npm pack failed: ${diagnostic}`)
        continue
      }
      const archiveName = packed.stdout.trim().split('\n').at(-1)
      const archivePath = join(tempDir, archiveName)
      if (!archiveName || !existsSync(archivePath)) {
        errors.push(`${packageName}: npm pack did not produce an archive`)
        continue
      }

      for (const surface of entry.surfaces) {
        const extracted = spawnSync(
          'tar',
          ['-xOf', archivePath, `package/${surface.artifact_file}`],
          { cwd: ROOT, encoding: 'utf8' },
        )
        if (extracted.status !== 0) {
          errors.push(`${surface.id}: packed artifact is missing package/${surface.artifact_file}`)
          continue
        }
        errors.push(...validateEntrypointText(surface, extracted.stdout))
        checked.push({
          id: surface.id,
          package: packageName,
          artifact_file: surface.artifact_file,
        })
      }
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }

  return { checked, errors }
}

export function runOwnedSurfaceCheck(options = {}) {
  const inventory = readJson(INVENTORY_PATH)
  const errors = validateInventory(inventory, options)
  let packed = { checked: [], errors: [] }
  if (options.packed) {
    packed = packPublishedPackages(inventory)
    errors.push(...packed.errors)
  }
  return {
    schema: inventory.schema,
    protocol_version: inventory.protocol_version,
    surface_count: inventory.surfaces.length,
    published_surface_count: inventory.surfaces.filter((surface) => surface.published).length,
    excluded_fixture_count: inventory.excluded_fixtures?.length ?? 0,
    packed_checked: packed.checked,
    errors,
  }
}

function main() {
  const options = {
    requireBuilt: process.argv.includes('--require-built'),
    packed: process.argv.includes('--packed'),
  }
  const jsonMode = process.argv.includes('--json')
  const result = runOwnedSurfaceCheck(options)

  if (jsonMode) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  }
  if (result.errors.length > 0) {
    if (!jsonMode) {
      process.stderr.write('MCP v2 owned-surface check failed.\n')
      for (const error of result.errors) process.stderr.write(`- ${error}\n`)
    }
    process.exit(1)
  }
  if (!jsonMode) {
    const packed =
      result.packed_checked.length > 0
        ? ` Packed artifact checks: ${result.packed_checked.length}.`
        : ''
    process.stdout.write(
      `MCP v2 owned-surface check passed: ${result.surface_count} surfaces, ${result.published_surface_count} published, ${result.excluded_fixture_count} classified fixtures.${packed}\n`,
    )
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main()
}
