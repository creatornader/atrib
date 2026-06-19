// SPDX-License-Identifier: Apache-2.0

import { createServer, type Server, type ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { runInNewContext } from 'node:vm'
import { chromium, type Browser } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const root = join(process.cwd(), 'examples/google-stack-chain/visual')

let server: Server
let baseUrl: string
let browser: Browser

describe('Google stack chain visual workbench', () => {
  beforeAll(async () => {
    server = createServer(async (req, res) => {
      try {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1')
        const pathname = url.pathname === '/' ? '/index.html' : url.pathname
        if (pathname.startsWith('/runtime/')) {
          writeRuntimeMock(pathname, res)
          return
        }
        if (pathname === '/runtime-config.js') {
          res.setHeader('Content-Type', 'text/javascript; charset=utf-8')
          res.end("window.GOOGLE_STACK_RUNTIME_URL = ''\n")
          return
        }
        const filePath = join(root, pathname)
        const body = await readFile(filePath)
        res.setHeader('Content-Type', contentType(filePath))
        res.end(body)
      } catch {
        res.statusCode = 404
        res.end('not found')
      }
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('test server did not bind')
    baseUrl = `http://127.0.0.1:${address.port}`
    browser = await chromium.launch()
  }, 30_000)

  afterAll(async () => {
    await browser?.close()
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  }, 30_000)

  it('loads with an empty live chain and exposes the reference fixture on request', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 920 } })
    const consoleErrors: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    page.on('pageerror', (error) => consoleErrors.push(error.message))

    await page.goto(baseUrl)
    await expect.poll(() => page.title()).toBe('Google stack proof chain')
    await expect.poll(() => page.getByTestId('google-stack-visual').isVisible()).toBe(true)
    await expect
      .poll(() => page.locator('.skip-link').evaluate((element) => element.getBoundingClientRect().bottom))
      .toBeLessThanOrEqual(0)
    await expect.poll(() => page.locator('#stageTitle').textContent()).toBe('Live proof chain')
    await expect
      .poll(() => page.locator('.empty-chain').textContent())
      .toContain('Runtime records will appear here')
    await expect.poll(() => page.locator('.node').count()).toBe(0)
    await expect.poll(() => page.locator('#analyticsRows tr').count()).toBe(1)
    await page.locator('#viewReferenceSnapshot').click()
    await expect.poll(() => page.locator('#stageTitle').textContent()).toBe('Example run')
    await expect.poll(() => page.locator('.node').count()).toBe(4)
    await expect.poll(() => page.locator('#analyticsRows tr').count()).toBe(4)
    await expect
      .poll(() => page.locator('#proofStatus').textContent())
      .toBe('reference snapshot ready')
    await expect.poll(() => page.locator('#selectedTitle').textContent()).toBe('AP2 transaction')
    await expect.poll(() => page.locator('#protocolBadge').getAttribute('class')).toContain('AP2')
    await expect
      .poll(() => page.locator('#verifySelectedRecord').textContent())
      .toBe('Fixture check')
    await page.getByRole('button', { name: 'Fixture check' }).click()
    await expect
      .poll(() => page.locator('#verifyStatus').textContent())
      .toContain('Fixture checked')

    await page.getByRole('button', { name: 'Inspect ADK Python callback' }).click()
    await expect
      .poll(() => page.locator('#selectedTitle').textContent())
      .toBe('ADK Python callback')
    await expect.poll(() => page.locator('#protocolBadge').getAttribute('class')).toContain('ADK')
    await expect
      .poll(() => page.locator('#selectedHash').textContent())
      .toContain('sha256:70d0bb2c3e38194b065a1872bbf96861b8f9f0802d323c837ede32609b548a79')
    await expect
      .poll(() => page.locator('#analyticsRows tr.selected').textContent())
      .toContain('ADK Python')
    expect(consoleErrors).toEqual([])
    await page.close()
  })

  it('renders from file URL through the embedded snapshot fallback', async () => {
    const page = await browser.newPage({ viewport: { width: 1000, height: 720 } })
    const consoleErrors: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    page.on('pageerror', (error) => consoleErrors.push(error.message))

    await page.goto(pathToFileURL(join(root, 'index.html')).href)
    await expect
      .poll(() => page.locator('#proofStatus').textContent())
      .toBe('reference snapshot ready')
    await expect
      .poll(() => page.locator('.empty-chain').textContent())
      .toContain('Runtime records will appear here')
    await expect.poll(() => page.locator('.node').count()).toBe(0)
    await page.locator('#viewReferenceSnapshot').click()
    await expect.poll(() => page.locator('.node').count()).toBe(4)
    await expect.poll(() => page.locator('#analyticsRows tr').count()).toBe(4)
    expect(consoleErrors).toEqual([])
    await page.close()
  })

  it('starts an active runtime run from the workbench', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 920 } })
    const consoleErrors: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    page.on('pageerror', (error) => consoleErrors.push(error.message))

    await page.goto(`${baseUrl}?runtime=${encodeURIComponent(`${baseUrl}/runtime`)}`)
    await expect.poll(() => page.locator('#runtimeStatus').textContent()).toBe('Ready')
    await expect.poll(() => page.locator('#runtimeFlow .runtime-flow-step').count()).toBe(3)
    await expect.poll(() => page.locator('.segment').count()).toBe(2)
    await expect.poll(() => page.locator('[data-jump]').count()).toBe(0)
    await expect.poll(() => page.locator('.node').count()).toBe(0)
    await expect.poll(() => page.locator('#analyticsRows tr').count()).toBe(1)
    await page.getByRole('button', { name: 'Start run' }).click()
    await expect.poll(() => page.locator('#runtimeStatus').textContent()).toBe('Complete')
    await expect.poll(() => page.locator('#runtimeRunId').textContent()).toBe('mock-active-run')
    await expect.poll(() => page.locator('#runtimeAdkHash').textContent()).toContain('sha256:adk')
    await expect
      .poll(() => page.locator('#runtimeFlow .runtime-flow-step.complete').count())
      .toBe(3)
    await expect.poll(() => page.locator('.runtime-node').count()).toBe(4)
    await expect
      .poll(() => page.locator('.source-badge').first().textContent())
      .toBe('verified replay packet')
    await expect
      .poll(() => page.locator('#selectedTitle').textContent())
      .toBe('ADK JS tool callback')
    await expect
      .poll(() => page.locator('#stageMode').textContent())
      .toContain('Active runtime path')
    await expect.poll(() => page.locator('#analyticsRows tr').count()).toBe(4)
    await expect
      .poll(() => page.locator('#analyticsRows tr').last().textContent())
      .toContain('ADK JS')
    await page.locator('#analyticsRows tr').nth(1).click()
    await expect
      .poll(() => page.locator('#selectedTitle').textContent())
      .toBe('A2A remote evidence accepted')
    await page.locator('#analyticsRows tr').nth(2).click()
    await expect
      .poll(() => page.locator('#selectedTitle').textContent())
      .toBe('A2A receiver follow-up')
    await page.locator('#analyticsRows tr').last().click()
    await expect
      .poll(() => page.locator('#selectedTitle').textContent())
      .toBe('ADK JS tool callback')
    await expect.poll(() => page.locator('#resetRuntimeView').isEnabled()).toBe(true)
    await expect.poll(() => page.locator('#copySelectedHash').isEnabled()).toBe(true)
    await expect.poll(() => page.locator('#copySelectedJson').isEnabled()).toBe(true)
    await expect.poll(() => page.locator('#viewSelectedRecord').isEnabled()).toBe(true)
    await expect.poll(() => page.locator('#verifySelectedRecord').textContent()).toBe('Live verify')
    await expect.poll(() => page.locator('#checkList .check-state').count()).toBeGreaterThan(0)
    await expect
      .poll(() => page.locator('#checkList .check-state').first().textContent())
      .toBe('Accepted')
    await expect
      .poll(() => page.locator('#checkList strong').first().textContent())
      .toBe('A2A receiver informs ADK callback')
    await page.getByRole('button', { name: 'Live verify' }).click()
    await expect.poll(() => page.locator('#verifyStatus').textContent()).toContain('Live verified')
    await expect
      .poll(() => page.locator('#checkList strong').allTextContents())
      .toEqual([
        'Cloud Run run refetched',
        'Runtime stage present',
        'Record hash matches',
        'Stage complete',
        'Parent context present',
        'Chain relationship accepted',
      ])
    await expect
      .poll(() => page.locator('#checkList .check-state').allTextContents())
      .toEqual(['Accepted', 'Accepted', 'Accepted', 'Accepted', 'Accepted', 'Accepted'])
    await expect
      .poll(() => page.locator('#checkList').textContent())
      .toContain('A2A receiver informs ADK JS is true')
    await expect
      .poll(() => page.locator('#runtimeChecks').evaluate((element) => element.scrollHeight))
      .toBeLessThanOrEqual(
        await page.locator('#runtimeChecks').evaluate((element) => element.clientHeight + 1),
      )
    await page.getByRole('button', { name: 'View full JSON' }).click()
    await expect
      .poll(() =>
        page.locator('#recordDialog').evaluate((dialog) => (dialog as HTMLDialogElement).open),
      )
      .toBe(true)
    await expect
      .poll(() => page.locator('#recordDialogJson').textContent())
      .toContain(
        '"record_hash": "sha256:adk0000000000000000000000000000000000000000000000000000000000000"',
      )
    await page.getByRole('button', { name: 'Close' }).click()
    await expect
      .poll(() =>
        page.locator('#recordDialog').evaluate((dialog) => (dialog as HTMLDialogElement).open),
      )
      .toBe(false)
    await expect.poll(() => page.locator('.runtime-state-badge.complete').count()).toBe(0)
    await page.getByRole('button', { name: 'Reset view' }).click()
    await expect.poll(() => page.locator('#runtimeStatus').textContent()).toBe('Ready')
    await expect.poll(() => page.locator('.node').count()).toBe(0)
    await expect
      .poll(() => page.locator('#selectedTitle').textContent())
      .toBe('No live record selected')
    await expect.poll(() => page.locator('#resetRuntimeView').isDisabled()).toBe(true)
    await expect.poll(() => page.locator('#viewSelectedRecord').isDisabled()).toBe(true)
    await expect.poll(() => page.locator('#verifySelectedRecord').isDisabled()).toBe(true)
    expect(consoleErrors).toEqual([])
    await page.close()
  })

  it('keeps mobile controls touch-safe and readable', async () => {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
    })

    await page.goto(baseUrl)
    const audit = await page.evaluate(() => {
      const controls = [...document.querySelectorAll('button,[role="button"]')]
        .map((element) => {
          const rect = element.getBoundingClientRect()
          return {
            height: rect.height,
            text: (element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 80),
            width: rect.width,
          }
        })
        .filter((control) => control.width > 0 && control.height > 0)
      const visibleText = [
        ...document.querySelectorAll('p,li,td,th,button,h1,h2,h3,strong,span,dt,dd'),
      ]
        .filter((element) => {
          const rect = element.getBoundingClientRect()
          return rect.width > 0 && rect.height > 0 && (element.textContent ?? '').trim()
        })
        .map((element) => Number(window.getComputedStyle(element).fontSize.replace('px', '')))

      return {
        clientWidth: document.documentElement.clientWidth,
        emptyAnalyticsFits: (() => {
          const cell = document.querySelector('#analyticsRows .empty-row td')
          return cell ? cell.scrollWidth <= cell.clientWidth + 1 : false
        })(),
        minVisibleFont: Math.min(...visibleText),
        smallControls: controls.filter((control) => control.width < 44 || control.height < 44),
        scrollWidth: document.documentElement.scrollWidth,
      }
    })

    expect(audit.smallControls).toEqual([])
    expect(audit.emptyAnalyticsFits).toBe(true)
    expect(audit.minVisibleFont).toBeGreaterThanOrEqual(12)
    expect(audit.scrollWidth).toBe(audit.clientWidth)
    await page.close()
  })

  it('pins the static visual fixture to the current proof snapshot', async () => {
    const fixture = JSON.parse(await readFile(join(root, 'proof-snapshot.json'), 'utf8'))
    const snapshotScript = await readFile(join(root, 'proof-snapshot.js'), 'utf8')
    const context = { window: {} as { GOOGLE_STACK_PROOF_SNAPSHOT?: unknown } }
    runInNewContext(snapshotScript, context)
    const scriptFixture = context.window.GOOGLE_STACK_PROOF_SNAPSHOT

    expect(scriptFixture).toEqual(fixture)
    expect(fixture.nodes.map((node: { record_hash: string }) => node.record_hash)).toEqual([
      'sha256:e5f103d959cbb1e316e6d658b35fabc547b6b9b3bd530d0165cfbe48155cc6db',
      'sha256:23e25fd31fc81cf8f6d668cf68454d05c6018451f3a7467fc15f2649277e42f9',
      'sha256:1225fb6849cab06d9bec936abdf28f5ff1a4e2872ea8f5a87c1b469c54c18fb2',
      'sha256:70d0bb2c3e38194b065a1872bbf96861b8f9f0802d323c837ede32609b548a79',
    ])
    expect(
      fixture.analytics.rows.map((row: { trace_id: string | null; span_id: string | null }) => [
        row.trace_id,
        row.span_id,
      ]),
    ).toEqual([
      [null, null],
      ['b31c447d70e4b50bacf6440165eeaa1e', 'b115b227841db8e4'],
      ['b31c447d70e4b50bacf6440165eeaa1e', '1d6154dbc8bded9a'],
      ['b31c447d70e4b50bacf6440165eeaa1e', 'f1973f9540673909'],
    ])
  })
})

function contentType(filePath: string): string {
  switch (extname(filePath)) {
    case '.html':
      return 'text/html; charset=utf-8'
    case '.css':
      return 'text/css; charset=utf-8'
    case '.js':
      return 'text/javascript; charset=utf-8'
    case '.json':
      return 'application/json; charset=utf-8'
    default:
      return 'application/octet-stream'
  }
}

function writeRuntimeMock(pathname: string, res: ServerResponse): void {
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  if (pathname === '/runtime/v1/runtime-state') {
    res.end(
      JSON.stringify({
        ok: true,
        capabilities: { analytics_write_enabled: false },
        gate: mockGate(),
      }),
    )
    return
  }
  if (pathname === '/runtime/api/runs/stream') {
    const run = mockRun()
    const [ap2Step, a2aStep, adkStep] = run.steps
    if (!ap2Step || !a2aStep || !adkStep) throw new Error('mock run is missing runtime steps')
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
    res.end(
      [
        {
          ok: true,
          event: {
            type: 'run_started',
            run_id: run.run_id,
            mode: run.mode,
            prompt: run.prompt,
            timestamp: run.created_at,
          },
        },
        {
          ok: true,
          event: {
            type: 'step_started',
            key: 'ap2_gate',
            protocol: 'AP2',
            label: 'AP2 evidence gate',
            timestamp: run.created_at,
          },
        },
        { ok: true, event: { type: 'step_completed', step: ap2Step, timestamp: run.created_at } },
        {
          ok: true,
          event: {
            type: 'step_started',
            key: 'a2a_handoff',
            protocol: 'A2A',
            label: 'A2A verifier handoff',
            timestamp: a2aStep.timestamp,
          },
        },
        {
          ok: true,
          event: { type: 'step_completed', step: a2aStep, timestamp: a2aStep.timestamp },
        },
        {
          ok: true,
          event: {
            type: 'step_started',
            key: 'adk_tool_callback',
            protocol: 'ADK JS',
            label: 'ADK tool callback',
            timestamp: adkStep.timestamp,
          },
        },
        {
          ok: true,
          event: { type: 'step_completed', step: adkStep, timestamp: adkStep.timestamp },
        },
        { ok: true, event: { type: 'run_completed', run, timestamp: run.updated_at } },
        {
          ok: true,
          event: { type: 'analytics_write', analytics_write: null, timestamp: run.updated_at },
        },
      ]
        .map((event) => JSON.stringify(event))
        .join('\n') + '\n',
    )
    return
  }
  if (pathname === '/runtime/api/runs' || pathname === '/runtime/api/runs/mock-active-run') {
    res.end(JSON.stringify({ ok: true, run: mockRun(), analytics_write: null }))
    return
  }
  res.statusCode = 404
  res.end(JSON.stringify({ ok: false, error: 'not_found' }))
}

function mockGate() {
  return {
    allowed: true,
    decision: 'allow_next_action',
    reason: 'Verified AP2 evidence can become executable context for the next agent action.',
    packet_source: 'mock runtime replay fixture',
    content_id: 'sha256:content0000000000000000000000000000000000000000000000000000000000',
    record_hash: 'sha256:ap20000000000000000000000000000000000000000000000000000000000000',
    checks: [
      { key: 'ap2_transaction_detected', ok: true, detail: 'AP2 content id present.' },
      {
        key: 'ap2_vi_evidence_verified',
        ok: true,
        detail: 'AP2 receipt and VI evidence verified.',
      },
    ],
    verifier_errors: [],
    analytics_row: mockAnalyticsRow({
      event_type: 'atrib.ap2.next_action_allowed',
      atrib_record_hash: 'sha256:ap20000000000000000000000000000000000000000000000000000000000000',
      protocol: 'AP2',
    }),
    next_action_context: {
      protocol: 'AP2',
      atrib_content_id: 'sha256:content0000000000000000000000000000000000000000000000000000000000',
      informed_by: ['sha256:ap20000000000000000000000000000000000000000000000000000000000000'],
      runtime_decision: 'allow_next_action',
    },
  }
}

function mockRun() {
  return {
    ok: true,
    run_id: 'mock-active-run',
    status: 'complete',
    mode: 'replay',
    prompt: 'Continue only if the AP2 evidence verifies.',
    created_at: '2026-06-18T00:00:00.000Z',
    updated_at: '2026-06-18T00:00:02.000Z',
    duration_ms: 2000,
    gate: mockGate(),
    steps: [
      {
        key: 'ap2_gate',
        protocol: 'AP2',
        status: 'complete',
        label: 'AP2 evidence gate',
        detail: 'AP2 gate accepted.',
        timestamp: '2026-06-18T00:00:00.000Z',
        record_hash: 'sha256:ap20000000000000000000000000000000000000000000000000000000000000',
      },
      {
        key: 'a2a_handoff',
        protocol: 'A2A',
        status: 'complete',
        label: 'A2A verifier handoff',
        detail: 'A2A handoff accepted.',
        timestamp: '2026-06-18T00:00:01.000Z',
        record_hash: 'sha256:a2a0000000000000000000000000000000000000000000000000000000000000',
      },
      {
        key: 'adk_tool_callback',
        protocol: 'ADK JS',
        status: 'complete',
        label: 'ADK tool callback',
        detail: 'ADK callback signed.',
        timestamp: '2026-06-18T00:00:02.000Z',
        record_hash: 'sha256:adk0000000000000000000000000000000000000000000000000000000000000',
      },
    ],
    chain: {
      ap2_informs_a2a_remote: true,
      a2a_remote_informs_receiver: true,
      a2a_receiver_informs_adk_js: true,
    },
    analytics_rows: [
      mockAnalyticsRow({
        event_type: 'atrib.ap2.next_action_allowed',
        atrib_record_hash:
          'sha256:ap20000000000000000000000000000000000000000000000000000000000000',
        protocol: 'AP2',
      }),
      mockAnalyticsRow({
        event_type: 'atrib.a2a.remote_evidence_accepted',
        atrib_record_hash:
          'sha256:a2aremote000000000000000000000000000000000000000000000000000000000',
        protocol: 'A2A',
      }),
      mockAnalyticsRow({
        event_type: 'atrib.a2a.receiver_followup_signed',
        atrib_record_hash:
          'sha256:a2a0000000000000000000000000000000000000000000000000000000000000',
        protocol: 'A2A',
      }),
      mockAnalyticsRow({
        event_type: 'atrib.adk_js.tool_callback_signed',
        atrib_record_hash:
          'sha256:adk0000000000000000000000000000000000000000000000000000000000000',
        protocol: 'ADK JS',
      }),
    ],
    value_add: {
      pre_action_trust_transfer: 'The ADK tool action receives verified AP2 and A2A evidence.',
      runtime_gate: 'The next action is blocked unless AP2 evidence passes.',
      analytics_join: 'Rows carry atrib hashes.',
    },
    caveats: [],
  }
}

function mockAnalyticsRow({
  event_type,
  atrib_record_hash,
  protocol,
}: {
  event_type: string
  atrib_record_hash: string
  protocol: string
}) {
  return {
    timestamp: '2026-06-18T00:00:00.000Z',
    event_type,
    agent: protocol === 'ADK JS' ? 'google_adk_atrib_smoke_agent' : 'mock-agent',
    session_id: 'mock-session',
    invocation_id: 'mock-invocation',
    user_id: 'google-stack-demo-operator',
    trace_id: '11111111111111111111111111111111',
    span_id: '2222222222222222',
    parent_span_id: '',
    status: 'OK',
    error_message: '',
    is_truncated: false,
    atrib_record_hash,
    atrib_parent_record_hashes: '[]',
    protocol,
  }
}
