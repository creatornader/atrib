// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  checkRateLimit,
  createFirecrawlDemoServer,
  deploymentGuardIssues,
  firecrawlDemoSurfaceFromWorkflow,
  firecrawlWorkflowFromEnv,
  missingLiveEnv,
  rateLimitConfigFromEnv,
  summarizePacketResult,
  type FirecrawlDemoRun,
} from '../examples/firecrawl-web-ingestion/live-demo/server.js'
import type { FirecrawlWebIngestionPacketRun } from '../examples/firecrawl-web-ingestion/firecrawl-web-ingestion-packet-smoke.js'
import type { WrappedMcpPacketResult } from '../examples/wrapped-mcp-proof-runner.js'

const fixtureResult: WrappedMcpPacketResult = {
  ok: true,
  mode: 'fixture',
  packet: 'firecrawl-web-ingestion',
  upstream_shape: 'Firecrawl fixture',
  signed_records: 4,
  operations: ['firecrawl_search', 'firecrawl_scrape', 'firecrawl_extract', 'firecrawl_crawl'],
  record_hashes: [
    'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
  ],
  log_indexes: [0, 1, 2, 3],
  log: {
    mode: 'local',
    endpoint: 'http://127.0.0.1:1/v1/entries',
    publish_policy: 'local-capture-only',
    inclusion_verified: false,
    proofs: [],
  },
  verifier: {
    record_valid: true,
    checked_records: 4,
    event_type: 'https://atrib.dev/v1/types/tool_call',
    args_hash_present: true,
    result_hash_present: true,
  },
  privacy: {
    public_records_hash_only: true,
    private_needles_absent_from_public_records: true,
  },
  action_policy: {
    schema: 'atrib.packet.action_policy.v1',
    stopped_before: 'customer_email',
    blocked_tool_executed: false,
    decisions: [
      {
        kind: 'policy_decision',
        tool_name: 'customer_email',
        event_type: 'https://firecrawl-ingestion-policy.atrib.dev/v1/decision',
        record_hash: 'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
        record: {} as never,
        chain_root: 'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
        informed_by: ['sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'],
        args_hash: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
        record_valid: true,
        content: {
          decision: 'escalate',
          action_tool: 'customer_email',
        },
        proof: {
          log_index: 4,
          leaf_hash: 'leaf-decision',
          checkpoint: 'checkpoint-decision',
          inclusion_proof: [],
          public_endpoint: null,
          inclusion_verified: false,
        },
      },
    ],
    outcomes: [
      {
        kind: 'policy_outcome',
        tool_name: 'customer_email',
        event_type: 'https://firecrawl-ingestion-policy.atrib.dev/v1/decision',
        record_hash: 'sha256:9999999999999999999999999999999999999999999999999999999999999999',
        record: {} as never,
        chain_root: 'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
        informed_by: ['sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'],
        args_hash: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
        record_valid: true,
        content: {
          decision: 'escalate',
          executed: false,
          stopped_before: 'customer_email',
        },
        proof: {
          log_index: 5,
          leaf_hash: 'leaf-outcome',
          checkpoint: 'checkpoint-outcome',
          inclusion_proof: [],
          public_endpoint: null,
          inclusion_verified: false,
        },
      },
    ],
  },
}

const fixturePacket: FirecrawlWebIngestionPacketRun = {
  result: fixtureResult,
  verifierOutput: {},
  redactionManifest: {},
  policyDecision: {
    decision_hash: 'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    schema: 'atrib.proof_packet.policy_decision.v1',
    packet: 'firecrawl-web-ingestion',
    mode: 'fixture',
    evaluator: 'firecrawl-ingestion-policy-v0',
    decision: 'escalate_before_customer_email',
    decision_status: 'review_required',
    proposed_next_action: {
      action_type: 'customer_email',
      description: 'Use web-ingested content in an outbound customer message.',
      risk_class: 'external_customer_message',
    },
    inputs: {
      operation_order: fixtureResult.operations,
      record_hashes: fixtureResult.record_hashes,
      log_indexes: fixtureResult.log_indexes,
      log_mode: fixtureResult.log.mode,
      log_endpoint: fixtureResult.log.endpoint,
      crawl_cap: { maxDepth: 1, limit: 2 },
      verifier: fixtureResult.verifier,
      privacy: fixtureResult.privacy,
      action_policy: {
        schema: 'atrib.packet.action_policy.v1',
        stopped_before: 'customer_email',
        blocked_tool_executed: false,
      },
    },
    signed_control_records: {
      policy_decision: fixtureResult.action_policy!.decisions[0]!,
      policy_outcome: fixtureResult.action_policy!.outcomes[0]!,
    },
    rule_results: [
      { id: 'signed_ingestion_records_present', outcome: 'pass', evidence: '4 records' },
      {
        id: 'signed_atrib_control_record_policy_decision',
        outcome: 'pass',
        evidence: 'signed policy',
      },
      { id: 'customer_message_requires_review', outcome: 'escalate', evidence: 'review' },
    ],
    allowed_without_review: ['internal_research_summary'],
    escalated_actions: ['customer_email'],
    public_fields: ['record_hashes'],
    private_fields: ['raw_scraped_content'],
    caveats: [],
  },
  artifact_dir: null,
}

describe('Firecrawl web ingestion live demo', () => {
  it('maps proof records and policy output to demo rows', () => {
    const workflow = firecrawlWorkflowFromEnv({} as NodeJS.ProcessEnv)
    const run = summarizePacketResult({
      runId: 'fc-test',
      startedAt: '2026-06-28T00:00:00.000Z',
      finishedAt: '2026-06-28T00:00:01.000Z',
      workflow,
      packet: fixturePacket,
    })

    expect(run.status).toBe('accepted')
    expect(run.operations?.map((operation) => operation.step)).toEqual([
      'firecrawl_search',
      'firecrawl_scrape',
      'firecrawl_extract',
      'firecrawl_crawl',
    ])
    expect(run.policy_decision).toMatchObject({
      decision: 'escalate_before_customer_email',
      decision_status: 'review_required',
      signed_policy_record: true,
      signed_control_record_index: 4,
      signed_outcome_record_index: 5,
    })
  })

  it('requires a Firecrawl credential for live mode', () => {
    expect(missingLiveEnv({ FIRECRAWL_API_KEY: 'fc-test' } as NodeJS.ProcessEnv)).toEqual([])
    expect(
      missingLiveEnv({ FIRECRAWL_API_URL: 'http://127.0.0.1:3002' } as NodeJS.ProcessEnv),
    ).toEqual([])
    expect(missingLiveEnv({} as NodeJS.ProcessEnv)).toEqual(['FIRECRAWL_API_KEY'])
  })

  it('describes Firecrawl as a grounding pipeline instead of browser playback', () => {
    const workflow = firecrawlWorkflowFromEnv({} as NodeJS.ProcessEnv)
    const surface = firecrawlDemoSurfaceFromWorkflow(workflow)

    expect(surface.category).toBe('grounding-pipeline')
    expect(surface.stages.map((stage) => stage.tool)).toEqual([
      'firecrawl_search',
      'firecrawl_scrape',
      'firecrawl_extract',
      'firecrawl_crawl',
    ])
    expect(surface.source_pattern.join(' ')).toContain('source-to-context pipeline')
    expect(surface.source_pattern.join(' ')).toContain('not a remote browser replay')
    expect(surface.guardrail).toMatchObject({
      next_action: 'customer_email',
      decision: 'escalate_before_customer_email',
      stopped_before: 'customer_email',
    })
  })

  it('blocks deployed mode unless inputs are fixed and public', () => {
    const unsafe = {
      ATRIB_FIRECRAWL_DEMO_DEPLOYED: '1',
      ATRIB_FIRECRAWL_DEMO_MODE: 'live',
      ATRIB_FIRECRAWL_DEMO_PUBLIC_LOG: '1',
      FIRECRAWL_API_KEY: 'fc-test',
    } as NodeJS.ProcessEnv
    expect(deploymentGuardIssues(unsafe)).toEqual([
      'ATRIB_FIRECRAWL_DEMO_CREDENTIAL_SCOPE must be demo-only',
      'ATRIB_FIRECRAWL_DEMO_INPUT_SCOPE must be fixed-public',
    ])

    const safe = {
      ...unsafe,
      ATRIB_FIRECRAWL_DEMO_CREDENTIAL_SCOPE: 'demo-only',
      ATRIB_FIRECRAWL_DEMO_INPUT_SCOPE: 'fixed-public',
    } as NodeJS.ProcessEnv
    expect(deploymentGuardIssues(safe)).toEqual([])
  })

  it('limits repeated proof starts per client key', () => {
    const config = rateLimitConfigFromEnv({
      ATRIB_FIRECRAWL_DEMO_RATE_LIMIT: '1',
      ATRIB_FIRECRAWL_DEMO_RATE_LIMIT_WINDOW_MS: '1000',
      ATRIB_FIRECRAWL_DEMO_MAX_RUNS_PER_WINDOW: '2',
      ATRIB_FIRECRAWL_DEMO_MAX_RUNS_PER_DAY: '3',
    } as NodeJS.ProcessEnv)
    const buckets = new Map()

    expect(checkRateLimit('127.0.0.1', config, buckets, 0)).toEqual({ ok: true })
    expect(checkRateLimit('127.0.0.1', config, buckets, 100)).toEqual({ ok: true })
    expect(checkRateLimit('127.0.0.1', config, buckets, 200)).toMatchObject({
      ok: false,
      reason: 'window',
    })
    expect(checkRateLimit('127.0.0.1', config, buckets, 1100)).toEqual({ ok: true })
    expect(checkRateLimit('127.0.0.1', config, buckets, 1200)).toMatchObject({
      ok: false,
      reason: 'day',
    })
  })

  it('serves config and creates one fixture run through the async HTTP API', async () => {
    const { server } = createFirecrawlDemoServer({
      env: {} as NodeJS.ProcessEnv,
      runner: async () => fixturePacket,
    })
    const baseUrl = await listen(server)
    try {
      const config = (await fetchJson(`${baseUrl}/api/config`)) as {
        ok: boolean
        mode: string
        workflow: { input_policy: string }
        demo_surface: { category: string; stages: Array<{ tool: string }> }
      }
      expect(config).toMatchObject({
        ok: true,
        mode: 'fixture',
        workflow: { input_policy: 'fixed-public' },
        demo_surface: { category: 'grounding-pipeline' },
      })
      expect(config.demo_surface.stages.map((stage) => stage.tool)).toContain('firecrawl_extract')

      const rootHtml = await fetchText(`${baseUrl}/`)
      expect(rootHtml).toContain('Source to context pipeline')
      expect(rootHtml).toContain('Web data in. Signed ingestion and policy evidence out.')
      expect(rootHtml).toContain('The hosted demo does not accept arbitrary URLs')
      expect(rootHtml).toContain('customer_email is stopped before execution')

      const response = (await fetchJson(`${baseUrl}/api/runs`, { method: 'POST' })) as {
        ok: boolean
        run: FirecrawlDemoRun
        status_url: string
      }
      expect(response.ok).toBe(true)
      expect(response.run.status).toBe('running')
      expect(response.status_url).toBe(`/api/runs/${response.run.run_id}`)

      const run = await waitForRun(baseUrl, response.run.run_id)
      expect(run.status).toBe('accepted')
      expect(run.policy_decision?.decision).toBe('escalate_before_customer_email')
      expect(run.policy_decision?.signed_policy_record).toBe(true)
    } finally {
      await close(server)
    }
  })

  it('rejects run creation when deployed guard checks fail', async () => {
    const { server } = createFirecrawlDemoServer({
      env: { ATRIB_FIRECRAWL_DEMO_DEPLOYED: '1' } as NodeJS.ProcessEnv,
      runner: async () => fixturePacket,
    })
    const baseUrl = await listen(server)
    try {
      const response = (await fetchJson(`${baseUrl}/api/runs`, { method: 'POST' })) as {
        ok: boolean
        error: string
        issues: string[]
      }
      expect(response).toMatchObject({ ok: false, error: 'deployment_guard_failed' })
      expect(response.issues).toContain('ATRIB_FIRECRAWL_DEMO_MODE must be live')
    } finally {
      await close(server)
    }
  })
})

async function listen(
  server: ReturnType<typeof createFirecrawlDemoServer>['server'],
): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('server did not bind')
  return `http://127.0.0.1:${address.port}`
}

async function close(
  server: ReturnType<typeof createFirecrawlDemoServer>['server'],
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, init)
  return response.json()
}

async function fetchText(url: string, init?: RequestInit): Promise<string> {
  const response = await fetch(url, init)
  return response.text()
}

async function waitForRun(baseUrl: string, runId: string): Promise<FirecrawlDemoRun> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = (await fetchJson(`${baseUrl}/api/runs/${runId}`)) as {
      ok: boolean
      run: FirecrawlDemoRun
    }
    if (response.run.status !== 'running') return response.run
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`run ${runId} did not finish`)
}
