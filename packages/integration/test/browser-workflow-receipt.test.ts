// SPDX-License-Identifier: Apache-2.0

import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { canonicalRecord, genesisChainRoot, hexEncode, sha256, verifyRecord } from '@atrib/mcp'
import { describe, expect, it } from 'vitest'
import {
  BrowserWorkflowReceiptRecorder,
  runBrowserUseWorkflowReceiptSmoke,
  runBrowserWorkflowReceiptSmoke,
  runStagehandWorkflowReceiptSmoke,
} from '../src/browser-workflow-receipt.js'

const execFileAsync = promisify(execFile)
const workspaceRoot = join(process.cwd(), '..', '..')
const tsxBin = join(
  workspaceRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'tsx.cmd' : 'tsx',
)

describe('browser workflow receipt example', () => {
  it('signs a deterministic browser-action sequence through the runnable smoke', async () => {
    const { stdout } = await execFileAsync(
      tsxBin,
      ['examples/browser-workflow/browser-workflow-receipt-smoke.ts'],
      {
        cwd: process.cwd(),
        timeout: 30000,
        maxBuffer: 1024 * 1024,
      },
    )
    const result = JSON.parse(stdout.trim()) as Awaited<
      ReturnType<typeof runBrowserWorkflowReceiptSmoke>
    >

    expect(result.ok).toBe(true)
    expect(result.signed_records).toBe(4)
    expect(result.operations).toEqual([
      'browser.action.observe',
      'browser.action.click',
      'browser.action.fill',
      'browser.action.submit',
    ])
    expect(result.record_hashes).toHaveLength(4)
    expect(result.final_receipt).toMatchObject({
      status: 'submitted',
      confirmation_id: 'browser-workflow-receipt-001',
    })
    expect(result.privacy).toEqual({
      public_records_hash_only: true,
      local_sidecars_keep_payloads: true,
    })
    expect(result.caveats.join(' ')).toContain('not Playwright')
  }, 30000)

  it('signs a real browser-use BrowserSession workflow through the runnable smoke', async () => {
    const { stdout } = await execFileAsync(
      tsxBin,
      ['examples/browser-workflow/browser-use-workflow-receipt-smoke.ts'],
      {
        cwd: process.cwd(),
        timeout: 30000,
        maxBuffer: 1024 * 1024,
      },
    )
    const result = JSON.parse(stdout.trim()) as Awaited<
      ReturnType<typeof runBrowserUseWorkflowReceiptSmoke>
    >

    expect(result.ok).toBe(true)
    expect(result.host).toMatchObject({
      framework: 'browser-use',
      package_version: '0.7.1',
      page_title: 'Browser Use vendor approval',
      page_url: 'about:blank',
    })
    expect(result.signed_records).toBe(4)
    expect(result.operations).toEqual([
      'browser.action.observe',
      'browser.action.click',
      'browser.action.fill',
      'browser.action.submit',
    ])
    expect(result.record_hashes).toHaveLength(4)
    expect(result.final_receipt).toMatchObject({
      status: 'submitted',
      confirmation_id: 'browser-use-workflow-receipt-001',
    })
    expect(result.privacy).toEqual({
      public_records_hash_only: true,
      local_sidecars_keep_payloads: true,
    })
    expect(result.caveats.join(' ')).toContain('not a live Browser Use cloud task')
    expect(stdout).not.toContain('private browser-use note')
  }, 30000)

  it('signs a local Stagehand workflow through the runnable smoke', async () => {
    const { stdout } = await execFileAsync(
      tsxBin,
      ['examples/browser-workflow/stagehand-workflow-receipt-smoke.ts'],
      {
        cwd: process.cwd(),
        timeout: 30000,
        maxBuffer: 1024 * 1024,
      },
    )
    const result = JSON.parse(stdout.trim()) as Awaited<
      ReturnType<typeof runStagehandWorkflowReceiptSmoke>
    >

    expect(result.ok).toBe(true)
    expect(result.host).toMatchObject({
      framework: 'stagehand',
      package_version: '3.5.0',
      environment: 'LOCAL',
      action_mode: 'pre-resolved-stagehand-act',
      extracted_confirmation_seen: true,
    })
    expect(result.signed_records).toBe(4)
    expect(result.operations).toEqual([
      'browser.action.observe',
      'browser.action.click',
      'browser.action.fill',
      'browser.action.submit',
    ])
    expect(result.record_hashes).toHaveLength(4)
    expect(result.final_receipt).toMatchObject({
      status: 'submitted',
      confirmation_id: 'stagehand-workflow-receipt-001',
    })
    expect(result.privacy).toEqual({
      public_records_hash_only: true,
      local_sidecars_keep_payloads: true,
    })
    expect(result.caveats.join(' ')).toContain('not a Browserbase cloud session')
    expect(stdout).not.toContain('private stagehand note')
  }, 30000)

  it('chains records and keeps form content out of public records', async () => {
    const secret = 'private browser note'
    const contextId = '22222222222222222222222222222222'
    const recorder = new BrowserWorkflowReceiptRecorder({
      privateKey: new Uint8Array(32).fill(24),
      contextId,
      logSubmission: 'disabled',
      now: () => 1_779_840_000_000,
    })

    await recorder.action({
      operation: 'fill',
      pageUrl: 'https://demo.browser-agent.local/form',
      args: { selector: '#note', value: secret },
      run: () => ({ value_length: secret.length }),
    })
    await recorder.action({
      operation: 'submit',
      pageUrl: 'https://demo.browser-agent.local/form',
      args: { selector: '#submit', form_value: secret },
      run: () => ({ status: 'submitted' }),
    })

    const records = recorder.getSignedRecords()
    const sidecars = recorder.getSidecars()
    const firstHash = `sha256:${hexEncode(sha256(canonicalRecord(records[0]!)))}`

    expect(records).toHaveLength(2)
    expect(records[0]!.chain_root).toBe(genesisChainRoot(contextId))
    expect(records[1]!.chain_root).toBe(firstHash)
    expect(JSON.stringify(records)).not.toContain(secret)
    expect(JSON.stringify(sidecars)).toContain(secret)
    expect(await verifyRecord(records[0]!)).toBe(true)
    expect(await verifyRecord(records[1]!)).toBe(true)
  })
})
