// SPDX-License-Identifier: Apache-2.0

import { createServer, type Server } from 'node:http'
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
  })

  it('renders the selectable proof chain and analytics fixture', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 920 } })
    const consoleErrors: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    page.on('pageerror', (error) => consoleErrors.push(error.message))

    await page.goto(baseUrl)
    await expect.poll(() => page.title()).toBe('Google stack proof chain')
    await expect.poll(() => page.getByTestId('google-stack-visual').isVisible()).toBe(true)
    await expect.poll(() => page.locator('.node').count()).toBe(4)
    await expect.poll(() => page.locator('#analyticsRows tr').count()).toBe(4)
    await expect.poll(() => page.locator('#proofStatus').textContent()).toBe('local proof ready')
    await expect.poll(() => page.locator('#selectedTitle').textContent()).toBe('AP2 transaction')

    await page.getByRole('button', { name: 'Inspect ADK Python callback' }).click()
    await expect
      .poll(() => page.locator('#selectedTitle').textContent())
      .toBe('ADK Python callback')
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
    await expect.poll(() => page.locator('#proofStatus').textContent()).toBe('local proof ready')
    await expect.poll(() => page.locator('.node').count()).toBe(4)
    await expect.poll(() => page.locator('#analyticsRows tr').count()).toBe(4)
    expect(consoleErrors).toEqual([])
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
