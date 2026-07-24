// SPDX-License-Identifier: Apache-2.0

import { canonicalRecord, hexEncode, signRecord, type AtribRecord } from '@atrib/mcp'
import { bindArchiveServer, type ArchiveServerHandle } from '@atrib/archive-node'
import { startLogServer, type LogServer } from '@atrib/log-node'
import * as ed from '@noble/ed25519'
import { sha256, sha512 } from '@noble/hashes/sha2.js'
import { chromium, type Browser } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

ed.hashes.sha512 = sha512

let log: LogServer
let archive: ArchiveServerHandle
let browser: Browser

describe('public explorer live log stream', () => {
  beforeAll(async () => {
    log = await startLogServer({ port: 0 })
    archive = await bindArchiveServer(0, '127.0.0.1', {
      origin: 'archive.dashboard.test/v1',
      trustedLogEndpoints: [`${log.url}/v1`],
    })
    browser = await chromium.launch()
  }, 30_000)

  afterAll(async () => {
    await browser?.close()
    await archive?.close()
    await log?.close()
  }, 30_000)

  it('renders a newly accepted record without waiting for the polling fallback', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    page.setDefaultNavigationTimeout(5_000)
    const pageErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await page.route('https://datafa.st/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }),
    )
    const logEndpoint = `${log.url}/v1`
    const archiveEndpoint = `${archive.url}/v1`
    const query = new URLSearchParams({
      log: logEndpoint,
      archive: archiveEndpoint,
      directory: `${log.url}/v6`,
    })
    await page.goto(`${log.url}/dashboard?${query}`)

    await expect.poll(() => page.locator('#feed-live-status').textContent()).toContain('live')
    await expect.poll(() => page.locator('#feed-body tbody tr').count()).toBe(0)

    const record = await signedRecord()
    const recordHash = `sha256:${hexEncode(sha256(canonicalRecord(record)))}`
    const response = await fetch(`${logEndpoint}/entries`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(record),
    })
    expect(response.status).toBe(200)
    const proof = await response.json()
    const archiveResponse = await fetch(`${archiveEndpoint}/records`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ record_hash: recordHash, record, proof }),
    })
    expect(archiveResponse.status).toBe(201)

    await expect.poll(() => page.locator('#feed-body tbody tr').count()).toBe(1)
    await expect
      .poll(() => page.locator('#feed-body tbody tr').first().textContent())
      .toContain(recordHash.slice(0, 20))
    await expect.poll(() => page.locator('#feed-live-status').textContent()).toContain('live')

    await page.goto(`${log.url}/action/${recordHash}?${query}`, {
      waitUntil: 'domcontentloaded',
    })
    await expect.poll(() => page.getByText('record body', { exact: true }).count()).toBe(1)
    await expect.poll(() => page.getByText('available', { exact: true }).count()).toBeGreaterThan(0)
    await expect
      .poll(() => page.getByText('archived signed record body', { exact: true }).count())
      .toBe(1)
    await expect.poll(() => page.getByText('log entry projection', { exact: true }).count()).toBe(1)
    expect(pageErrors).toEqual([])

    await page.close()
  }, 30_000)
})

async function signedRecord(): Promise<AtribRecord> {
  const privateKey = ed.utils.randomSecretKey()
  const creatorKey = Buffer.from(await ed.getPublicKeyAsync(privateKey)).toString('base64url')
  const contextId = hexEncode(crypto.getRandomValues(new Uint8Array(16)))
  const chainRoot = `sha256:${hexEncode(sha256(new TextEncoder().encode(contextId)))}`
  const unsigned: AtribRecord = {
    spec_version: 'atrib/1.0',
    event_type: 'https://atrib.dev/v1/types/tool_call',
    timestamp: Date.now(),
    context_id: contextId,
    creator_key: creatorKey,
    chain_root: chainRoot,
    content_id: `sha256:${hexEncode(sha256(new TextEncoder().encode('dashboard-live')))}`,
    signature: '',
  }
  return signRecord(unsigned, privateKey)
}
