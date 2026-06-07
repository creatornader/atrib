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
  await expect(page.locator('#runIdLabel')).not.toHaveText('pending')
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
  const timelineColumns = await page.evaluate<string[]>(`Array.from(document.querySelector('#timeline .record-timeline')?.firstElementChild?.children ?? [])
    .slice(0, 2)
    .map((child) => String(child.className))`)
  expect(timelineColumns[0]).toContain('event-marker')
  expect(timelineColumns[1]).toContain('event-time')
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

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate<{
    bodyWidth: number
    documentWidth: number
    nodes: Array<{ className: string; tagName: string; text: string }>
    viewportWidth: number
  }>(`(() => {
    const nodes = Array.from(document.querySelectorAll('*'))
      .map((element) => {
        const rect = element.getBoundingClientRect()
        if (rect.width === 0 || rect.height === 0) return null
        if (rect.left >= -1 && rect.right <= window.innerWidth + 1) return null
        return {
          className: String(element.className),
          tagName: element.tagName,
          text: element.textContent?.trim().replace(/\s+/g, ' ').slice(0, 80) ?? '',
        }
      })
      .filter(Boolean)
    return {
      bodyWidth: document.body.scrollWidth,
      documentWidth: document.documentElement.scrollWidth,
      nodes,
      viewportWidth: window.innerWidth,
    }
  })()`)
  expect(overflow.bodyWidth).toBeLessThanOrEqual(overflow.viewportWidth)
  expect(overflow.documentWidth).toBeLessThanOrEqual(overflow.viewportWidth)
  expect(overflow.nodes).toEqual([])
}

async function expectHeaderMenuAboveContent(page: Page): Promise<void> {
  const menuHit = await page.evaluate<boolean>(`(() => {
    const menu = document.querySelector('#headerActions')
    if (!menu || menu.hidden) return false
    const rect = menu.getBoundingClientRect()
    const x = Math.floor(rect.left + rect.width / 2)
    const y = Math.floor(rect.top + Math.min(rect.height - 2, 18))
    return Boolean(document.elementFromPoint(x, y)?.closest('#headerActions'))
  })()`)
  expect(menuHit).toBe(true)
}

test.describe('Cloudflare approval trace browser UI', () => {
  test('clicks through approved execution and opens the signed receipt', async ({ page }) => {
    await expectCleanConsole(page, async () => {
      await page.context().grantPermissions(['clipboard-write'])
      await createProposal(page)
      await expectNoHorizontalOverflow(page)

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

      await page.locator('#diffWrapToggle').click()
      await expect(page.locator('#diffWrapToggle')).toHaveAttribute('aria-pressed', 'true')
      await expect(page.locator('.diff-code')).toHaveClass(/wrap/)
      const threeLineDiffCount = await page.locator('.diff-line').count()
      await page.locator('#diffContext').selectOption('all')
      await expect.poll(async () => page.locator('.diff-line').count()).toBeGreaterThan(threeLineDiffCount)
      await page.locator('#diffContext').selectOption('6')
      await expect(page.locator('.diff')).toHaveAttribute('data-context-lines', '6')

      await page.locator('#headerMenu').click()
      await expect(page.locator('#headerActions')).toBeVisible()
      await expect(page.locator('[data-header-action="copy-link"]')).toBeEnabled()
      await expect(page.locator('[data-header-action="open-json"]')).toBeEnabled()
      await expect(page.locator('[data-header-action="reset"]')).toBeEnabled()
      await expectHeaderMenuAboveContent(page)
      await page.keyboard.press('Escape')
      await expect(page.locator('#headerActions')).toBeHidden()

      await page.getByRole('tab', { name: 'Record details' }).click()
      await expect(page.locator('#receiptSummary')).toContainText('Record hash')
      await expect(page.locator('#receiptSummary')).toContainText('Timestamp')
      await page.getByRole('tab', { name: 'Summary' }).click()
      const prettyReceiptLines = await page.locator('#receipts .json-line').count()
      expect(prettyReceiptLines).toBeGreaterThan(1)
      await page.locator('#receiptFormat').selectOption('compact')
      await expect.poll(async () => page.locator('#receipts .json-line').count()).toBe(1)
      await page.locator('#receiptFormat').selectOption('pretty')
      await expect.poll(async () => page.locator('#receipts .json-line').count()).toBeGreaterThan(1)

      await expectCopies(page.getByRole('button', { name: 'Copy trace ID' }))
      await expectCopies(page.getByRole('button', { name: 'Copy Agent signature' }))
      await expectCopies(page.locator('.trace-integrity').getByRole('button', { name: 'Copy Merkle root' }))
      await expectCopies(page.getByRole('button', { name: 'Copy receipt' }))
      await expect(page.locator('#verification').getByRole('link', { name: 'View proof' })).toHaveAttribute(
        'href',
        /log\.atrib\.dev|\/api\/runs\//,
      )
      await page.locator('#verification').getByRole('button', { name: 'Verify' }).click()
      await expect(page.locator('#verificationResult')).toContainText('Record hash matches')
      await expect(page.locator('#verificationResult')).toContainText('Signature valid')
      await expect(page.locator('#verificationResult')).toContainText('Receipt verified')
      await expect(page.locator('#verification').getByRole('button', { name: 'Verified' })).toBeVisible()
      const pendingDownload = page.waitForEvent('download')
      await page.getByRole('button', { name: 'Download receipt' }).click()
      expect((await pendingDownload).suggestedFilename()).toContain('cloudflare-trace')

      await page.getByRole('button', { name: 'Approve and resume' }).click()

      await expect(page.locator('#statusTitle')).toHaveText('Trace complete', { timeout: 30_000 })
      await expectNoHorizontalOverflow(page)
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

  test('keeps the desktop trace layout contained through the live stages', async ({ page }) => {
    await expectCleanConsole(page, async () => {
      await page.setViewportSize({ width: 1365, height: 768 })
      await page.goto('/')
      await expect(page).toHaveTitle('Cloudflare Agent Trace')
      await expect(page.getByTestId('approval-trace-app')).toBeVisible()
      await expectNoHorizontalOverflow(page)

      await expect(page.locator('#statusTitle')).toHaveText('Halted for human review', {
        timeout: 15_000,
      })
      await expect(page.locator('[data-step="halt"]')).toContainText('Awaiting review')
      await expectNoHorizontalOverflow(page)

      const firstRunId = await page.locator('#runIdLabel').textContent()
      await page.locator('#headerMenu').click()
      await page.locator('[data-header-action="reset"]').click()
      await expect(page.locator('#runIdLabel')).not.toHaveText('pending')
      await expect.poll(async () => page.locator('#runIdLabel').textContent()).not.toBe(firstRunId)
      await expect(page.locator('#answer')).toContainText('Trigger received')
      await expect(page.locator('#statusTitle')).toHaveText('Halted for human review', {
        timeout: 15_000,
      })
      await expectNoHorizontalOverflow(page)

      const signerSpacing = await page.evaluate<boolean[]>(`Array.from(document.querySelectorAll('.signer-row'))
        .map((row) => {
          const cells = Array.from(row.children).map((child) => child.getBoundingClientRect())
          const nameCell = cells[1]
          const detailCell = cells[2]
          return Boolean(nameCell && detailCell && nameCell.right < detailCell.left)
        })`)
      expect(signerSpacing).toEqual([true, true, true])

      await page.getByRole('button', { name: 'Approve and resume' }).click()
      await expect(page.locator('#statusTitle')).toHaveText('Trace complete', { timeout: 30_000 })
      await expect(page.locator('[data-step="halt"]')).toContainText('Approved')
      await expectNoHorizontalOverflow(page)
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

  test('requests changes without signing a rejection or running MCP', async ({ page }) => {
    await expectCleanConsole(page, async () => {
      await createProposal(page)
      await page.getByRole('button', { name: 'Request changes' }).click()

      await expect(page.locator('#statusTitle')).toHaveText('Changes requested')
      await expect(page.locator('[data-step="halt"]')).toContainText('Needs revision')
      await expect(page.locator('#answer')).toContainText('Revision requested')
      await expect(page.locator('#answer')).toContainText('agent revision')
      await expect(page.locator('#timeline .event')).toHaveCount(4)
      await expect(page.locator('#timeline')).toContainText('human.change_request.signed')
      await expect(page.locator('#timeline')).not.toContainText('human.rejection.signed')
      await expect(page.locator('#timeline')).not.toContainText('action_mcp')

      await openTimelineRecord(page, 'change_request')
      await expect(page.locator('#receipts pre')).toContainText('"kind": "human_review_feedback"')
      await expect(page.locator('#receipts pre')).toContainText('"decision": "changes_requested"')
      await expect(page.locator('#receipts pre')).toContainText('"next_step": "agent_revision"')
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
