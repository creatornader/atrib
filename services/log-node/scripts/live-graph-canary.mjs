#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0

import {
  base64urlDecode,
  base64urlEncode,
  canonicalRecord,
  computeContentId,
  genesisChainRoot,
  getPublicKey,
  hexEncode,
  sha256,
  signRecord,
} from '@atrib/mcp'

const DEFAULT_LOG_ENDPOINT = 'https://log.atrib.dev/v1'
const DEFAULT_GRAPH_ENDPOINT = 'https://graph.atrib.dev/v1'
const DEFAULT_TIMEOUT_MS = 90_000
const DEFAULT_POLL_DELAY_MS = 2_000
const CANARY_TOOL_NAME = 'live_graph_canary'
const CANARY_SERVER_URL = 'mcp://atrib-live-graph-canary.local'
const CANARY_SEED_LABEL = 'atrib-live-graph-canary-v1-public-non-authoritative-signer'

function normalizeEndpoint(value) {
  return String(value ?? '').replace(/\/$/, '')
}

function readPositiveInt(value, fallback) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function defaultCanarySeed() {
  return sha256(new TextEncoder().encode(CANARY_SEED_LABEL))
}

function readCanarySeed(env = process.env) {
  const configured = env.ATRIB_GRAPH_CANARY_KEY
  if (!configured) return defaultCanarySeed()
  const decoded = base64urlDecode(configured)
  if (decoded.length !== 32) {
    throw new Error(`ATRIB_GRAPH_CANARY_KEY must decode to 32 bytes, got ${decoded.length}`)
  }
  return decoded
}

function randomContextId() {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return hexEncode(bytes)
}

export async function buildCanaryRecord({
  seed = defaultCanarySeed(),
  now = () => Date.now(),
  contextId = randomContextId(),
} = {}) {
  const timestamp = now()
  const nonce = `${contextId}:${timestamp}`
  const creatorKey = base64urlEncode(await getPublicKey(seed))
  const unsigned = {
    spec_version: 'atrib/1.0',
    event_type: 'https://atrib.dev/v1/types/tool_call',
    timestamp,
    context_id: contextId,
    chain_root: genesisChainRoot(contextId),
    content_id: computeContentId(CANARY_SERVER_URL, CANARY_TOOL_NAME),
    args_hash: `sha256:${hexEncode(sha256(new TextEncoder().encode(nonce)))}`,
    tool_name: CANARY_TOOL_NAME,
    creator_key: creatorKey,
    signature: '',
  }
  const record = await signRecord(unsigned, seed)
  return {
    record,
    record_hash: `sha256:${hexEncode(sha256(canonicalRecord(record)))}`,
  }
}

async function readJson(response, label) {
  let body
  try {
    body = await response.json()
  } catch {
    body = null
  }
  if (!response.ok) {
    throw new Error(`${label} returned ${response.status}: ${JSON.stringify(body)}`)
  }
  return body
}

function traceHasRecord(traceBody, recordHash, logIndex) {
  if (traceBody?.start_record_hash !== recordHash) return false
  const nodes = traceBody?.graph?.nodes
  if (!Array.isArray(nodes)) return false
  return nodes.some((node) => node?.id === recordHash && node?.log_index === logIndex)
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function runLiveGraphCanary({
  logEndpoint = DEFAULT_LOG_ENDPOINT,
  graphEndpoint = DEFAULT_GRAPH_ENDPOINT,
  seed = defaultCanarySeed(),
  now = () => Date.now(),
  contextId = randomContextId(),
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  pollDelayMs = DEFAULT_POLL_DELAY_MS,
} = {}) {
  const logBase = normalizeEndpoint(logEndpoint)
  const graphBase = normalizeEndpoint(graphEndpoint)
  const { record, record_hash: recordHash } = await buildCanaryRecord({ seed, now, contextId })

  const submitResponse = await fetchImpl(`${logBase}/entries`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(record),
  })
  const proof = await readJson(submitResponse, 'log submit')
  const logIndex = proof?.log_index
  if (!Number.isInteger(logIndex)) {
    throw new Error(`log submit response missing numeric log_index: ${JSON.stringify(proof)}`)
  }

  const deadline = Date.now() + timeoutMs
  let attempts = 0
  let lastStatus = 'not-requested'
  while (Date.now() <= deadline) {
    attempts += 1
    const traceResponse = await fetchImpl(`${graphBase}/trace/${recordHash}`)
    lastStatus = String(traceResponse.status)
    if (traceResponse.ok) {
      const traceBody = await traceResponse.json()
      if (traceHasRecord(traceBody, recordHash, logIndex)) {
        return {
          record_hash: recordHash,
          context_id: record.context_id,
          creator_key: record.creator_key,
          log_index: logIndex,
          attempts,
        }
      }
    }
    await delay(pollDelayMs)
  }

  throw new Error(
    `graph did not index canary ${recordHash} at log_index ${logIndex} after ${attempts} attempts; last_status=${lastStatus}`,
  )
}

async function main() {
  const result = await runLiveGraphCanary({
    logEndpoint: process.env.LOG_ENDPOINT ?? DEFAULT_LOG_ENDPOINT,
    graphEndpoint: process.env.GRAPH_ENDPOINT ?? DEFAULT_GRAPH_ENDPOINT,
    seed: readCanarySeed(),
    timeoutMs: readPositiveInt(process.env.GRAPH_CANARY_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    pollDelayMs: readPositiveInt(process.env.GRAPH_CANARY_POLL_DELAY_MS, DEFAULT_POLL_DELAY_MS),
  })
  console.log(JSON.stringify({ ok: true, ...result }))
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
}
