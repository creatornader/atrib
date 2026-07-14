#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0

// Generator for the write-side families of spec/conformance/attest-recall/:
//
//   byte-identity/     the same statement signed through a legacy write name
//                      and through `attest` MUST produce byte-identical
//                      canonical records (fixed fill-42 key, frozen clock,
//                      fixed context). Plus one pre-rename historical record
//                      that MUST verify unchanged forever.
//   frozen-constants/  pins 'mcp://atrib-emit', the six normative event-type
//                      URIs and bytes, and the content_id per emit-family
//                      event kind. Renaming any of these would fork
//                      content_id groupings across the rename date.
//
// The ref-mapping/ family is static (adversarial inputs + expected
// refusals) and lives in the corpus directly; this generator does not
// touch it.
//
// Run from services/atrib-attest after `pnpm --filter @atrib/attest... build`:
//   node scripts/generate-conformance-attest-recall.mjs

import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const CORPUS_DIR = resolve(HERE, '..', '..', '..', 'spec', 'conformance', 'attest-recall', 'cases')

const FIXED_SEED_BYTES = new Uint8Array(32).fill(42)
const FIXED_SEED = Buffer.from(FIXED_SEED_BYTES).toString('base64url')
const FIXED_TIMESTAMP_MS = 1783641600000
const FIXED_CONTEXT_ID = 'a77e57a77e57a77e57a77e57a77e57a0'
const ANNOTATES_TARGET = `sha256:${'1'.repeat(64)}`
const REVISES_TARGET = `sha256:${'2'.repeat(64)}`
const UNREACHABLE_LOG = 'http://127.0.0.1:0/v1/entries'

// One statement per relationship kind, expressed in both vocabularies.
const CASES = [
  {
    name: 'observation-identity',
    legacyTool: 'emit',
    legacyArgs: {
      event_type: 'observation',
      context_id: FIXED_CONTEXT_ID,
      content: {
        what: 'attest-recall byte-identity conformance vector',
        topics: ['P047', 'byte-identity'],
      },
    },
    attestArgs: {
      context_id: FIXED_CONTEXT_ID,
      content: {
        what: 'attest-recall byte-identity conformance vector',
        topics: ['P047', 'byte-identity'],
      },
    },
    eventType: 'https://atrib.dev/v1/types/observation',
  },
  {
    name: 'annotation-identity',
    legacyTool: 'atrib-annotate',
    legacyArgs: {
      annotates: ANNOTATES_TARGET,
      importance: 'high',
      summary: 'attest-recall byte-identity annotation vector',
      topics: ['P047'],
      context_id: FIXED_CONTEXT_ID,
    },
    attestArgs: {
      ref: { kind: 'annotates', target: ANNOTATES_TARGET },
      content: {
        importance: 'high',
        summary: 'attest-recall byte-identity annotation vector',
        topics: ['P047'],
      },
      context_id: FIXED_CONTEXT_ID,
    },
    eventType: 'https://atrib.dev/v1/types/annotation',
  },
  {
    name: 'revision-identity',
    legacyTool: 'atrib-revise',
    legacyArgs: {
      revises: REVISES_TARGET,
      prior_position: 'prior fixture position',
      new_position: 'revised fixture position',
      reason: 'attest-recall byte-identity revision vector',
      context_id: FIXED_CONTEXT_ID,
    },
    attestArgs: {
      ref: {
        kind: 'revises',
        target: REVISES_TARGET,
        reason: 'attest-recall byte-identity revision vector',
      },
      content: {
        prior_position: 'prior fixture position',
        new_position: 'revised fixture position',
      },
      context_id: FIXED_CONTEXT_ID,
    },
    eventType: 'https://atrib.dev/v1/types/revision',
  },
]

async function signOnce(tool, args, expectProducer) {
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js')
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
  const { createAtribAttestServer } = await import('../dist/index.js')

  const caseTmp = mkdtempSync(join(tmpdir(), `attest-recall-gen-`))
  const mirror = join(caseTmp, 'mirror.jsonl')
  process.env.ATRIB_MIRROR_FILE = mirror

  const handle = await createAtribAttestServer()
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await handle.mcp.connect(serverTransport)
  const client = new Client({ name: 'attest-recall-generator', version: '0.0.0' })
  await client.connect(clientTransport)
  const result = await client.callTool({ name: tool, arguments: args })
  const payload = JSON.parse(result.content[0].text)
  if (typeof payload.record_hash !== 'string' || payload.record_hash === 'sha256:unknown') {
    throw new Error(`${tool}: signing failed: ${JSON.stringify(payload)}`)
  }
  await handle.flush?.()
  await client.close()
  await handle.mcp.close()

  const lines = readFileSync(mirror, 'utf8').trim().split('\n')
  if (lines.length !== 1) throw new Error(`${tool}: expected one mirror line`)
  const envelope = JSON.parse(lines[0])
  rmSync(caseTmp, { recursive: true, force: true })
  const producer = envelope._local?.producer
  if (expectProducer && producer !== expectProducer) {
    throw new Error(`${tool}: expected producer ${expectProducer}, got ${producer}`)
  }
  return { record: envelope.record ?? envelope, record_hash: payload.record_hash, producer }
}

async function main() {
  const { canonicalRecord, sha256, hexEncode, computeContentId } = await import('@atrib/mcp')

  for (const key of Object.keys(process.env)) {
    if (key.startsWith('ATRIB_')) delete process.env[key]
  }
  delete process.env.CLAUDE_CODE_SESSION_ID
  delete process.env.CODEX_THREAD_ID
  process.env.ATRIB_PRIVATE_KEY = FIXED_SEED
  process.env.ATRIB_LOG_ENDPOINT = UNREACHABLE_LOG

  const realNow = Date.now
  Date.now = () => FIXED_TIMESTAMP_MS

  try {
    mkdirSync(join(CORPUS_DIR, 'byte-identity'), { recursive: true })
    mkdirSync(join(CORPUS_DIR, 'frozen-constants'), { recursive: true })

    for (const spec of CASES) {
      const legacy = await signOnce(spec.legacyTool, spec.legacyArgs)
      const attest = await signOnce('attest', spec.attestArgs, 'atrib-attest')

      const legacyCanonical = canonicalRecord(legacy.record)
      const attestCanonical = canonicalRecord(attest.record)
      if (Buffer.compare(Buffer.from(legacyCanonical), Buffer.from(attestCanonical)) !== 0) {
        throw new Error(
          `${spec.name}: canonical bytes diverge between ${spec.legacyTool} and attest`,
        )
      }
      const canonicalSha256 = hexEncode(sha256(legacyCanonical))

      const fixture = {
        name: spec.name,
        spec_section: 'attest-recall rename (P047 promotion)',
        description:
          `The same statement signed through the legacy ${spec.legacyTool} tool and through ` +
          '`attest` MUST produce byte-identical canonical records and signatures given ' +
          'identical key, timestamp, and chain inputs. Only the `_local.producer` sidecar ' +
          'label differs (persisted-label rule L1). Fixed fill-42 test seed and frozen ' +
          'timestamp make the signed bytes reproducible.',
        input: {
          legacy: { tool: spec.legacyTool, arguments: spec.legacyArgs },
          attest: { tool: 'attest', arguments: spec.attestArgs },
          private_key_seed_base64url: FIXED_SEED,
          timestamp_ms: FIXED_TIMESTAMP_MS,
        },
        expected: {
          event_type: spec.eventType,
          record: legacy.record,
          record_hash: legacy.record_hash,
          canonical_record_sha256: canonicalSha256,
          legacy_producer_label: legacy.producer,
          attest_producer_label: 'atrib-attest',
        },
      }
      writeFileSync(
        join(CORPUS_DIR, 'byte-identity', `${spec.name}.json`),
        `${JSON.stringify(fixture, null, 2)}\n`,
      )
      process.stdout.write(`wrote byte-identity/${spec.name}.json (${legacy.record_hash})\n`)
    }

    // Pre-rename historical fixture: the observation vector from the D148
    // atribd corpus, signed before the rename landed. Post-rename verifiers
    // MUST accept it unchanged, forever.
    const historicalSource = JSON.parse(
      readFileSync(
        resolve(
          HERE,
          '..',
          '..',
          '..',
          'spec',
          'conformance',
          'atribd',
          'cases',
          'record-byte-parity',
          'observation-parity.json',
        ),
        'utf8',
      ),
    )
    const historical = {
      name: 'historical-pre-rename-record',
      spec_section: 'attest-recall rename (P047 promotion)',
      description:
        'A record signed through the pre-rename emit surface (pinned in the D148 atribd ' +
        'corpus before the attest/recall rename landed). Post-rename verifiers MUST verify ' +
        'it unchanged: the rename touches tool names, package names, exports, and docs; ' +
        'zero signed bytes.',
      input: { record: historicalSource.expected.record },
      expected: {
        record_hash: historicalSource.expected.record_hash,
        signature_valid: true,
      },
    }
    writeFileSync(
      join(CORPUS_DIR, 'byte-identity', 'historical-pre-rename-record.json'),
      `${JSON.stringify(historical, null, 2)}\n`,
    )
    process.stdout.write('wrote byte-identity/historical-pre-rename-record.json\n')

    // Frozen constants: the synthetic server URL, the six normative
    // event-type URIs and their log-entry bytes, and the derived content_id
    // per emit-family event kind. These are opaque historical constants;
    // renaming any of them would fork content_id groupings for zero
    // verifier value.
    const SYNTHETIC_SERVER_URL = 'mcp://atrib-emit'
    const frozen = {
      name: 'frozen-constants',
      spec_section: 'attest-recall rename (P047 promotion)',
      description:
        "SYNTHETIC_SERVER_URL is frozen permanently as an opaque historical constant, " +
        'including inside @atrib/attest. The six normative event-type URIs, their log-entry ' +
        'bytes, and the content_id derivation are pinned with it.',
      expected: {
        synthetic_server_url: SYNTHETIC_SERVER_URL,
        event_types: {
          tool_call: { uri: 'https://atrib.dev/v1/types/tool_call', byte: '0x01' },
          transaction: { uri: 'https://atrib.dev/v1/types/transaction', byte: '0x02' },
          observation: { uri: 'https://atrib.dev/v1/types/observation', byte: '0x03' },
          directory_anchor: { uri: 'https://atrib.dev/v1/types/directory_anchor', byte: '0x04' },
          annotation: { uri: 'https://atrib.dev/v1/types/annotation', byte: '0x05' },
          revision: { uri: 'https://atrib.dev/v1/types/revision', byte: '0x06' },
        },
        content_ids: {
          observation: computeContentId(SYNTHETIC_SERVER_URL, 'observation'),
          annotation: computeContentId(SYNTHETIC_SERVER_URL, 'annotation'),
          revision: computeContentId(SYNTHETIC_SERVER_URL, 'revision'),
        },
      },
    }
    writeFileSync(
      join(CORPUS_DIR, 'frozen-constants', 'frozen-constants.json'),
      `${JSON.stringify(frozen, null, 2)}\n`,
    )
    process.stdout.write('wrote frozen-constants/frozen-constants.json\n')
  } finally {
    Date.now = realNow
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`)
  process.exit(1)
})
