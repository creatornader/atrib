#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0

// Generator for the read-side families of spec/conformance/attest-recall/:
//
//   read-equivalence/   one fixed mirror fixture plus a vector per legacy
//                       read tool. The consuming test runs each vector
//                       through the legacy tool name AND the `recall` verb
//                       and requires JSON-identical results (same process,
//                       same frozen clock), plus Pattern 3 verification
//                       accept / reject vectors and record_hash presence.
//   persisted-labels/   the mirror carries `_local.producer` labels from
//                       both vocabularies (legacy and attest families);
//                       expectations.json pins the label set readers MUST
//                       accept, and mixed-calls.jsonl carries a D084
//                       calls.jsonl fixture mixing legacy tool names with
//                       recall:<shape> values.
//
// Run from services/atrib-recall after `pnpm --filter @atrib/recall... build`
// and `pnpm --filter @atrib/attest build`:
//   node scripts/generate-conformance-read-equivalence.mjs

import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const CORPUS_DIR = resolve(HERE, '..', '..', '..', 'spec', 'conformance', 'attest-recall', 'cases')
const READ_DIR = join(CORPUS_DIR, 'read-equivalence')
const LABELS_DIR = join(CORPUS_DIR, 'persisted-labels')

const FIXED_SEED_BYTES = new Uint8Array(32).fill(42)
const FIXED_SEED = Buffer.from(FIXED_SEED_BYTES).toString('base64url')
const BASE_TIMESTAMP_MS = 1783641600000
// The consuming test freezes its clock here so `age` strings are stable.
const QUERY_TIMESTAMP_MS = 1783645200000
const CONTEXT_A = 'a11ce000a11ce000a11ce000a11ce000'
const CONTEXT_B = 'b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0'
const UNREACHABLE_LOG = 'http://127.0.0.1:0/v1/entries'

async function main() {
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js')
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
  const attest = await import('../../atrib-attest/dist/index.js')

  for (const key of Object.keys(process.env)) {
    if (key.startsWith('ATRIB_')) delete process.env[key]
  }
  delete process.env.CLAUDE_CODE_SESSION_ID
  delete process.env.CODEX_THREAD_ID
  process.env.ATRIB_PRIVATE_KEY = FIXED_SEED
  process.env.ATRIB_LOG_ENDPOINT = UNREACHABLE_LOG

  mkdirSync(READ_DIR, { recursive: true })
  mkdirSync(LABELS_DIR, { recursive: true })
  const mirror = join(READ_DIR, 'mirror.jsonl')
  rmSync(mirror, { force: true })
  process.env.ATRIB_MIRROR_FILE = mirror

  const handle = await attest.createAtribAttestServer()
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await handle.mcp.connect(serverTransport)
  const client = new Client({ name: 'read-equivalence-generator', version: '0.0.0' })
  await client.connect(clientTransport)

  const realNow = Date.now
  let step = 0
  const nextClock = () => {
    Date.now = () => BASE_TIMESTAMP_MS + step * 1000
    step += 1
  }

  const sign = async (tool, args) => {
    nextClock()
    const result = await client.callTool({ name: tool, arguments: args })
    const payload = JSON.parse(result.content[0].text)
    if (typeof payload.record_hash !== 'string' || payload.record_hash === 'sha256:unknown') {
      throw new Error(`${tool}: signing failed: ${JSON.stringify(payload)}`)
    }
    return payload.record_hash
  }

  let r1, r2, r3, r4, r5, r6, r7
  try {
    // r1: observation, legacy emit tool -> producer 'atrib-emit'.
    r1 = await sign('emit', {
      event_type: 'observation',
      context_id: CONTEXT_A,
      content: {
        what: 'design decision alpha: prefer the two-verb surface',
        why_noted: 'read-equivalence conformance fixture',
        topics: ['alpha', 'conformance'],
      },
    })
    // r2: observation citing r1, attest verb -> producer 'atrib-attest'.
    r2 = await sign('attest', {
      context_id: CONTEXT_A,
      content: {
        what: 'follow-up beta builds on alpha',
        topics: ['beta'],
      },
      informed_by: [r1],
    })
    // r3: annotation on r1, legacy tool -> producer 'atrib-annotate'.
    r3 = await sign('atrib-annotate', {
      annotates: r1,
      importance: 'critical',
      summary: 'alpha shaped the read-surface collapse',
      topics: ['alpha', 'conformance'],
      context_id: CONTEXT_A,
    })
    // r4: revision of r2, legacy tool -> producer 'atrib-revise'.
    r4 = await sign('atrib-revise', {
      revises: r2,
      prior_position: 'beta builds on alpha unconditionally',
      new_position: 'beta builds on alpha only through the alias window',
      reason: 'read-equivalence conformance fixture revision',
      context_id: CONTEXT_A,
    })
    // r5: sibling revision of r2, attest verb with a CLI-family label.
    r5 = await sign('attest', {
      ref: {
        kind: 'revises',
        target: r2,
        reason: 'sibling branch for fan-out coverage',
      },
      content: {
        prior_position: 'beta builds on alpha unconditionally',
        new_position: 'beta is superseded by gamma',
      },
      context_id: CONTEXT_A,
      producer: 'atrib-attest-cli',
    })
    // r6: observation in a second context, hook-stamped producer label.
    r6 = await sign('attest', {
      context_id: CONTEXT_B,
      content: {
        what: 'context-b loose end nothing cites',
        topics: ['loose-end'],
      },
      producer: 'claude-hooks-builtin-2b',
    })
    // r7: observation in context A citing r4, legacy emit-cli label.
    r7 = await sign('attest', {
      context_id: CONTEXT_A,
      content: {
        what: 'gamma consolidates the revised beta position',
        topics: ['gamma'],
      },
      informed_by: [r4],
      producer: 'atrib-emit-cli',
    })
  } finally {
    Date.now = realNow
  }

  await handle.flush?.()
  await client.close()
  await handle.mcp.close()

  // Pin the mirror-derived facts the consuming tests key on.
  const mirrorLines = readFileSync(mirror, 'utf8').trim().split('\n')
  if (mirrorLines.length !== 7) {
    throw new Error(`expected 7 mirror lines, got ${mirrorLines.length}`)
  }
  const producers = mirrorLines.map((line) => JSON.parse(line)._local?.producer)

  const vectors = {
    name: 'read-equivalence-vectors',
    spec_section: 'attest-recall rename (P047 promotion)',
    description:
      'Each vector runs one legacy read tool and the `recall` verb mapping onto it against ' +
      'the fixed mirror fixture. Result sets and ordering MUST match JSON-for-JSON when both ' +
      'run in one process at one frozen wall-clock instant. Every compact result keeps ' +
      'record_hash so calls can be chained (D084).',
    mirror_file: 'mirror.jsonl',
    query_timestamp_ms: QUERY_TIMESTAMP_MS,
    record_hashes: { r1, r2, r3, r4, r5, r6, r7 },
    vectors: [
      {
        name: 'history',
        legacy: { tool: 'recall_my_attribution_history', arguments: { limit: 50 } },
        recall: { shape: 'history', limit: 50 },
      },
      {
        name: 'history-filtered',
        legacy: {
          tool: 'recall_my_attribution_history',
          arguments: { context_id: CONTEXT_A, event_type: 'observation', limit: 10 },
        },
        recall: {
          shape: 'history',
          filters: { context_id: CONTEXT_A, event_type: 'observation' },
          limit: 10,
        },
      },
      {
        name: 'walk-graph',
        legacy: { tool: 'recall_walk', arguments: { from_record_hash: r1, depth: 3 } },
        recall: { shape: 'walk', start: r1, depth: 3 },
      },
      {
        name: 'walk-trace-backward',
        legacy: { tool: 'trace', arguments: { record_hash: r7, depth: 3, compact: true } },
        recall: { shape: 'walk', direction: 'backward', start: r7, depth: 3, compact: true },
      },
      {
        name: 'walk-trace-forward',
        legacy: { tool: 'trace_forward', arguments: { record_hash: r1, depth: 3, compact: true } },
        recall: { shape: 'walk', direction: 'forward', start: r1, depth: 3, compact: true },
      },
      {
        name: 'content',
        legacy: { tool: 'recall_by_content', arguments: { query: 'alpha two-verb surface', k: 5 } },
        recall: { shape: 'content', query: 'alpha two-verb surface', limit: 5 },
      },
      {
        name: 'chain',
        legacy: { tool: 'recall_session_chain', arguments: { context_id: CONTEXT_A, limit: 50 } },
        recall: { shape: 'chain', filters: { context_id: CONTEXT_A }, limit: 50 },
      },
      {
        name: 'annotations',
        legacy: { tool: 'recall_annotations', arguments: { record_hash: r1 } },
        recall: { shape: 'annotations', start: r1 },
      },
      {
        name: 'revisions',
        legacy: { tool: 'recall_revisions', arguments: { record_hash: r2 } },
        recall: { shape: 'revisions', start: r2 },
      },
      {
        name: 'orphans',
        legacy: { tool: 'recall_orphans', arguments: { context_id: CONTEXT_B, limit: 50 } },
        recall: { shape: 'orphans', filters: { context_id: CONTEXT_B }, limit: 50 },
      },
      {
        name: 'by_signer',
        legacy: { tool: 'recall_by_signer', arguments: { min_records: 1 } },
        recall: { shape: 'by_signer', min_records: 1 },
      },
    ],
    verification: [
      {
        name: 'handoff-accept',
        description:
          'A mirror envelope with a valid signature and a matching required hash MUST be accepted.',
        arguments: {
          shape: 'annotations',
          start: r1,
          verification: {
            mode: 'handoff',
            records: [JSON.parse(mirrorLines[0])],
            required_record_hashes: [r1],
          },
        },
        expected: { status: 'ok', all_accepted: true, accepted_record_hashes: [r1] },
      },
      {
        name: 'handoff-reject-missing',
        description:
          'A required hash with no matching evidence MUST surface as a verifier rejection.',
        arguments: {
          verification: {
            mode: 'handoff',
            records: [],
            required_record_hashes: [`sha256:${'f'.repeat(64)}`],
          },
        },
        expected: { status: 'ok', all_accepted: false },
      },
      {
        name: 'verifier-absent-degrades',
        description:
          'With the optional @atrib/verify peer unresolvable, the verification block MUST be ' +
          'the typed verifier_unavailable result and the read result MUST be unchanged.',
        arguments: {
          shape: 'annotations',
          start: r1,
          verification: { mode: 'handoff', records: [], required_record_hashes: [r1] },
        },
        expected: { status: 'verifier_unavailable' },
      },
    ],
  }
  writeFileSync(join(READ_DIR, 'vectors.json'), `${JSON.stringify(vectors, null, 2)}\n`)
  process.stdout.write(`wrote read-equivalence/vectors.json (mirror: 7 records)\n`)

  const labels = {
    name: 'persisted-labels',
    spec_section: 'attest-recall rename (P047 promotion)',
    description:
      '`_local.producer` is an opaque pass-through, permanently (L1). The shared mirror ' +
      'fixture mixes legacy and attest-family labels; readers MUST accept the union and ' +
      'never filter or join on hardcoded producer equality. mixed-calls.jsonl mixes legacy ' +
      'tool names with recall:<shape> values in the D084 `primitive` field; analyzers MUST ' +
      'accept both vocabularies (L2) and never rewrite history.',
    mirror_file: '../read-equivalence/mirror.jsonl',
    expected: {
      producer_labels: producers,
      distinct_labels_accepted: [
        'atrib-annotate',
        'atrib-attest',
        'atrib-attest-cli',
        'atrib-emit',
        'atrib-emit-cli',
        'atrib-revise',
        'claude-hooks-builtin-2b',
      ],
    },
  }
  writeFileSync(join(LABELS_DIR, 'expectations.json'), `${JSON.stringify(labels, null, 2)}\n`)

  const mixedCalls = [
    {
      invoked_at: QUERY_TIMESTAMP_MS,
      session_id: CONTEXT_A,
      primitive: 'recall_my_attribution_history',
      query_shape: ['limit'],
      result_count: 5,
      elapsed_ms: 12,
      sample_result_hashes: [r1, r2],
      errored: false,
    },
    {
      invoked_at: QUERY_TIMESTAMP_MS + 1000,
      session_id: CONTEXT_A,
      primitive: 'trace',
      query_shape: ['depth', 'record_hash'],
      result_count: 2,
      elapsed_ms: 8,
      sample_result_hashes: [r7],
      errored: false,
    },
    {
      invoked_at: QUERY_TIMESTAMP_MS + 2000,
      session_id: CONTEXT_A,
      primitive: 'recall:history',
      query_shape: ['limit', 'shape'],
      result_count: 5,
      elapsed_ms: 11,
      sample_result_hashes: [r1, r2],
      errored: false,
    },
    {
      invoked_at: QUERY_TIMESTAMP_MS + 3000,
      session_id: CONTEXT_A,
      primitive: 'recall:walk',
      query_shape: ['direction', 'shape', 'start'],
      result_count: 2,
      elapsed_ms: 9,
      sample_result_hashes: [r7],
      errored: false,
    },
    {
      invoked_at: QUERY_TIMESTAMP_MS + 4000,
      session_id: null,
      primitive: 'recall:verification',
      query_shape: ['verification'],
      result_count: 1,
      elapsed_ms: 20,
      sample_result_hashes: [r1],
      errored: false,
    },
  ]
  writeFileSync(
    join(LABELS_DIR, 'mixed-calls.jsonl'),
    mixedCalls.map((line) => JSON.stringify(line)).join('\n') + '\n',
  )
  process.stdout.write('wrote persisted-labels/expectations.json + mixed-calls.jsonl\n')
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`)
  process.exit(1)
})
