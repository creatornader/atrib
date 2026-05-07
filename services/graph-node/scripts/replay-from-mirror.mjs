#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0

/**
 * replay-from-mirror.mjs — replay a producer-local mirror file into a
 * graph-node instance via /v1/ingest.
 *
 * Use case: the OOM-recovery situation during the 2026-05-06 incident where
 * graph-node lost its in-memory state and the persistence archive was not
 * yet wired up. The fix-forward path was to walk the producer's local
 * mirror file (~/.atrib/records/<producer>.jsonl) and POST every record
 * to graph-node's /v1/ingest endpoint. This script bundles that ad-hoc
 * recovery logic so future incidents can reuse it without ssh-into-the-
 * box transcription.
 *
 * Usage:
 *   GRAPH_ENDPOINT=https://graph.atrib.dev/v1 \
 *   MIRROR_FILE=~/.atrib/records/atrib-emit-claude-code.jsonl \
 *   node services/graph-node/scripts/replay-from-mirror.mjs
 *
 * Optional environment variables:
 *   CONTEXT_ID=<32-hex>            Filter to one context_id only.
 *   MAX_RECORDS=<n>                Cap the replay at N records (default: all).
 *   DRY_RUN=1                      Parse mirror and report counts; do not POST.
 *   USER_AGENT=atrib-replay/1.0    Override the default User-Agent header.
 *
 * Exit codes:
 *   0  all records successfully ingested (or DRY_RUN summary printed)
 *   1  at least one ingest call failed
 *   2  configuration error (mirror not readable, endpoint unreachable, etc.)
 *
 * The script reads the mirror file line by line, accepting both bare-record
 * and envelope ({record: ..., proof: ..., _local: ...}) shapes per spec
 * §5.9 local-mirror conventions. Only the record portion is forwarded.
 */
import { readFileSync, statSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve as pathResolve } from 'node:path'

const GRAPH_ENDPOINT = (process.env.GRAPH_ENDPOINT ?? 'http://localhost:8787/v1').replace(/\/$/, '')
const RAW_MIRROR_FILE = process.env.MIRROR_FILE ?? `${homedir()}/.atrib/records/mcp-wrap-claude-code.jsonl`
const MIRROR_FILE = pathResolve(RAW_MIRROR_FILE.startsWith('~/')
  ? `${homedir()}/${RAW_MIRROR_FILE.slice(2)}`
  : RAW_MIRROR_FILE)
const CONTEXT_ID_FILTER = process.env.CONTEXT_ID
const MAX_RECORDS = process.env.MAX_RECORDS ? parseInt(process.env.MAX_RECORDS, 10) : Infinity
const DRY_RUN = process.env.DRY_RUN === '1'
const USER_AGENT = process.env.USER_AGENT ?? 'atrib-replay/1.0'

function log(msg) {
  // eslint-disable-next-line no-console
  console.log(`[replay-from-mirror] ${msg}`)
}

function fail(msg, code = 2) {
  // eslint-disable-next-line no-console
  console.error(`[replay-from-mirror] FAIL: ${msg}`)
  process.exit(code)
}

if (!existsSync(MIRROR_FILE)) {
  fail(`mirror file not found at ${MIRROR_FILE}`)
}
const stats = statSync(MIRROR_FILE)
log(`reading ${MIRROR_FILE} (${(stats.size / 1024).toFixed(1)} KB)`)

const lines = readFileSync(MIRROR_FILE, 'utf-8').split('\n')
const records = []
let parseErrors = 0

for (const raw of lines) {
  const trimmed = raw.trim()
  if (!trimmed) continue
  let entry
  try {
    entry = JSON.parse(trimmed)
  } catch {
    parseErrors += 1
    continue
  }
  // Accept both bare-record and envelope shapes per §5.9.
  const record = entry?.record ?? entry
  if (!record || typeof record !== 'object' || !record.creator_key || !record.context_id) continue
  if (CONTEXT_ID_FILTER && record.context_id !== CONTEXT_ID_FILTER) continue
  records.push(record)
  if (records.length >= MAX_RECORDS) break
}

log(`parsed ${records.length} records${parseErrors > 0 ? ` (${parseErrors} unparseable lines skipped)` : ''}`)
if (records.length === 0) {
  log('nothing to replay; exiting clean')
  process.exit(0)
}

if (DRY_RUN) {
  const byContext = new Map()
  for (const r of records) {
    byContext.set(r.context_id, (byContext.get(r.context_id) ?? 0) + 1)
  }
  log(`DRY_RUN: would POST ${records.length} records to ${GRAPH_ENDPOINT}/ingest`)
  log(`distinct context_ids: ${byContext.size}`)
  for (const [ctx, count] of [...byContext.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    log(`  ${ctx} → ${count} record${count === 1 ? '' : 's'}`)
  }
  process.exit(0)
}

let succeeded = 0
let failed = 0
let firstError = null

for (let i = 0; i < records.length; i += 1) {
  const record = records[i]
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
    if (!firstError) {
      const body = await res.text().catch(() => '<no body>')
      firstError = `HTTP ${res.status}: ${body.slice(0, 200)}`
    }
  }
  if ((i + 1) % 100 === 0) {
    log(`progress: ${i + 1}/${records.length} (${succeeded} ok, ${failed} fail)`)
  }
}

log(`done: ${succeeded} succeeded, ${failed} failed`)
if (firstError) log(`first error: ${firstError}`)
process.exit(failed > 0 ? 1 : 0)
