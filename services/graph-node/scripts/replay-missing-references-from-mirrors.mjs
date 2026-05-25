#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0

/**
 * replay-missing-references-from-mirrors.mjs, backfill graph-node with
 * local record bodies for a session's missing reference nodes.
 *
 * Use case: a graph session can cite records from other contexts via
 * informed_by, annotates, or revises before graph-node has ingested those
 * target record bodies. The explorer correctly renders those as "missing
 * reference" nodes. This script fetches the session graph, extracts missing
 * reference hashes, scans producer-local mirror files for matching records,
 * and POSTs only the found targets to graph-node's /v1/ingest endpoint.
 *
 * Usage:
 *   GRAPH_ENDPOINT=https://graph.atrib.dev/v1 \
 *   CONTEXT_ID=<32-hex> \
 *   node services/graph-node/scripts/replay-missing-references-from-mirrors.mjs
 *
 * Optional environment variables:
 *   MIRROR_DIR=~/.atrib/records       Directory scanned for *.jsonl.
 *   MIRROR_FILES=a.jsonl,b.jsonl      Comma-separated files. Overrides MIRROR_DIR.
 *   DRY_RUN=1                         Report matches; do not POST.
 *   USER_AGENT=atrib-missing-ref-replay/1.0
 *
 * Exit codes:
 *   0  found records ingested, or dry-run completed
 *   1  at least one ingest call failed
 *   2  configuration or graph fetch error
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve as pathResolve, join } from 'node:path'
import { canonicalRecord } from '../../../packages/mcp/dist/canon.js'
import { sha256, hexEncode } from '../../../packages/mcp/dist/hash.js'

const GRAPH_ENDPOINT = (process.env.GRAPH_ENDPOINT ?? 'http://localhost:8787/v1').replace(/\/$/, '')
const CONTEXT_ID = process.env.CONTEXT_ID
const DRY_RUN = process.env.DRY_RUN === '1'
const USER_AGENT = process.env.USER_AGENT ?? 'atrib-missing-ref-replay/1.0'
const RAW_MIRROR_DIR = process.env.MIRROR_DIR ?? `${homedir()}/.atrib/records`

function expandHome(p) {
  return p.startsWith('~/') ? `${homedir()}/${p.slice(2)}` : p
}

function log(msg) {
  // eslint-disable-next-line no-console
  console.log(`[replay-missing-references] ${msg}`)
}

function fail(msg, code = 2) {
  // eslint-disable-next-line no-console
  console.error(`[replay-missing-references] FAIL: ${msg}`)
  process.exit(code)
}

function recordHash(record) {
  return `sha256:${hexEncode(sha256(canonicalRecord(record)))}`
}

function extractRecord(entry) {
  if (entry && typeof entry === 'object' && entry.record && typeof entry.record === 'object') {
    return entry.record
  }
  if (entry && typeof entry === 'object' && entry.signature && entry.context_id) {
    return entry
  }
  return null
}

function listMirrorFiles() {
  if (process.env.MIRROR_FILES) {
    return process.env.MIRROR_FILES
      .split(',')
      .map((p) => pathResolve(expandHome(p.trim())))
      .filter(Boolean)
  }
  const dir = pathResolve(expandHome(RAW_MIRROR_DIR))
  if (!existsSync(dir)) fail(`mirror dir not found at ${dir}`)
  return readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => join(dir, f))
}

function scanMirrors(files, targets) {
  const found = new Map()
  const commitments = new Map()
  let parsed = 0
  let parseErrors = 0

  for (const file of files) {
    if (!existsSync(file)) fail(`mirror file not found at ${file}`)
    const lines = readFileSync(file, 'utf8').split('\n')
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i].trim()
      if (!line) continue
      let entry
      try {
        entry = JSON.parse(line)
      } catch {
        parseErrors += 1
        continue
      }
      const record = extractRecord(entry)
      if (!record) continue
      parsed += 1
      let hash
      try {
        hash = recordHash(record)
      } catch {
        parseErrors += 1
        continue
      }
      if (targets.has(hash) && !found.has(hash)) {
        found.set(hash, { record, file, line: i + 1, context_id: record.context_id })
      }
      for (const field of ['args_hash', 'result_hash', 'content_id']) {
        const value = record[field]
        if (targets.has(value)) {
          if (!commitments.has(value)) commitments.set(value, [])
          commitments.get(value).push({ field, file, line: i + 1, owner_hash: hash })
        }
      }
    }
  }

  return { found, commitments, parsed, parseErrors }
}

if (!CONTEXT_ID || !/^[0-9a-f]{32}$/.test(CONTEXT_ID)) {
  fail('CONTEXT_ID must be a 32-hex context id')
}

const graphUrl = `${GRAPH_ENDPOINT}/graph/${CONTEXT_ID}?shape=compact`
let graph
try {
  const res = await fetch(graphUrl, { headers: { 'user-agent': USER_AGENT } })
  if (!res.ok) fail(`graph fetch failed: HTTP ${res.status} ${await res.text()}`)
  graph = await res.json()
} catch (e) {
  fail(`graph fetch failed: ${e.message}`)
}

const missingEdges = (graph.edges ?? []).filter((edge) => (
  edge
  && edge.dangling === true
  && edge.reference_status === 'missing'
  && typeof edge.reference_hash === 'string'
))
const targets = new Set(missingEdges.map((edge) => edge.reference_hash))

log(`graph ${CONTEXT_ID}: ${missingEdges.length} missing edge(s), ${targets.size} unique target(s)`)
if (targets.size === 0) process.exit(0)

const files = listMirrorFiles()
let totalBytes = 0
for (const f of files) totalBytes += statSync(f).size
log(`scanning ${files.length} mirror file(s), ${(totalBytes / 1024 / 1024).toFixed(1)} MB`)

const { found, commitments, parsed, parseErrors } = scanMirrors(files, targets)
log(`parsed ${parsed} record(s)${parseErrors > 0 ? `, skipped ${parseErrors} malformed line(s)` : ''}`)
log(`found ${found.size}/${targets.size} target record bod${found.size === 1 ? 'y' : 'ies'}`)

for (const [hash, hit] of [...found.entries()].sort()) {
  log(`  found ${hash} at ${hit.file}:${hit.line} ctx=${hit.context_id}`)
}
const unresolved = [...targets].filter((h) => !found.has(h)).sort()
for (const hash of unresolved) {
  const commitmentHits = commitments.get(hash) ?? []
  if (commitmentHits.length > 0) {
    const first = commitmentHits[0]
    log(`  unresolved ${hash}: matches ${first.field} at ${first.file}:${first.line}, not a record body`)
  } else {
    log(`  unresolved ${hash}: not present in scanned mirrors`)
  }
}

if (DRY_RUN) {
  log(`DRY_RUN: would POST ${found.size} record(s) to ${GRAPH_ENDPOINT}/ingest`)
  process.exit(0)
}

let succeeded = 0
let failed = 0
let firstError = null
for (const { record } of found.values()) {
  let res
  try {
    res = await fetch(`${GRAPH_ENDPOINT}/ingest`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': USER_AGENT,
      },
      body: JSON.stringify(record),
    })
  } catch (e) {
    failed += 1
    if (!firstError) firstError = `network: ${e.message}`
    continue
  }
  if (res.ok) {
    succeeded += 1
  } else {
    failed += 1
    if (!firstError) firstError = `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`
  }
}

log(`done: ${succeeded} succeeded, ${failed} failed`)
if (firstError) log(`first error: ${firstError}`)
process.exit(failed > 0 ? 1 : 0)
