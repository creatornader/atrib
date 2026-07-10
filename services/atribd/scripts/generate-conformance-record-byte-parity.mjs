#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0

// Generator for spec/conformance/atribd/cases/record-byte-parity/.
//
// Signs one observation, one annotation, and one revision through the
// STANDALONE primitive servers with an injected fixed key and a frozen
// Date.now, then pins the resulting signed record, its canonical-byte
// sha256, and the `_local.producer` sidecar label. The reference test in
// services/atribd/test/conformance-atribd.test.ts re-signs the same
// inputs through (a) a standalone server, (b) the daemon HTTP surface,
// and (c) the daemon alias mount, and requires byte identity with these
// fixtures on every surface.
//
// Run from services/atribd after `pnpm --filter atribd... build`:
//   node scripts/generate-conformance-record-byte-parity.mjs

import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const CORPUS_DIR = resolve(HERE, '..', '..', '..', 'spec', 'conformance', 'atribd', 'cases', 'record-byte-parity')

// The public fill(42) test seed used across the repo's fixtures.
const FIXED_SEED_BYTES = new Uint8Array(32).fill(42)
const FIXED_SEED = Buffer.from(FIXED_SEED_BYTES).toString('base64url')
const FIXED_TIMESTAMP_MS = 1781136000000
const FIXED_CONTEXT_ID = 'c0ffee00c0ffee00c0ffee00c0ffee00'
const ANNOTATES_TARGET = `sha256:${'1'.repeat(64)}`
const REVISES_TARGET = `sha256:${'2'.repeat(64)}`
const UNREACHABLE_LOG = 'http://127.0.0.1:0/v1/entries'

const CASES = [
  {
    name: 'observation-parity',
    tool: 'emit',
    producer: 'atrib-emit',
    factory: async () => (await import('@atrib/emit')).createAtribEmitServer(),
    args: {
      event_type: 'observation',
      context_id: FIXED_CONTEXT_ID,
      content: {
        what: 'atribd record-byte-parity conformance vector',
        topics: ['P046', 'record-byte-parity'],
      },
    },
  },
  {
    name: 'annotation-parity',
    tool: 'atrib-annotate',
    producer: 'atrib-annotate',
    factory: async () => (await import('@atrib/annotate')).createAtribAnnotateServer(),
    args: {
      annotates: ANNOTATES_TARGET,
      importance: 'high',
      summary: 'atribd record-byte-parity annotation vector',
      topics: ['P046'],
      context_id: FIXED_CONTEXT_ID,
    },
  },
  {
    name: 'revision-parity',
    tool: 'atrib-revise',
    producer: 'atrib-revise',
    factory: async () => (await import('@atrib/revise')).createAtribReviseServer(),
    args: {
      revises: REVISES_TARGET,
      prior_position: 'prior fixture position',
      new_position: 'revised fixture position',
      reason: 'atribd record-byte-parity revision vector',
      context_id: FIXED_CONTEXT_ID,
    },
  },
]

async function main() {
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js')
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
  const { canonicalRecord, sha256, hexEncode } = await import('@atrib/mcp')

  for (const key of Object.keys(process.env)) {
    if (key.startsWith('ATRIB_')) delete process.env[key]
  }
  delete process.env.CLAUDE_CODE_SESSION_ID
  delete process.env.CODEX_THREAD_ID
  process.env.ATRIB_PRIVATE_KEY = FIXED_SEED
  process.env.ATRIB_LOG_ENDPOINT = UNREACHABLE_LOG

  const realNow = Date.now
  Date.now = () => FIXED_TIMESTAMP_MS
  const tmp = mkdtempSync(join(tmpdir(), 'atribd-parity-gen-'))
  mkdirSync(CORPUS_DIR, { recursive: true })

  try {
    for (const spec of CASES) {
      const mirror = join(tmp, `${spec.name}.jsonl`)
      process.env.ATRIB_MIRROR_FILE = mirror
      const handle = await spec.factory()
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
      await handle.mcp.connect(serverTransport)
      const client = new Client({ name: 'parity-generator', version: '0.0.0' })
      await client.connect(clientTransport)
      const result = await client.callTool({ name: spec.tool, arguments: spec.args })
      const payload = JSON.parse(result.content[0].text)
      if (typeof payload.record_hash !== 'string' || payload.record_hash === 'sha256:unknown') {
        throw new Error(`${spec.name}: signing failed: ${JSON.stringify(payload)}`)
      }
      await handle.flush?.()
      await client.close()
      await handle.mcp.close()

      const lines = readFileSync(mirror, 'utf8').trim().split('\n')
      if (lines.length !== 1) throw new Error(`${spec.name}: expected one mirror line`)
      const envelope = JSON.parse(lines[0])
      const record = envelope.record ?? envelope
      const canonical = canonicalRecord(record)
      const canonicalSha256 = hexEncode(sha256(canonical))
      const producer = envelope._local?.producer

      const fixture = {
        name: spec.name,
        spec_section: 'P046',
        description:
          `The same ${spec.tool} call through a standalone stdio server, the daemon HTTP ` +
          'surface, and the daemon alias mount MUST produce byte-identical canonical ' +
          'records and the same _local.producer sidecar label. Fixed key (fill-42 test ' +
          'seed) and frozen timestamp make the signed bytes reproducible.',
        input: {
          tool: spec.tool,
          arguments: spec.args,
          private_key_seed_base64url: FIXED_SEED,
          timestamp_ms: FIXED_TIMESTAMP_MS,
        },
        expected: {
          record,
          record_hash: payload.record_hash,
          canonical_record_sha256: canonicalSha256,
          producer_label: producer,
        },
      }
      writeFileSync(join(CORPUS_DIR, `${spec.name}.json`), `${JSON.stringify(fixture, null, 2)}\n`)
      process.stdout.write(`wrote ${spec.name}.json (${payload.record_hash})\n`)
    }
  } finally {
    Date.now = realNow
    rmSync(tmp, { recursive: true, force: true })
  }
}

main().catch((error) => {
  process.stderr.write(`generate-conformance-record-byte-parity: ${error?.stack ?? error}\n`)
  process.exit(1)
})
