// SPDX-License-Identifier: Apache-2.0

import { expect, test, type Locator, type Page } from '@playwright/test'

interface BrowserTraceResponse {
  records: Array<{ record: { timestamp: number } }>
}

async function expectCleanConsole(page: Page, action: () => Promise<void>): Promise<void> {
  const messages: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') messages.push(message.text())
  })
  page.on('pageerror', (error) => messages.push(error.message))
  await action()
  expect(messages).toEqual([])
}

async function createProposal(page: Page, path = '/'): Promise<void> {
  await page.goto(path)
  await expect(page).toHaveTitle('Cloudflare Agent Trace')
  await expect(page.getByTestId('approval-trace-app')).toBeVisible()
  await expect(page.locator('#answer')).toContainText('Trigger received')
  await expect(page.locator('#statusTitle')).toHaveText('Halted for human review', {
    timeout: 15_000,
  })
  await expect(page.locator('#answer')).toContainText('Context gathered')
  await expect(page.locator('#answer')).toContainText('Policy and intent analysis')
  await expect(page.locator('#answer')).toContainText('Proposed action generated')
  await expect(page.locator('#answer')).toContainText('Human review halted')
  await expect(page.getByRole('button', { name: 'Approve and resume' })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Reject' })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Request changes' })).toBeEnabled()
  await expect(page.locator('#timeline .event')).toHaveCount(3)
  await expect(page.locator('#answer')).toContainText('Human review halted')
  await expect(page.locator('#answer')).toContainText('Execution is stopped')
}

async function openTimelineRecord(page: Page, label: string): Promise<void> {
  await page.locator('#timeline .event').filter({ hasText: label }).click()
  await expect(page.locator('#timeline .event.selected')).toContainText(label)
  await expect(page.locator('#receipts pre')).toContainText(`"label": "${label}"`)
  await expect(page.locator('#receipts pre')).toContainText('"record_hash": "sha256:')
}

async function expectCopies(button: Locator): Promise<void> {
  await button.click()
  await expect(button).toHaveAttribute('data-copy-state', 'copied')
}

test.describe('Cloudflare approval trace browser UI', () => {
  test('clicks through approved execution and opens the signed receipt', async ({ page }) => {
    await expectCleanConsole(page, async () => {
      await page.context().grantPermissions(['clipboard-write'])
      await createProposal(page)

      const visibleTimes = await page.locator('#answer .progress-time').allTextContents()
      const populatedTimes = visibleTimes.filter((time) => time !== '-')
      expect(new Set(populatedTimes).size).toBeGreaterThan(3)

      const runId = await page.locator('#runIdLabel').textContent()
      expect(runId).toBeTruthy()
      const pendingRun = await page.evaluate<BrowserTraceResponse, string>(async (id) => {
        const response = await fetch('/api/runs/' + id)
        return (await response.json()) as BrowserTraceResponse
      }, runId ?? '')
      const pendingTimestamps = pendingRun.records.map(
        (record) => record.record.timestamp,
      )
      expect(new Set(pendingTimestamps).size).toBe(pendingTimestamps.length)

      await page.locator('#riskDetailsToggle').click()
      await expect(page.locator('#riskDetails')).toBeVisible()
      await expect(page.locator('#riskDetails')).toContainText('Human review gate')

      await page.getByRole('button', { name: 'Record details' }).click()
      await expect(page.locator('#receiptSummary')).toContainText('Record hash')
      await expect(page.locator('#receiptSummary')).toContainText('Timestamp')
      await page.getByRole('button', { name: 'Summary' }).click()

      await expectCopies(page.getByRole('button', { name: 'Copy trace ID' }))
      await expectCopies(page.getByRole('button', { name: 'Copy Agent signature' }))
      await expectCopies(page.locator('.trace-integrity').getByRole('button', { name: 'Copy Merkle root' }))
      await expectCopies(page.getByRole('button', { name: 'Copy receipt' }))
      await expect(page.locator('#verification').getByRole('link', { name: 'View proof' })).toHaveAttribute(
        'href',
        /log\.atrib\.dev|\/api\/runs\//,
      )
      await page.locator('#verification').getByRole('button', { name: 'Verify' }).click()
      await expect(page.locator('#verification').getByRole('button', { name: 'Verified' })).toBeVisible()
      const pendingDownload = page.waitForEvent('download')
      await page.getByRole('button', { name: 'Download receipt' }).click()
      expect((await pendingDownload).suggestedFilename()).toContain('cloudflare-trace')

      await page.getByRole('button', { name: 'Approve and resume' }).click()

      await expect(page.locator('#statusTitle')).toHaveText('Trace complete', { timeout: 30_000 })
      await expect(page.locator('[data-step="halt"]')).toContainText('Approved')
      await expect(page.locator('[data-step="halt"]')).not.toContainText('Awaiting review')
      await expect(page.locator('#answer')).toContainText('Agent resumed through MCP')
      await expect(page.locator('#answer')).toContainText('Audit ready')
      await expect(page.locator('#answer')).toContainText('repo_files.server/middleware/rate_limit.ts')
      await expect(page.locator('#timeline .event')).toHaveCount(8)
      await expect(page.getByRole('button', { name: 'Approve and resume' })).toBeDisabled()
      await expect(page.getByRole('button', { name: 'Reject' })).toBeDisabled()

      await openTimelineRecord(page, 'execution')
      await expect(page.locator('#receipts pre')).toContainText('"signer": "action_mcp"')
      await expect(page.locator('#receipts pre')).toContainText('"tool_name": "write_file"')
      await expect(page.locator('#receipts pre')).toContainText('"proof": null')
      await expectCopies(page.getByRole('button', { name: 'Copy Action MCP signature' }))
      await expect(page.locator('#verification').getByRole('link', { name: 'View proof' })).toHaveAttribute(
        'href',
        /log\.atrib\.dev|\/api\/runs\//,
      )
      const executionDownload = page.waitForEvent('download')
      await page.locator('#verification').getByRole('button', { name: 'Download' }).click()
      expect((await executionDownload).suggestedFilename()).toContain('cloudflare-trace-execution')
    })
  })

  test('clicks through rejection and shows no action MCP record', async ({ page }) => {
    await expectCleanConsole(page, async () => {
      await createProposal(page)
      await page.getByRole('button', { name: 'Reject' }).click()

      await expect(page.locator('#statusTitle')).toHaveText('Rejected')
      await expect(page.locator('#answer')).toContainText('not run')
      await expect(page.locator('#timeline .event')).toHaveCount(4)
      await expect(page.locator('#timeline')).not.toContainText('action_mcp')

      await openTimelineRecord(page, 'rejection')
      await expect(page.locator('#receipts pre')).toContainText('"signer": "human"')
      await expect(page.locator('#receipts pre')).toContainText('"decision": "rejected"')
    })
  })

  test('clicks through diagnostic error and opens the outcome receipt', async ({ page }) => {
    await expectCleanConsole(page, async () => {
      await createProposal(page, '/?simulate_error=1')
      await page.getByRole('button', { name: 'Approve and resume' }).click()

      await expect(page.locator('#statusTitle')).toHaveText('Diagnostic trace complete', {
        timeout: 30_000,
      })
      await expect(page.locator('#answer')).toContainText('error')
      await expect(page.locator('#answer')).toContainText('none')
      await expect(page.locator('#timeline .event')).toHaveCount(8)

      await openTimelineRecord(page, 'outcome')
      await expect(page.locator('#receipts pre')).toContainText('"signer": "action_mcp"')
      await expect(page.locator('#receipts pre')).toContainText(
        '"error": "repository_file_version_conflict"',
      )
      await expect(page.locator('#receipts pre')).toContainText(
        '"diagnostic": "The repository file changed after approval."',
      )
    })
  })
})
