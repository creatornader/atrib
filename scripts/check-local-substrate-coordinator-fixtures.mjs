#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const CORPUS = join(ROOT, 'spec/conformance/local-substrate-coordinator')
const REQUIRED_CLASSES = new Set(['startup-spawn', 'long-lived-agent', 'watcher-wal'])
const REQUIRED_HEALTH_PATHS = [
  'coordinator.pid',
  'coordinator.version',
  'coordinator.transport',
  'queues.log_submission_depth',
  'wal.pending',
  'wal.orphan_receipts',
  'contexts.active',
  'processes.stale_children',
]

const failures = []

function readJson(absPath) {
  return JSON.parse(readFileSync(absPath, 'utf8'))
}

function fail(message) {
  failures.push(message)
}

function canonicalize(value) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
  if (typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

function getPath(obj, dotted) {
  return dotted.split('.').reduce((acc, part) => (acc == null ? undefined : acc[part]), obj)
}

function deepEqual(a, b) {
  return canonicalize(a) === canonicalize(b)
}

function checkCase(manifestCase) {
  const rel = manifestCase.file
  const abs = join(CORPUS, rel)
  if (!existsSync(abs)) {
    fail(`${rel}: missing case file`)
    return null
  }

  const c = readJson(abs)
  const label = c.name || rel
  const request = c.input?.coordinator_request
  const direct = c.input?.direct_record_body
  const recordBody = request?.record_body

  if (c.name !== manifestCase.name) {
    fail(`${rel}: manifest name ${manifestCase.name} does not match case name ${c.name}`)
  }
  if (request?.schema !== 'atrib.local-substrate-coordinator.request.v0') {
    fail(`${label}: request schema must be atrib.local-substrate-coordinator.request.v0`)
  }
  if (!REQUIRED_CLASSES.has(c.harness_class)) {
    fail(`${label}: harness_class must be one of ${[...REQUIRED_CLASSES].join(', ')}`)
  }
  if (request?.producer?.harness_class !== c.harness_class) {
    fail(`${label}: producer.harness_class must match top-level harness_class`)
  }
  if (!direct || !recordBody) {
    fail(
      `${label}: case must include input.direct_record_body and input.coordinator_request.record_body`,
    )
  } else if (!deepEqual(direct, recordBody)) {
    fail(`${label}: coordinator record body differs from direct producer body`)
  }
  if (request?.degradation?.primary_path_blocking !== false) {
    fail(`${label}: degradation.primary_path_blocking must be false`)
  }
  if (!request?.degradation?.if_unavailable) {
    fail(`${label}: degradation.if_unavailable must describe fallback behavior`)
  }
  if (c.expected?.record_bytes_unchanged !== true) {
    fail(`${label}: expected.record_bytes_unchanged must be true`)
  }
  if (c.expected?.fallback_required !== true) {
    fail(`${label}: expected.fallback_required must be true`)
  }

  if (recordBody) {
    const actualHash = sha256(canonicalize(recordBody))
    if (c.expected?.canonical_record_body_sha256 !== actualHash) {
      fail(`${label}: canonical_record_body_sha256 mismatch, expected ${actualHash}`)
    }
  }

  const health = c.input?.health_report
  for (const path of REQUIRED_HEALTH_PATHS) {
    if (getPath(health, path) === undefined) {
      fail(`${label}: health_report missing ${path}`)
    }
  }

  return c.harness_class
}

function main() {
  const manifestPath = join(CORPUS, 'manifest.json')
  if (!existsSync(manifestPath)) {
    fail('missing spec/conformance/local-substrate-coordinator/manifest.json')
  }

  const manifest = failures.length ? { cases: [] } : readJson(manifestPath)
  const seen = new Set()
  for (const c of manifest.cases || []) {
    const harnessClass = checkCase(c)
    if (harnessClass) seen.add(harnessClass)
  }

  for (const required of REQUIRED_CLASSES) {
    if (!seen.has(required)) fail(`missing harness_class fixture: ${required}`)
  }
  if ((manifest.cases || []).length !== REQUIRED_CLASSES.size) {
    fail(`manifest must declare exactly ${REQUIRED_CLASSES.size} cases`)
  }

  if (failures.length) {
    for (const f of failures) console.error(`FAIL ${f}`)
    process.exit(1)
  }

  console.log(`local-substrate-coordinator fixtures ok: ${seen.size} harness classes`)
}

main()
