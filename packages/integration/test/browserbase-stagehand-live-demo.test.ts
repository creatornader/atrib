// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  actionPolicyModeFromEnv,
  browserbaseWorkflowFromEnv,
  checkRateLimit,
  createBrowserbaseDemoServer,
  deploymentGuardIssues,
  missingLiveEnv,
  rateLimitConfigFromEnv,
  summarizePacketResult,
  type BrowserbaseDemoRun,
} from '../examples/browserbase-stagehand/live-demo/server.js'
import type { WrappedMcpPacketResult } from '../examples/wrapped-mcp-proof-runner.js'

const fixtureResult: WrappedMcpPacketResult = {
  ok: true,
  mode: 'fixture',
  packet: 'browserbase-stagehand',
  upstream_shape: 'Browserbase fixture',
  signed_records: 2,
  operations: ['start', 'end'],
  record_hashes: [
    'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  ],
  log_indexes: [0, 1],
  log: {
    mode: 'local',
    endpoint: 'http://127.0.0.1:1/v1/entries',
    publish_policy: 'local-capture-only',
    inclusion_verified: false,
    proofs: [
      {
        record_hash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        log_index: 0,
        leaf_hash: 'leaf-a',
        checkpoint: 'checkpoint-a',
        inclusion_proof: [],
      },
      {
        record_hash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        log_index: 1,
        leaf_hash: 'leaf-b',
        checkpoint: 'checkpoint-b',
        inclusion_proof: [],
      },
    ],
  },
  verifier: {
    record_valid: true,
    checked_records: 2,
    event_type: 'https://atrib.dev/v1/types/tool_call',
    args_hash_present: true,
    result_hash_present: true,
  },
  privacy: {
    public_records_hash_only: true,
    private_needles_absent_from_public_records: true,
  },
}

const fixturePolicyResult: WrappedMcpPacketResult = {
  ...fixtureResult,
  operations: ['start', 'navigate', 'observe', 'end'],
  record_hashes: [
    'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
  ],
  log_indexes: [0, 1, 2, 5],
  action_policy: {
    schema: 'atrib.packet.action_policy.v1',
    stopped_before: 'act',
    blocked_tool_executed: false,
    decisions: [
      {
        kind: 'policy_decision',
        tool_name: 'act',
        event_type: 'https://browserbase-action-gate.atrib.dev/v1/decision',
        record_hash: 'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
        record: {} as never,
        chain_root: 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        informed_by: ['sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'],
        args_hash: 'sha256:decision',
        record_valid: true,
        content: {
          decision: 'block',
          reason_codes: ['operator_policy_block'],
          observed_record_hash:
            'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        },
        proof: {
          log_index: 3,
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
        tool_name: 'act',
        event_type: 'https://browserbase-action-gate.atrib.dev/v1/decision',
        record_hash: 'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
        record: {} as never,
        chain_root: 'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
        informed_by: [
          'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
          'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
        ],
        args_hash: 'sha256:outcome',
        record_valid: true,
        content: {
          decision: 'block',
          executed: false,
          stopped_before: 'act',
          cleanup_record_hashes: [
            'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
          ],
        },
        proof: {
          log_index: 4,
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

describe('Browserbase Stagehand live demo', () => {
  it('maps proof records to explorer and local-log receipt rows', () => {
    const workflow = browserbaseWorkflowFromEnv({} as NodeJS.ProcessEnv)
    const run = summarizePacketResult({
      runId: 'bb-test',
      startedAt: '2026-06-23T00:00:00.000Z',
      finishedAt: '2026-06-23T00:00:01.000Z',
      result: fixtureResult,
      workflow,
      actionPolicyMode: 'allow',
    })
    expect(run.status).toBe('accepted')
    expect(run.action_policy_mode).toBe('allow')
    expect(run.workflow?.stagehand_steps.map((step) => step.primitive)).toEqual([
      'observe',
      'act',
      'extract',
    ])
    expect(run.operations?.[0]).toMatchObject({
      step: 'start',
      log_index: 0,
      explorer_url:
        'https://explore.atrib.dev/action/sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      log_proof_url: null,
    })
  })

  it('keeps signed action-policy evidence in accepted runs', () => {
    const run = summarizePacketResult({
      runId: 'bb-policy-test',
      startedAt: '2026-06-23T00:00:00.000Z',
      finishedAt: '2026-06-23T00:00:01.000Z',
      result: fixturePolicyResult,
      workflow: browserbaseWorkflowFromEnv({} as NodeJS.ProcessEnv),
      actionPolicyMode: 'block',
    })

    expect(run.action_policy_mode).toBe('block')
    expect(run.action_policy?.stopped_before).toBe('act')
    expect(run.action_policy?.decisions[0]?.proof.log_index).toBe(3)
    expect(run.action_policy?.outcomes[0]?.content).toMatchObject({ executed: false })
    expect(run.operations?.map((operation) => operation.step)).toEqual([
      'start',
      'navigate',
      'observe',
      'end',
    ])
  })

  it('reads action policy mode from demo env with allow fallback', () => {
    expect(
      actionPolicyModeFromEnv({
        ATRIB_BROWSERBASE_DEMO_ACTION_POLICY: 'block',
      } as NodeJS.ProcessEnv),
    ).toBe('block')
    expect(
      actionPolicyModeFromEnv({
        ATRIB_BROWSERBASE_ACTION_POLICY: 'escalate',
      } as NodeJS.ProcessEnv),
    ).toBe('escalate')
    expect(
      actionPolicyModeFromEnv({
        ATRIB_BROWSERBASE_DEMO_ACTION_POLICY: 'unexpected',
        ATRIB_BROWSERBASE_ACTION_POLICY: 'escalate',
      } as NodeJS.ProcessEnv),
    ).toBe('allow')
  })

  it('redacts custom Browserbase target and instructions in workflow metadata', () => {
    const workflow = browserbaseWorkflowFromEnv({
      ATRIB_BROWSERBASE_DEMO_URL: 'https://example.invalid/private-target',
      ATRIB_BROWSERBASE_DEMO_OBSERVE: 'private observe instruction',
      ATRIB_BROWSERBASE_DEMO_ACT: 'private act instruction',
      ATRIB_BROWSERBASE_DEMO_EXTRACT: 'private extract instruction',
    } as NodeJS.ProcessEnv)

    expect(workflow.target_url).toMatchObject({ disclosure: 'hash-only' })
    expect(workflow.target_url.value).toBeUndefined()
    expect(
      workflow.stagehand_steps.every((step) => step.instruction.disclosure === 'hash-only'),
    ).toBe(true)
    expect(JSON.stringify(workflow)).not.toContain('private observe instruction')
  })

  it('requires only the Browserbase API key for hosted live mode', () => {
    expect(
      missingLiveEnv({
        ATRIB_BROWSERBASE_UPSTREAM: 'hosted',
        BROWSERBASE_API_KEY: 'bb-test',
      } as NodeJS.ProcessEnv),
    ).toEqual([])
    expect(missingLiveEnv({ ATRIB_BROWSERBASE_UPSTREAM: 'hosted' } as NodeJS.ProcessEnv)).toEqual([
      'BROWSERBASE_API_KEY',
    ])
  })

  it('requires project and model keys for self-hosted live mode', () => {
    expect(missingLiveEnv({ BROWSERBASE_API_KEY: 'bb-test' } as NodeJS.ProcessEnv)).toEqual([
      'BROWSERBASE_PROJECT_ID',
      'GEMINI_API_KEY',
    ])
  })

  it('blocks deployed mode until demo-only hosted public-log config is present', () => {
    const unsafe = {
      ATRIB_BROWSERBASE_DEMO_DEPLOYED: '1',
      ATRIB_BROWSERBASE_DEMO_MODE: 'live',
      ATRIB_BROWSERBASE_UPSTREAM: 'hosted',
      ATRIB_BROWSERBASE_DEMO_PUBLIC_LOG: '1',
      BROWSERBASE_API_KEY: 'bb-test',
    } as NodeJS.ProcessEnv
    expect(deploymentGuardIssues(unsafe)).toEqual([
      'ATRIB_BROWSERBASE_DEMO_CREDENTIAL_SCOPE must be demo-only',
      'ATRIB_BROWSERBASE_DEMO_URL is required',
    ])

    const safe = {
      ...unsafe,
      ATRIB_BROWSERBASE_DEMO_CREDENTIAL_SCOPE: 'demo-only',
      ATRIB_BROWSERBASE_DEMO_URL: 'https://example.com',
    } as NodeJS.ProcessEnv
    expect(deploymentGuardIssues(safe)).toEqual([])
  })

  it('limits repeated proof starts per client key', () => {
    const config = rateLimitConfigFromEnv({
      ATRIB_BROWSERBASE_DEMO_RATE_LIMIT: '1',
      ATRIB_BROWSERBASE_DEMO_RATE_LIMIT_WINDOW_MS: '1000',
      ATRIB_BROWSERBASE_DEMO_MAX_RUNS_PER_WINDOW: '2',
      ATRIB_BROWSERBASE_DEMO_MAX_RUNS_PER_DAY: '3',
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
    const { server } = createBrowserbaseDemoServer({
      env: {} as NodeJS.ProcessEnv,
      runner: async () => fixtureResult,
    })
    const baseUrl = await listen(server)
    try {
      const config = (await fetchJson(`${baseUrl}/api/config`)) as {
        ok: boolean
        mode: string
        action_policy: { mode: string; modes: string[] }
        workflow: { stagehand_steps: unknown[] }
      }
      expect(config).toMatchObject({ ok: true, mode: 'fixture' })
      expect(config.workflow.stagehand_steps).toHaveLength(3)
      expect(config.action_policy.modes).toEqual(['allow', 'block', 'escalate'])

      const response = (await fetchJson(`${baseUrl}/api/runs`, { method: 'POST' })) as {
        ok: boolean
        run: BrowserbaseDemoRun
        status_url: string
      }
      expect(response.ok).toBe(true)
      expect(response.run.status).toBe('running')
      expect(response.status_url).toBe(`/api/runs/${response.run.run_id}`)

      const run = await waitForRun(baseUrl, response.run.run_id)
      expect(run.status).toBe('accepted')
      expect(run.action_policy_mode).toBe('allow')
      expect(run.operations?.map((operation) => operation.step)).toEqual(['start', 'end'])
    } finally {
      await close(server)
    }
  })

  it('keeps POST nonblocking while one proof run is active', async () => {
    let finishRun: (() => void) | undefined
    const { server } = createBrowserbaseDemoServer({
      env: {} as NodeJS.ProcessEnv,
      runner: async () =>
        new Promise<WrappedMcpPacketResult>((resolve) => {
          finishRun = () => resolve(fixtureResult)
        }),
    })
    const baseUrl = await listen(server)
    try {
      const started = Date.now()
      const response = (await fetchJson(`${baseUrl}/api/runs`, { method: 'POST' })) as {
        ok: boolean
        run: BrowserbaseDemoRun
      }
      expect(Date.now() - started).toBeLessThan(500)
      expect(response.run.status).toBe('running')
      expect(response.run.action_policy_mode).toBe('allow')

      const running = (await fetchJson(`${baseUrl}/api/runs/${response.run.run_id}`)) as {
        ok: boolean
        run: BrowserbaseDemoRun
      }
      expect(running.run.status).toBe('running')

      const second = (await fetchJson(`${baseUrl}/api/runs`, { method: 'POST' })) as {
        ok: boolean
        error: string
      }
      expect(second).toEqual({ ok: false, error: 'run_already_active' })

      finishRun?.()
      const accepted = await waitForRun(baseUrl, response.run.run_id)
      expect(accepted.status).toBe('accepted')
    } finally {
      await close(server)
    }
  })

  it('accepts per-run action policy mode from POST JSON', async () => {
    const { server } = createBrowserbaseDemoServer({
      env: {} as NodeJS.ProcessEnv,
      runner: async ({ actionPolicyMode }) =>
        actionPolicyMode === 'block' ? fixturePolicyResult : fixtureResult,
    })
    const baseUrl = await listen(server)
    try {
      const response = (await fetchJson(`${baseUrl}/api/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action_policy_mode: 'block' }),
      })) as {
        ok: boolean
        run: BrowserbaseDemoRun
      }
      expect(response.run.action_policy_mode).toBe('block')

      const run = await waitForRun(baseUrl, response.run.run_id)
      expect(run.action_policy_mode).toBe('block')
      expect(run.action_policy?.stopped_before).toBe('act')
    } finally {
      await close(server)
    }
  })

  it('rejects run creation when deployed guard checks fail', async () => {
    const { server } = createBrowserbaseDemoServer({
      env: { ATRIB_BROWSERBASE_DEMO_DEPLOYED: '1' } as NodeJS.ProcessEnv,
      runner: async () => fixtureResult,
    })
    const baseUrl = await listen(server)
    try {
      const response = (await fetchJson(`${baseUrl}/api/runs`, { method: 'POST' })) as {
        ok: boolean
        error: string
        issues: string[]
      }
      expect(response).toMatchObject({ ok: false, error: 'deployment_guard_failed' })
      expect(response.issues).toContain('ATRIB_BROWSERBASE_DEMO_MODE must be live')
    } finally {
      await close(server)
    }
  })
})

async function listen(
  server: ReturnType<typeof createBrowserbaseDemoServer>['server'],
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
  server: ReturnType<typeof createBrowserbaseDemoServer>['server'],
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, init)
  return response.json()
}

async function waitForRun(baseUrl: string, runId: string): Promise<BrowserbaseDemoRun> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = (await fetchJson(`${baseUrl}/api/runs/${runId}`)) as {
      ok: boolean
      run: BrowserbaseDemoRun
    }
    if (response.run.status !== 'running') return response.run
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`run ${runId} did not finish`)
}
