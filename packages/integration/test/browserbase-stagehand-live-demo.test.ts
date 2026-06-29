// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  actionPolicyModeFromEnv,
  browserbasePrivateMediaFromSessionDebug,
  browserbasePrivateMediaFromSessionDebugPayload,
  browserbasePrivateMediaFromToolResult,
  browserbaseDemoTargetUrl,
  browserbaseWorkflowFromEnv,
  checkRateLimit,
  createBrowserbaseDemoServer,
  deploymentGuardIssues,
  missingLiveEnv,
  rateLimitConfigFromEnv,
  rewriteBrowserbaseReplayPlaylist,
  sanitizeBrowserbaseReplayMetadata,
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

const fixtureAllowResult: WrappedMcpPacketResult = {
  ...fixtureResult,
  signed_records: 6,
  operations: ['start', 'navigate', 'observe', 'act', 'extract', 'end'],
  record_hashes: [
    'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
  ],
  log_indexes: [0, 1, 2, 4, 6, 7],
  verifier: {
    ...fixtureResult.verifier,
    checked_records: 6,
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
    expect(run.visual).toMatchObject({
      schema: 'atrib.browserbase.visual_run.v1',
      stage: 'replay',
      source: 'fixture-simulation',
      media: { primary: 'simulated' },
      privacy: { public_records: 'hash-only' },
    })
    expect(run.visual?.events.find((event) => event.step === 'act')).toMatchObject({
      status: 'pending',
      target_action: 'approve',
    })
  })

  it('marks allowed browser act as visual click playback when act is signed', () => {
    const run = summarizePacketResult({
      runId: 'bb-allow-test',
      startedAt: '2026-06-23T00:00:00.000Z',
      finishedAt: '2026-06-23T00:00:01.000Z',
      result: fixtureAllowResult,
      workflow: browserbaseWorkflowFromEnv({} as NodeJS.ProcessEnv),
      actionPolicyMode: 'allow',
    })

    expect(run.operations?.map((operation) => operation.step)).toEqual([
      'start',
      'navigate',
      'observe',
      'act',
      'extract',
      'end',
    ])
    expect(run.visual?.events.find((event) => event.step === 'act')).toMatchObject({
      status: 'signed',
      target_action: 'approve',
      record_hash: 'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
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
    expect(run.visual?.events.find((event) => event.step === 'policy_decision')).toMatchObject({
      status: 'blocked',
      target_action: 'hold',
    })
    expect(run.visual?.events.find((event) => event.step === 'act')).toMatchObject({
      status: 'skipped',
      target_action: 'hold',
    })
  })

  it('keeps Browserbase Live View and Replay refs UI-only', () => {
    const run = summarizePacketResult({
      runId: 'bb-visual-test',
      startedAt: '2026-06-23T00:00:00.000Z',
      finishedAt: '2026-06-23T00:00:01.000Z',
      result: fixtureResult,
      workflow: browserbaseWorkflowFromEnv({} as NodeJS.ProcessEnv),
      actionPolicyMode: 'allow',
      env: {
        ATRIB_BROWSERBASE_DEMO_LIVE_VIEW_URL: 'https://browserbase.example/live/session-token',
        ATRIB_BROWSERBASE_DEMO_REPLAY_URL: 'http://browserbase.example/unsafe-replay',
      } as NodeJS.ProcessEnv,
    })

    expect(run.visual?.media).toMatchObject({
      primary: 'live',
      live_view: {
        available: true,
        proxy_path: '/api/runs/bb-visual-test/browserbase/live-view',
        disclosure: 'server-redirect',
      },
      replay: {
        available: false,
        disclosure: 'not-available',
      },
    })
    expect(run.visual?.media.live_view.url).toBeUndefined()
    expect(JSON.stringify(run.operations)).not.toContain('session-token')
    expect(run.visual?.privacy.ui_only_fields).toContain('Browserbase Live View URL')
  })

  it('extracts Browserbase media refs from private tool results', () => {
    const media = browserbasePrivateMediaFromToolResult({
      name: 'start',
      result_text: JSON.stringify({
        id: 'bb_session_private_20260628',
        debuggerFullscreenUrl: 'https://www.browserbase.com/devtools-fullscreen/session-private',
        sessionUrl: 'https://www.browserbase.com/sessions/bb_session_private_20260628',
      }),
    })

    expect(media).toMatchObject({
      source: 'tool-result',
      session_id: 'bb_session_private_20260628',
      live_view_url: 'https://www.browserbase.com/devtools-fullscreen/session-private',
      session_url: 'https://www.browserbase.com/sessions/bb_session_private_20260628',
      detected_from: ['start'],
    })
  })

  it('extracts Live View URLs from Browserbase session debug payloads', () => {
    const media = browserbasePrivateMediaFromSessionDebugPayload('bb_session_private_20260628', {
      debuggerFullscreenUrl: 'https://www.browserbase.com/devtools-fullscreen/session-private',
      debuggerUrl: 'https://www.browserbase.com/devtools/session-private',
      wsUrl: 'wss://connect.browserbase.com/private',
      pages: [
        {
          id: '0',
          url: 'https://example.com',
          debuggerFullscreenUrl: 'https://www.browserbase.com/devtools-fullscreen/page-private',
          debuggerUrl: 'https://www.browserbase.com/devtools/page-private',
        },
      ],
    })

    expect(media).toMatchObject({
      source: 'browserbase-debug-api',
      session_id: 'bb_session_private_20260628',
      live_view_url: 'https://www.browserbase.com/devtools-fullscreen/session-private',
      session_url: 'https://www.browserbase.com/sessions/bb_session_private_20260628',
      detected_from: ['browserbase-debug-api'],
    })
  })

  it('fetches Browserbase Live View media from the session debug API', async () => {
    let requestedUrl = ''
    let apiKey = ''
    const media = await browserbasePrivateMediaFromSessionDebug({
      sessionId: 'bb_session_private_20260628',
      env: { BROWSERBASE_API_KEY: 'bb-secret-test-key' } as NodeJS.ProcessEnv,
      timeoutMs: 500,
      fetchImpl: async (url, init) => {
        requestedUrl = String(url)
        apiKey = String((init?.headers as Record<string, string>)['X-BB-API-Key'])
        return new Response(
          JSON.stringify({
            debuggerFullscreenUrl:
              'https://www.browserbase.com/devtools-fullscreen/session-private',
            debuggerUrl: 'https://www.browserbase.com/devtools/session-private',
            pages: [],
            wsUrl: 'wss://connect.browserbase.com/private',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      },
    })

    expect(requestedUrl).toBe(
      'https://api.browserbase.com/v1/sessions/bb_session_private_20260628/debug',
    )
    expect(apiKey).toBe('bb-secret-test-key')
    expect(media).toMatchObject({
      source: 'browserbase-debug-api',
      session_id: 'bb_session_private_20260628',
      live_view_url: 'https://www.browserbase.com/devtools-fullscreen/session-private',
    })
  })

  it('turns run-derived Browserbase session refs into hash-only media state', () => {
    const run = summarizePacketResult({
      runId: 'bb-private-media-test',
      startedAt: '2026-06-23T00:00:00.000Z',
      finishedAt: '2026-06-23T00:00:01.000Z',
      result: {
        ...fixtureAllowResult,
        mode: 'live',
      },
      workflow: browserbaseWorkflowFromEnv({} as NodeJS.ProcessEnv),
      actionPolicyMode: 'allow',
      privateMedia: {
        source: 'tool-result',
        session_id: 'bb_session_private_20260628',
        detected_from: ['start'],
      },
    })

    expect(run.visual?.media).toMatchObject({
      primary: 'replay',
      source: 'tool-result',
      session: {
        available: true,
        disclosure: 'hash-only',
      },
      replay: {
        available: true,
        proxy_path: '/api/runs/bb-private-media-test/browserbase/replays',
        disclosure: 'server-proxy',
      },
    })
    expect(run.visual?.media.session.id_hash).toMatch(/^sha256:/u)
    expect(JSON.stringify(run.operations)).not.toContain('bb_session_private_20260628')
    expect(JSON.stringify(run.verifier)).not.toContain('bb_session_private_20260628')
  })

  it('rewrites Browserbase replay metadata to local proxy paths', () => {
    const sanitized = sanitizeBrowserbaseReplayMetadata(
      {
        pages: [
          {
            pageId: '0',
            url: '/v1/sessions/bb_session_private_20260628/replays/0',
            startedAt: '2026-06-29T00:00:00.000Z',
          },
        ],
        privateRef: 'session bb_session_private_20260628 hidden',
      },
      { runId: 'bb-replay-test', sessionId: 'bb_session_private_20260628' },
    )

    expect(sanitized).toMatchObject({
      pages: [
        {
          pageId: '0',
          url: '/api/runs/bb-replay-test/browserbase/replays/0',
        },
      ],
    })
    expect(JSON.stringify(sanitized)).not.toContain('bb_session_private_20260628')
    expect(JSON.stringify(sanitized)).toContain('[redacted-browserbase-ref:')
  })

  it('rewrites Browserbase replay playlists to local asset proxy paths', () => {
    const privateReplayAssetsByRun = new Map<string, Map<string, string>>()
    const rewritten = rewriteBrowserbaseReplayPlaylist({
      runId: 'bb-replay-test',
      privateReplayAssetsByRun,
      body: [
        '#EXTM3U',
        '#EXT-X-MAP:URI="https://cdn.example.com/project/bb_session_private_20260628/0/init.mp4?token=secret"',
        '#EXTINF:1.000,',
        'https://cdn.example.com/project/bb_session_private_20260628/0/segment00000000.m4s?token=secret',
      ].join('\n'),
    })

    expect(rewritten).toContain('/api/runs/bb-replay-test/browserbase/replay-assets/')
    expect(rewritten).not.toContain('bb_session_private_20260628')
    expect(rewritten).not.toContain('token=secret')
    expect(privateReplayAssetsByRun.get('bb-replay-test')?.size).toBe(2)
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

  it('describes the agent-ready WebMCP target page', () => {
    expect(
      browserbaseDemoTargetUrl({
        ATRIB_BROWSERBASE_DEMO_PUBLIC_BASE_URL: 'https://demo.example/',
      } as NodeJS.ProcessEnv),
    ).toBe('https://demo.example/target')

    const workflow = browserbaseWorkflowFromEnv({
      ATRIB_BROWSERBASE_DEMO_PUBLIC_BASE_URL: 'https://demo.example/',
    } as NodeJS.ProcessEnv)
    expect(workflow.target_url.value).toBe('https://demo.example/target')
    expect(workflow.target_page).toMatchObject({
      route: '/target',
      shape: 'webapp',
      native_webmcp_api: 'document.modelContext',
    })
    expect(workflow.target_page.tools.map((tool) => tool.name)).toEqual([
      'read_vendor_risk',
      'approve_vendor_renewal',
      'request_human_review',
    ])
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
      'ATRIB_BROWSERBASE_DEMO_URL or ATRIB_BROWSERBASE_DEMO_PUBLIC_BASE_URL is required',
    ])

    const safe = {
      ...unsafe,
      ATRIB_BROWSERBASE_DEMO_CREDENTIAL_SCOPE: 'demo-only',
      ATRIB_BROWSERBASE_DEMO_PUBLIC_BASE_URL: 'https://demo.example',
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
        workflow: { stagehand_steps: unknown[]; target_page: { route: string; tools: unknown[] } }
        visual: { stage: string; media: { primary: string }; events: unknown[] }
      }
      expect(config).toMatchObject({ ok: true, mode: 'fixture' })
      expect(config.workflow.stagehand_steps).toHaveLength(3)
      expect(config.workflow.target_page.route).toBe('/target')
      expect(config.workflow.target_page.tools).toHaveLength(3)
      expect(config.visual.stage).toBe('idle')
      expect(config.visual.media.primary).toBe('simulated')
      expect(config.visual.events).toHaveLength(8)
      expect(config.action_policy.modes).toEqual(['allow', 'block', 'escalate'])

      const response = (await fetchJson(`${baseUrl}/api/runs`, { method: 'POST' })) as {
        ok: boolean
        run: BrowserbaseDemoRun
        status_url: string
      }
      expect(response.ok).toBe(true)
      expect(response.run.status).toBe('running')
      expect(response.run.visual?.stage).toBe('running')
      expect(response.status_url).toBe(`/api/runs/${response.run.run_id}`)

      const run = await waitForRun(baseUrl, response.run.run_id)
      expect(run.status).toBe('accepted')
      expect(run.action_policy_mode).toBe('allow')
      expect(run.operations?.map((operation) => operation.step)).toEqual(['start', 'end'])
      expect(run.visual?.stage).toBe('replay')
      expect(run.visual?.media).toMatchObject({
        primary: 'simulated',
        source: 'none',
      })
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

  it('updates a running live run when Browserbase Live View media arrives', async () => {
    let finishRun: (() => void) | undefined
    const { server } = createBrowserbaseDemoServer({
      env: {
        ATRIB_BROWSERBASE_DEMO_MODE: 'live',
        ATRIB_BROWSERBASE_UPSTREAM: 'hosted',
        BROWSERBASE_API_KEY: 'bb-test-key',
      } as NodeJS.ProcessEnv,
      runner: async ({ onPrivateMedia }) => {
        await onPrivateMedia?.({
          source: 'browserbase-debug-api',
          session_id: 'bb_session_private_20260628',
          live_view_url: 'https://www.browserbase.com/devtools-fullscreen/session-private',
          detected_from: ['browserbase-debug-api'],
        })
        return new Promise<WrappedMcpPacketResult>((resolve) => {
          finishRun = () => resolve({ ...fixtureAllowResult, mode: 'live' })
        })
      },
    })
    const baseUrl = await listen(server)
    try {
      const response = (await fetchJson(`${baseUrl}/api/runs`, { method: 'POST' })) as {
        ok: boolean
        run: BrowserbaseDemoRun
      }
      expect(response.run.status).toBe('running')

      const running = await waitForRunMedia(baseUrl, response.run.run_id)
      expect(running.status).toBe('running')
      expect(running.visual?.media).toMatchObject({
        primary: 'live',
        source: 'browserbase-debug-api',
        session: {
          available: true,
          disclosure: 'hash-only',
        },
        live_view: {
          available: true,
          proxy_path: `/api/runs/${response.run.run_id}/browserbase/live-view`,
          disclosure: 'server-redirect',
        },
      })
      expect(running.visual?.media.live_view.url_hash).toMatch(/^sha256:/u)
      expect(running.visual?.media.live_view.url).toBeUndefined()
      expect(JSON.stringify(running.visual?.media)).not.toContain(
        'https://www.browserbase.com/devtools-fullscreen/session-private',
      )
      expect(JSON.stringify(running.operations ?? [])).not.toContain('bb_session_private_20260628')

      const liveViewRedirect = await fetch(
        `${baseUrl}/api/runs/${response.run.run_id}/browserbase/live-view`,
        { redirect: 'manual' },
      )
      expect(liveViewRedirect.status).toBe(302)
      expect(liveViewRedirect.headers.get('location')).toBe(
        'https://www.browserbase.com/devtools-fullscreen/session-private',
      )

      finishRun?.()
      const accepted = await waitForRun(baseUrl, response.run.run_id)
      expect(accepted.visual?.media.primary).toBe('replay')
      expect(accepted.visual?.media.live_view.available).toBe(false)
      expect(accepted.visual?.media.replay).toMatchObject({
        available: true,
        proxy_path: `/api/runs/${response.run.run_id}/browserbase/replays`,
      })
      const closedLiveView = await fetch(
        `${baseUrl}/api/runs/${response.run.run_id}/browserbase/live-view`,
        { redirect: 'manual' },
      )
      expect(closedLiveView.status).toBe(410)
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

  it('serves the WebMCP target app with native API registration fallback', async () => {
    const { server } = createBrowserbaseDemoServer({
      env: {} as NodeJS.ProcessEnv,
      runner: async () => fixtureResult,
    })
    const baseUrl = await listen(server)
    try {
      const response = await fetch(`${baseUrl}/target`)
      const html = await response.text()
      expect(response.headers.get('permissions-policy')).toBeNull()
      expect(response.headers.get('cross-origin-opener-policy')).toBe('same-origin')
      expect(html).toContain('document.modelContext')
      expect(html).toContain('approve_vendor_renewal')
      expect(html).toContain('data-webmcp-action="approve_vendor_renewal"')
    } finally {
      await close(server)
    }
  })

  it('keeps the demo brand lowercase and suppresses generated fallback icons', async () => {
    const { server } = createBrowserbaseDemoServer({
      env: {} as NodeJS.ProcessEnv,
      runner: async () => fixtureResult,
    })
    const baseUrl = await listen(server)
    try {
      const root = await fetch(`${baseUrl}/`)
      const rootHtml = await root.text()
      expect(rootHtml).toContain('Browserbase WebMCP atrib proof')
      expect(rootHtml).toContain('<link rel="icon" href="data:," />')
      expect(rootHtml).toContain('media-tabs')
      expect(rootHtml).toContain('data-media-mode')
      expect(rootHtml).toContain("mediaModeButton('live'")
      expect(rootHtml).toContain("mediaModeButton('replay'")
      expect(rootHtml).toContain("fetch('/api/runs')")
      expect(rootHtml).toContain('visual-cursor')
      expect(rootHtml).toContain('Replay motion')
      expect(rootHtml).toContain('Open Live View')
      expect(rootHtml).toContain('Open Replay')
      expect(rootHtml).not.toContain('Atrib')

      const target = await fetch(`${baseUrl}/target`)
      const targetHtml = await target.text()
      expect(targetHtml).toContain('atrib action gate target')
      expect(targetHtml).toContain('<link rel="icon" href="data:," />')
      expect(targetHtml).not.toContain('Atrib')

      const favicon = await fetch(`${baseUrl}/favicon.ico`)
      expect(favicon.status).toBe(204)
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

async function waitForRunMedia(baseUrl: string, runId: string): Promise<BrowserbaseDemoRun> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = (await fetchJson(`${baseUrl}/api/runs/${runId}`)) as {
      ok: boolean
      run: BrowserbaseDemoRun
    }
    if (response.run.visual?.media.live_view.available) return response.run
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`run ${runId} did not expose live media`)
}
