// SPDX-License-Identifier: Apache-2.0

import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  redactUpstreamDiagnostic,
  runWrappedMcpPacket,
  type WrappedMcpPacketResult,
} from '../examples/wrapped-mcp-proof-runner.js'

const execFileAsync = promisify(execFile)
const workspaceRoot = join(process.cwd(), '..', '..')
const tsxBin = join(
  workspaceRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'tsx.cmd' : 'tsx',
)

async function runPacket(
  script: string,
  outPrefix: string,
  envOverrides: Record<string, string> = {},
) {
  const outDir = mkdtempSync(join(tmpdir(), outPrefix))
  try {
    const { stdout } = await execFileAsync(tsxBin, [script], {
      cwd: process.cwd(),
      timeout: 60000,
      maxBuffer: 1024 * 1024,
      env: {
        ...process.env,
        ATRIB_PACKET_OUT_DIR: outDir,
        ...envOverrides,
      },
    })
    return {
      outDir,
      stdout,
      result: JSON.parse(stdout.trim()) as WrappedMcpPacketResult & {
        artifact_dir: string
        policy_decision?: {
          artifact: string
          decision: string
          decision_hash: string
          signed_policy_record?: boolean
          signed_control_record_hash?: string | null
        }
        source_e2e?: boolean
        recognized_title_transfer?: boolean
        public_relay_events_available?: boolean
        title_authority_attested?: boolean
        legal_mletr_attested?: boolean
        authorization_basis?: string
      },
      cleanup: () => rmSync(outDir, { recursive: true, force: true }),
    }
  } catch (err) {
    rmSync(outDir, { recursive: true, force: true })
    throw err
  }
}

function artifactText(
  outDir: string,
  files = ['README.md', 'verifier-output.json', 'redaction-manifest.json'],
): string {
  return files
    .map((file) => {
      const path = join(outDir, file)
      expect(existsSync(path)).toBe(true)
      return readFileSync(path, 'utf8')
    })
    .join('\n')
}

describe('MCP platform proof packets', () => {
  beforeAll(async () => {
    await execFileAsync('pnpm', ['--filter', '@atrib/mcp', 'build'], {
      cwd: workspaceRoot,
      timeout: 60000,
      maxBuffer: 1024 * 1024,
    })
    await execFileAsync('pnpm', ['--filter', '@atrib/mcp-wrap', 'build'], {
      cwd: workspaceRoot,
      timeout: 60000,
      maxBuffer: 1024 * 1024,
    })
  }, 60000)

  it('generates a Browserbase Stagehand packet with hash-only public records', async () => {
    const run = await runPacket(
      'examples/browserbase-stagehand/browserbase-stagehand-packet-smoke.ts',
      'atrib-browserbase-packet-',
    )
    try {
      expect(run.result.ok).toBe(true)
      expect(run.result.packet).toBe('browserbase-stagehand')
      expect(run.result.signed_records).toBe(6)
      expect(run.result.operations).toEqual([
        'start',
        'navigate',
        'observe',
        'act',
        'extract',
        'end',
      ])
      expect(run.result.record_hashes).toHaveLength(6)
      expect(run.result.log_indexes).toEqual([0, 1, 2, 4, 6, 7])
      expect(run.result.action_policy).toMatchObject({
        stopped_before: null,
        blocked_tool_executed: false,
      })
      expect(run.result.action_policy?.decisions[0]?.content).toMatchObject({
        decision: 'allow',
        reason_codes: ['policy_allow'],
      })
      expect(run.result.action_policy?.outcomes[0]?.content).toMatchObject({
        decision: 'allow',
        executed: true,
      })
      expect(run.result.action_policy?.decisions[0]?.record_hash).toMatch(/^sha256:[0-9a-f]{64}$/)
      expect(run.result.action_policy?.outcomes[0]?.record_hash).toMatch(/^sha256:[0-9a-f]{64}$/)
      expect(run.result.action_policy?.decisions[0]?.record_valid).toBe(true)
      expect(run.result.action_policy?.outcomes[0]?.record_valid).toBe(true)
      expect(run.result.action_policy?.decisions[0]?.proof.log_index).toBe(3)
      expect(run.result.action_policy?.outcomes[0]?.proof.log_index).toBe(5)
      expect(run.result.verifier.record_valid).toBe(true)
      expect(run.result.privacy.public_records_hash_only).toBe(true)

      const text = `${run.stdout}\n${artifactText(run.outDir)}`
      for (const needle of [
        'bb_session_private_20260623',
        'https://browserbase.example.invalid/sessions/private-replay-20260623',
        '#private-checkout-control',
        'private browserbase note',
        '<html><body><button id="private-checkout-control">Ship</button></body></html>',
        'Internal quote: private browserbase note',
      ]) {
        expect(text).not.toContain(needle)
      }
    } finally {
      run.cleanup()
    }
  }, 60000)

  it('generates a Firecrawl ingestion packet with a bounded crawl record', async () => {
    const run = await runPacket(
      'examples/firecrawl-web-ingestion/firecrawl-web-ingestion-packet-smoke.ts',
      'atrib-firecrawl-packet-',
    )
    try {
      expect(run.result.ok).toBe(true)
      expect(run.result.packet).toBe('firecrawl-web-ingestion')
      expect(run.result.signed_records).toBe(4)
      expect(run.result.operations).toEqual([
        'firecrawl_search',
        'firecrawl_scrape',
        'firecrawl_extract',
        'firecrawl_crawl',
      ])
      expect(run.result.record_hashes).toHaveLength(4)
      expect(run.result.log_indexes).toEqual([0, 1, 2, 3])
      expect(run.result.verifier.record_valid).toBe(true)
      expect(run.result.privacy.public_records_hash_only).toBe(true)
      expect(run.result.action_policy).toMatchObject({
        schema: 'atrib.packet.action_policy.v1',
        stopped_before: 'customer_email',
        blocked_tool_executed: false,
      })
      expect(run.result.action_policy?.decisions[0]).toMatchObject({
        kind: 'policy_decision',
        tool_name: 'customer_email',
        event_type: 'https://firecrawl-ingestion-policy.atrib.dev/v1/decision',
        record_valid: true,
      })
      expect(run.result.action_policy?.decisions[0]?.content).toMatchObject({
        decision: 'escalate',
        action_tool: 'customer_email',
        decision_boundary: 'post_ingestion_pre_downstream_action',
      })
      expect(run.result.action_policy?.outcomes[0]).toMatchObject({
        kind: 'policy_outcome',
        tool_name: 'customer_email',
        record_valid: true,
      })
      expect(run.result.action_policy?.outcomes[0]?.content).toMatchObject({
        decision: 'escalate',
        executed: false,
        stopped_before: 'customer_email',
      })
      expect(run.result.policy_decision).toMatchObject({
        artifact: 'policy-decision.json',
        decision: 'escalate_before_customer_email',
        signed_policy_record: true,
      })
      expect(run.result.policy_decision?.decision_hash).toMatch(/^sha256:[0-9a-f]{64}$/u)
      expect(run.result.policy_decision?.signed_control_record_hash).toMatch(
        /^sha256:[0-9a-f]{64}$/u,
      )

      const text = `${run.stdout}\n${artifactText(run.outDir, [
        'README.md',
        'verifier-output.json',
        'redaction-manifest.json',
        'policy-decision.json',
      ])}`
      expect(text).toContain('signed_ingestion_records_present')
      expect(text).toContain('bounded_crawl_cap_present')
      expect(text).toContain('signed_atrib_control_record_policy_decision')
      expect(text).toContain('raw_web_content_private')
      expect(text).toContain('customer_message_requires_review')
      expect(text).toContain('escalate_before_customer_email')
      for (const needle of [
        'private acquisition research query',
        'https://example.invalid/private-firecrawl-source',
        'Confidential pricing: private firecrawl text',
        '<main><h1>Private vendor page</h1><p>Confidential pricing</p></main>',
        'private firecrawl extracted account note',
        'crawl_private_job_20260623',
      ]) {
        expect(text).not.toContain(needle)
      }
    } finally {
      run.cleanup()
    }
  }, 60000)

  it('generates an OpenETR transfer packet with recognition gated', async () => {
    const run = await runPacket(
      'examples/openetr-transfer/openetr-transfer-packet-smoke.ts',
      'atrib-openetr-packet-',
      { OPENETR_SOURCE_DIR: '', ATRIB_OPENETR_SOURCE_E2E: '' },
    )
    try {
      expect(run.result.ok).toBe(true)
      expect(run.result.packet).toBe('openetr-transfer')
      expect(run.result.signed_records).toBe(4)
      expect(run.result.operations).toEqual([
        'openetr_issue',
        'openetr_transfer_initiate',
        'openetr_transfer_accept',
        'openetr_query_state',
      ])
      expect(run.result.record_hashes).toHaveLength(4)
      expect(run.result.log_indexes).toEqual([0, 1, 2, 3])
      expect(run.result.action_policy).toMatchObject({
        stopped_before: 'openetr_recognize_title_transfer',
        blocked_tool_executed: false,
      })
      expect(run.result.action_policy?.decisions[0]?.content).toMatchObject({
        decision: 'escalate',
        action_tool: 'openetr_recognize_title_transfer',
        reason_codes: [
          'public_relay_event_availability_missing',
          'title_transfer_authority_missing',
          'mletr_legal_conclusion_missing',
          'controller_semantics_review_required',
        ],
      })
      expect(run.result.action_policy?.outcomes[0]?.content).toMatchObject({
        decision: 'escalate',
        executed: false,
        stopped_before: 'openetr_recognize_title_transfer',
      })
      expect(run.result.action_policy?.decisions[0]?.record_hash).toMatch(/^sha256:[0-9a-f]{64}$/)
      expect(run.result.action_policy?.outcomes[0]?.record_hash).toMatch(/^sha256:[0-9a-f]{64}$/)
      expect(run.result.action_policy?.decisions[0]?.record_valid).toBe(true)
      expect(run.result.action_policy?.outcomes[0]?.record_valid).toBe(true)
      expect(run.result.action_policy?.decisions[0]?.proof.log_index).toBe(4)
      expect(run.result.action_policy?.outcomes[0]?.proof.log_index).toBe(5)
      expect(run.result.verifier.record_valid).toBe(true)
      expect(run.result.privacy.public_records_hash_only).toBe(true)
      expect(run.result.policy_decision).toMatchObject({
        artifact: 'policy-decision.json',
        decision: 'escalate_before_title_recognition',
        signed_policy_record: true,
      })
      expect(run.result.policy_decision?.decision_hash).toMatch(/^sha256:[0-9a-f]{64}$/u)
      expect(run.result.policy_decision?.signed_control_record_hash).toMatch(
        /^sha256:[0-9a-f]{64}$/u,
      )
      expect(run.result.source_e2e).toBe(false)
      expect(run.result.recognized_title_transfer).toBe(false)
      expect(run.result.public_relay_events_available).toBe(false)
      expect(run.result.title_authority_attested).toBe(false)
      expect(run.result.legal_mletr_attested).toBe(false)

      const text = `${run.stdout}\n${artifactText(run.outDir, [
        'README.md',
        'verifier-output.json',
        'redaction-manifest.json',
        'policy-decision.json',
        'public-relay-availability.json',
        'recognition-evidence.json',
        'controller-semantics.json',
        'title-authority-evidence.json',
        'legal-mletr-evidence.json',
        'mletr-source-checklist.json',
      ])}`
      expect(text).toContain('signed_openetr_records_present')
      expect(text).toContain('signed_atrib_control_record_policy_decision')
      expect(text).toContain('openetr_chain_observed')
      expect(text).toContain('acceptance_observed')
      expect(text).toContain('public_nostr_relay_evidence')
      expect(text).toContain('controller_semantics_review_required')
      expect(text).toContain('title_recognition_requires_attestor')
      expect(text).toContain('public_title_transfer_authority_or_operator_demo')
      expect(text).toContain('legal_title_transfer_or_mletr_attestation')
      expect(text).toContain('mletr_source_checklist_present')
      expect(text).toContain('escalate_before_title_recognition')
      for (const needle of [
        'sha256:7f4b8b8e2f394fddad1ed04e94c456ff0c8fb7ee6f0c5d5017deac9a0f61d425',
        'private warehouse receipt WR-2026-0628',
        'npub1privateissueropenetr20260628',
        'npub1privatebuyeropenetr20260628',
        'wss://relay.openetr.example/private-transfer',
        '1111111111111111111111111111111111111111111111111111111111111111',
        '2222222222222222222222222222222222222222222222222222222222222222',
        '3333333333333333333333333333333333333333333333333333333333333333',
      ]) {
        expect(text).not.toContain(needle)
      }
    } finally {
      run.cleanup()
    }
  }, 60000)

  const sourceBackedOpenEtrTest = process.env.OPENETR_SOURCE_DIR ? it : it.skip
  sourceBackedOpenEtrTest(
    'generates an OpenETR packet backed by the upstream implementation',
    async () => {
      const run = await runPacket(
        'examples/openetr-transfer/openetr-transfer-packet-smoke.ts',
        'atrib-openetr-source-packet-',
        {
          OPENETR_SOURCE_DIR: process.env.OPENETR_SOURCE_DIR ?? '',
          ATRIB_OPENETR_SOURCE_E2E: '1',
        },
      )
      try {
        expect(run.result.ok).toBe(true)
        expect(run.result.packet).toBe('openetr-transfer')
        expect(run.result.source_e2e).toBe(true)

        const text = `${run.stdout}\n${artifactText(run.outDir, [
          'README.md',
          'verifier-output.json',
          'redaction-manifest.json',
          'policy-decision.json',
          'public-relay-availability.json',
          'recognition-evidence.json',
          'controller-semantics.json',
          'title-authority-evidence.json',
          'legal-mletr-evidence.json',
          'mletr-source-checklist.json',
          'source-run-output.json',
        ])}`
        expect(text).toContain('actual_openetr_source_run_present')
        expect(text).toContain('signed_atrib_control_record_policy_decision')
        expect(text).toContain('c97eb84f5790ff041ad14a1c30df0f71ceb8d3d9')
        expect(text).toContain('query_reports_initiator_after_accept')
        expect(text).toContain('local-websocket-nostr-relay')
        for (const needle of [
          'source-backed OpenETR issue',
          'transfer initiate; object=',
          'transfer accept; object=',
          'nsec1',
          'ws://127.0.0.1',
        ]) {
          expect(text).not.toContain(needle)
        }
      } finally {
        run.cleanup()
      }
    },
    60000,
  )

  const fullOpenEtrRecognitionTest =
    process.env.OPENETR_SOURCE_DIR &&
    process.env.OPENETR_PUBLIC_RELAY_URLS &&
    process.env.OPENETR_PUBLIC_RELAY_PUBLISH === '1'
      ? it
      : it.skip
  fullOpenEtrRecognitionTest(
    'generates an OpenETR packet with public relay and recognition fixture evidence',
    async () => {
      const run = await runPacket(
        'examples/openetr-transfer/openetr-transfer-packet-smoke.ts',
        'atrib-openetr-full-packet-',
        {
          OPENETR_SOURCE_DIR: process.env.OPENETR_SOURCE_DIR ?? '',
          ATRIB_OPENETR_SOURCE_E2E: '1',
          OPENETR_PUBLIC_RELAY_URLS: process.env.OPENETR_PUBLIC_RELAY_URLS ?? '',
          OPENETR_PUBLIC_RELAY_PUBLISH: '1',
          OPENETR_FULL_RECOGNITION_FIXTURE: '1',
          OPENETR_PUBLIC_RUN_ID: `vitest-${Date.now()}`,
        },
      )
      try {
        expect(run.result.ok).toBe(true)
        expect(run.result.operations).toEqual([
          'openetr_issue',
          'openetr_transfer_initiate',
          'openetr_transfer_accept',
          'openetr_query_state',
          'openetr_recognize_title_transfer',
        ])
        expect(run.result.recognized_title_transfer).toBe(true)
        expect(run.result.public_relay_events_available).toBe(true)
        expect(run.result.title_authority_attested).toBe(true)
        expect(run.result.legal_mletr_attested).toBe(true)
        expect(run.result.action_policy).toMatchObject({
          stopped_before: null,
          blocked_tool_executed: false,
        })
        expect(run.result.action_policy?.decisions[0]?.content).toMatchObject({
          decision: 'allow',
          reason_codes: [
            'public_relay_event_availability_present',
            'title_transfer_authority_attested',
            'legal_mletr_attested',
            'controller_semantics_resolved',
          ],
        })

        const text = `${run.stdout}\n${artifactText(run.outDir, [
          'README.md',
          'verifier-output.json',
          'redaction-manifest.json',
          'policy-decision.json',
          'public-relay-availability.json',
          'recognition-evidence.json',
          'controller-semantics.json',
          'title-authority-evidence.json',
          'legal-mletr-evidence.json',
          'mletr-source-checklist.json',
          'title-authority-attestation.json',
          'legal-mletr-attestation.json',
          'source-run-output.json',
        ])}`
        expect(text).toContain('recognize_title_transfer_with_fixture_attestations')
        expect(text).toContain('public_openetr_event_availability')
        expect(text).toContain('controller_semantics_resolved')
        expect(text).toContain('title_transfer_authority')
        expect(text).toContain('legal_mletr')
        expect(text).toContain('fixture_evidence')
        expect(text).not.toContain('nsec1')
        expect(text).not.toContain('ws://127.0.0.1')
      } finally {
        run.cleanup()
      }
    },
    120000,
  )

  fullOpenEtrRecognitionTest(
    'generates an OpenETR packet with operator-demo TTA evidence',
    async () => {
      const run = await runPacket(
        'examples/openetr-transfer/openetr-transfer-packet-smoke.ts',
        'atrib-openetr-operator-demo-packet-',
        {
          OPENETR_SOURCE_DIR: process.env.OPENETR_SOURCE_DIR ?? '',
          ATRIB_OPENETR_SOURCE_E2E: '1',
          OPENETR_PUBLIC_RELAY_URLS: process.env.OPENETR_PUBLIC_RELAY_URLS ?? '',
          OPENETR_PUBLIC_RELAY_PUBLISH: '1',
          OPENETR_OPERATOR_DEMO_TTA: '1',
          OPENETR_OPERATOR_DEMO_LEGAL_ATTESTOR: '1',
          OPENETR_PUBLIC_RUN_ID: `vitest-operator-${Date.now()}`,
        },
      )
      try {
        expect(run.result.ok).toBe(true)
        expect(run.result.operations).toContain('openetr_recognize_title_transfer')
        expect(run.result.recognized_title_transfer).toBe(true)
        expect(run.result.authorization_basis).toBe('operator_demo_evidence')
        expect(run.result.public_relay_events_available).toBe(true)
        expect(run.result.title_authority_attested).toBe(true)
        expect(run.result.legal_mletr_attested).toBe(true)

        const text = `${run.stdout}\n${artifactText(run.outDir, [
          'README.md',
          'verifier-output.json',
          'policy-decision.json',
          'public-relay-availability.json',
          'recognition-evidence.json',
          'title-authority-evidence.json',
          'legal-mletr-evidence.json',
          'mletr-source-checklist.json',
        ])}`
        expect(text).toContain('recognize_title_transfer_with_operator_demo_evidence')
        expect(text).toContain('operator_demo_tta_event')
        expect(text).toContain('operator_demo_attestation')
        expect(text).toContain('mletr_source_checklist_present')
        expect(text).not.toContain('nsec1')
        expect(text).not.toContain('ws://127.0.0.1')
      } finally {
        run.cleanup()
      }
    },
    120000,
  )

  it('redacts private material from upstream error diagnostics', () => {
    const diagnostic = redactUpstreamDiagnostic(
      'Error for https://example.invalid/private-firecrawl-source with key fc-secret and Google key AIzaSecret plus https://browserbase.com/sessions/private-session',
      ['https://example.invalid/private-firecrawl-source'],
    )

    expect(diagnostic).toContain('[redacted-private-field]')
    expect(diagnostic).toContain('[redacted-firecrawl-key]')
    expect(diagnostic).toContain('[redacted-google-key]')
    expect(diagnostic).toContain('[redacted-browserbase-url]')
    expect(diagnostic).not.toContain('private-firecrawl-source')
    expect(diagnostic).not.toContain('fc-secret')
    expect(diagnostic).not.toContain('AIzaSecret')
  })

  it('does not publish public log records until packet checks pass', async () => {
    const publicLog = await startCountingPublicLog()
    try {
      await expect(
        runWrappedMcpPacket({
          packet: 'browserbase-stagehand',
          mode: 'fixture',
          logMode: 'public',
          publicLogEndpoint: publicLog.endpoint,
          upstreamShape: 'Browserbase fixture',
          exampleDir: join(process.cwd(), 'examples', 'browserbase-stagehand'),
          integrationDir: process.cwd(),
          fixtureServer: join(
            process.cwd(),
            'examples',
            'browserbase-stagehand',
            'browserbase-fixture-mcp.ts',
          ),
          expectedTools: ['start'],
          calls: [{ name: 'start', expectText: 'marker-that-is-not-present' }],
          privateNeedles: [],
        }),
      ).rejects.toThrow('unexpected start result')

      expect(publicLog.submissions).toHaveLength(0)
    } finally {
      await publicLog.close()
    }
  }, 60000)

  it('times out a stalled upstream call inside the shared runner', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'atrib-hanging-mcp-'))
    const fixtureServer = join(tempDir, 'hanging-mcp.ts')
    writeFileSync(
      fixtureServer,
      `
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

const server = new McpServer(
  { name: 'hanging-fixture', version: '0.1.0' },
  { capabilities: { tools: {} } },
)
const underlying = server.server
underlying.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'start',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
  ],
}))
underlying.setRequestHandler(CallToolRequestSchema, async () => new Promise(() => {}))
await server.connect(new StdioServerTransport())
`,
    )
    try {
      await expect(
        runWrappedMcpPacket({
          packet: 'hanging-upstream',
          mode: 'fixture',
          logMode: 'local',
          upstreamShape: 'Hanging upstream fixture',
          exampleDir: tempDir,
          integrationDir: process.cwd(),
          fixtureServer,
          expectedTools: ['start'],
          calls: [{ name: 'start' }],
          timeoutMs: 100,
          privateNeedles: [],
        }),
      ).rejects.toThrow('packet timed out after 100ms')
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  }, 10000)
})

async function startCountingPublicLog(): Promise<{
  endpoint: string
  submissions: unknown[]
  close(): Promise<void>
}> {
  const submissions: unknown[] = []
  const server = createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/v1/entries') {
      response.writeHead(404, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: 'not_found' }))
      return
    }

    let body = ''
    for await (const chunk of request) body += String(chunk)
    submissions.push(JSON.parse(body) as unknown)
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(
      JSON.stringify({
        log_index: submissions.length - 1,
        checkpoint: 'test-log\n1\nAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=\n',
        inclusion_proof: [],
        leaf_hash: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      }),
    )
  })
  await listen(server)
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('public log did not bind')
  return {
    endpoint: `http://127.0.0.1:${address.port}/v1/entries`,
    submissions,
    close: () => close(server),
  }
}

async function listen(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
}
