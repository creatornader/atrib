#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0

/**
 * Replay locally mirrored records that never received an inclusion proof.
 *
 * The producer mirror can contain envelope entries shaped as
 * `{ record, proof: null, _local }` when a record was signed locally but log
 * submission exceeded the producer's flush deadline. This script finds those
 * proof-null records, checks whether each hash already exists in log-node, and
 * can submit only the missing records.
 *
 * Safe default: scan-only. Set SUBMIT=1 to append missing records.
 *
 * Usage:
 *   MIRROR_DIR=~/.atrib/records \
 *   LOG_ENDPOINT=https://log.atrib.dev/v1 \
 *   node services/log-node/scripts/replay-proof-null-from-mirror.mjs
 *
 *   SUBMIT=1 RECORD_HASH=sha256:<64-hex> \
 *   node services/log-node/scripts/replay-proof-null-from-mirror.mjs
 *
 * Optional environment variables:
 *   MIRROR_FILE=<path>             Scan one mirror file.
 *   MIRROR_DIR=<path>              Scan all *.jsonl files in a directory.
 *                                  Default: ~/.atrib/records.
 *   LOG_ENDPOINT=<url>             Default: https://log.atrib.dev/v1.
 *   CONTEXT_ID=<32-hex>            Filter to one context_id.
 *   RECORD_HASH=<sha256:...|hex>   Filter to one record hash.
 *   MAX_RECORDS=<n>                Cap candidate records after filtering.
 *   INCLUDE_BARE_RECORDS=1         Include bare-record mirror lines. Default
 *                                  only replays proof-null envelopes.
 *   SUBMIT=1                       Append missing records. Otherwise scan only.
 *   USER_AGENT=<ua>                Default: atrib-proof-null-replay/1.0.
 *
 * Exit codes:
 *   0  scan succeeded, and every requested submit succeeded
 *   1  at least one lookup or submit failed
 *   2  configuration error
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve as pathResolve } from 'node:path'
import { canonicalRecord, sha256, hexEncode } from '@atrib/mcp'

const LOG_ENDPOINT = (process.env.LOG_ENDPOINT ?? 'https://log.atrib.dev/v1').replace(/\/$/, '')
const RAW_MIRROR_FILE = process.env.MIRROR_FILE
const RAW_MIRROR_DIR = process.env.MIRROR_DIR ?? `${homedir()}/.atrib/records`
const CONTEXT_ID_FILTER = process.env.CONTEXT_ID
const RECORD_HASH_FILTER = normalizeRecordHash(process.env.RECORD_HASH)
const MAX_RECORDS = process.env.MAX_RECORDS ? parseInt(process.env.MAX_RECORDS, 10) : Infinity
const INCLUDE_BARE_RECORDS = process.env.INCLUDE_BARE_RECORDS === '1'
const SUBMIT = process.env.SUBMIT === '1'
const USER_AGENT = process.env.USER_AGENT ?? 'atrib-proof-null-replay/1.0'

function log(message) {
  // eslint-disable-next-line no-console
  console.log(`[replay-proof-null] ${message}`)
}

function fail(message, code = 2) {
  // eslint-disable-next-line no-console
  console.error(`[replay-proof-null] FAIL: ${message}`)
  process.exit(code)
}

function expandPath(raw) {
  if (!raw) return raw
  return pathResolve(raw.startsWith('~/') ? `${homedir()}/${raw.slice(2)}` : raw)
}

function normalizeRecordHash(value) {
  if (!value) return null
  const raw = value.startsWith('sha256:') ? value.slice('sha256:'.length) : value
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) fail(`invalid RECORD_HASH ${value}`)
  return `sha256:${raw.toLowerCase()}`
}

function mirrorFiles() {
  if (RAW_MIRROR_FILE) {
    const file = expandPath(RAW_MIRROR_FILE)
    if (!existsSync(file)) fail(`mirror file not found at ${file}`)
    return [file]
  }

  const dir = expandPath(RAW_MIRROR_DIR)
  if (!existsSync(dir)) fail(`mirror directory not found at ${dir}`)
  return readdirSync(dir)
    .filter((name) => name.endsWith('.jsonl'))
    .sort()
    .map((name) => `${dir}/${name}`)
}

function recordHash(record) {
  return `sha256:${hexEncode(sha256(canonicalRecord(record)))}`
}

function collectCandidates(files) {
  const candidates = []
  const seen = new Set()
  let parseErrors = 0
  let skippedNonProofNull = 0

  for (const file of files) {
    const stats = statSync(file)
    log(`reading ${file} (${(stats.size / 1024).toFixed(1)} KB)`)
    const lines = readFileSync(file, 'utf-8').split('\n')
    for (let i = 0; i < lines.length; i += 1) {
      const trimmed = lines[i].trim()
      if (!trimmed) continue
      let entry
      try {
        entry = JSON.parse(trimmed)
      } catch {
        parseErrors += 1
        continue
      }

      const isEnvelope = entry && typeof entry === 'object' && 'record' in entry
      if (!isEnvelope && !INCLUDE_BARE_RECORDS) {
        skippedNonProofNull += 1
        continue
      }
      if (isEnvelope && entry.proof !== null) {
        skippedNonProofNull += 1
        continue
      }

      const record = isEnvelope ? entry.record : entry
      if (!record || typeof record !== 'object' || !record.creator_key || !record.context_id) continue
      if (CONTEXT_ID_FILTER && record.context_id !== CONTEXT_ID_FILTER) continue

      const hash = recordHash(record)
      if (RECORD_HASH_FILTER && hash !== RECORD_HASH_FILTER) continue
      if (seen.has(hash)) continue
      seen.add(hash)
      candidates.push({ file, line: i + 1, hash, record })
      if (candidates.length >= MAX_RECORDS) break
    }
    if (candidates.length >= MAX_RECORDS) break
  }

  return { candidates, parseErrors, skippedNonProofNull }
}

async function lookup(hash) {
  const hex = hash.slice('sha256:'.length)
  const res = await fetch(`${LOG_ENDPOINT}/lookup/${hex}`, {
    headers: { 'user-agent': USER_AGENT },
  })
  if (res.status === 404) return { present: false }
  if (!res.ok) return { present: null, error: `lookup HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` }
  return { present: true, entry: await res.json() }
}

async function submit(record) {
  const res = await fetch(`${LOG_ENDPOINT}/entries`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'user-agent': USER_AGENT,
      'x-atrib-priority': 'high',
    },
    body: JSON.stringify(record),
  })
  if (!res.ok) {
    return { ok: false, error: `submit HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` }
  }
  return { ok: true, proof: await res.json() }
}

const files = mirrorFiles()
const { candidates, parseErrors, skippedNonProofNull } = collectCandidates(files)
log(`candidates: ${candidates.length}${parseErrors ? `, parse errors: ${parseErrors}` : ''}${skippedNonProofNull ? `, skipped non-proof-null: ${skippedNonProofNull}` : ''}`)
if (candidates.length === 0) process.exit(0)
if (!SUBMIT) log('scan-only mode; set SUBMIT=1 to append missing records')

let present = 0
let missing = 0
let submitted = 0
let failed = 0
let firstError = null

for (const candidate of candidates) {
  let lookupResult
  try {
    lookupResult = await lookup(candidate.hash)
  } catch (error) {
    failed += 1
    firstError ??= `lookup network error for ${candidate.hash}: ${error.message}`
    continue
  }

  if (lookupResult.present === true) {
    present += 1
    continue
  }
  if (lookupResult.present === null) {
    failed += 1
    firstError ??= lookupResult.error
    continue
  }

  missing += 1
  log(`missing ${candidate.hash} (${candidate.file}:${candidate.line}, context ${candidate.record.context_id})`)
  if (!SUBMIT) continue

  let submitResult
  try {
    submitResult = await submit(candidate.record)
  } catch (error) {
    failed += 1
    firstError ??= `submit network error for ${candidate.hash}: ${error.message}`
    continue
  }
  if (submitResult.ok) {
    submitted += 1
  } else {
    failed += 1
    firstError ??= submitResult.error
  }
}

log(`done: ${present} already present, ${missing} missing${SUBMIT ? `, ${submitted} submitted` : ''}, ${failed} failed`)
if (firstError) log(`first error: ${firstError}`)
process.exit(failed > 0 ? 1 : 0)
