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
  await expect(page.locator('#runIdLabel')).toHaveText(/^run_[A-Z0-9]+/)
  await expect(page.locator('#runIdLabel')).toHaveAttribute('data-run-id', /.+/)
  await expect(page.locator('#answer')).toContainText('Trigger received')
  await expect(page.locator('#statusTitle')).toHaveText('Halted for human review', {
    timeout: 15_000,
  })
  await expect(page.locator('#answer')).toContainText('Context gathered')
  await expect(page.locator('#answer')).toContainText('Policy & intent analysis')
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
  await expect(page.locator('#timeline .event .event-cue')).toHaveCount(3)
  await expect(page.locator('#timeline .event-future .event-cue')).toHaveCount(0)
  await expect(page.locator('#timeline .event.selected')).toHaveCount(0)
  await expect(page.locator('#timeline .event-future.selected')).toContainText('human.review.halted')
  await expect
    .poll(async () => page.locator('#timeline .event-future .event-marker').allTextContents())
    .toEqual(['', '4', '5'])
  await expect(page.locator('#answer')).toContainText('Human review halted')
  await expect(page.locator('#answer')).toContainText('Execution is stopped')
  await expectPendingSignerHashReadable(page)
  await expectReferenceLeftProgressTypography(page)
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

async function expectReferenceLeftProgressTypography(page: Page): Promise<void> {
  const progress = await page.evaluate<{
    detailWeights: number[]
    receivedText: string
    rowWeights: Array<{ text: string; weight: number }>
    sectionLabel: {
      fontSize: number
      fontWeight: number
      text: string
      textTransform: string
    } | null
    times: string[]
  }>(`(() => {
    const sectionLabel = document.querySelector('#answer > .section-label')
    const sectionStyle = sectionLabel ? getComputedStyle(sectionLabel) : null
    return {
      detailWeights: Array.from(document.querySelectorAll('.trigger-card .detail-row strong'))
        .map((element) => Number.parseFloat(getComputedStyle(element).fontWeight)),
      receivedText: document.querySelector('#receivedLabel')?.textContent?.trim() ?? '',
      rowWeights: Array.from(document.querySelectorAll('#answer .progress-item strong'))
        .map((element) => ({ text: element.textContent?.trim() ?? '', weight: Number.parseFloat(getComputedStyle(element).fontWeight) })),
      sectionLabel: sectionLabel && sectionStyle ? {
        fontSize: Number.parseFloat(sectionStyle.fontSize),
        fontWeight: Number.parseFloat(sectionStyle.fontWeight),
        text: sectionLabel.textContent?.trim() ?? '',
        textTransform: sectionStyle.textTransform,
      } : null,
      times: Array.from(document.querySelectorAll('#answer .progress-time'))
        .map((element) => element.textContent?.trim() ?? ''),
    }
  })()`)
  expect(progress.sectionLabel?.text).toBe('Agent progress')
  expect(progress.sectionLabel?.textTransform).toBe('none')
  expect(progress.sectionLabel?.fontSize).toBe(14)
  expect(progress.sectionLabel?.fontWeight).toBe(700)
  expect(progress.receivedText).toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d{4} \d{2}:\d{2}:\d{2} UTC$/)
  expect(progress.detailWeights.every((weight) => weight <= 400)).toBe(true)
  for (const row of progress.rowWeights) {
    if (row.text === 'Human review halted') {
      expect(row.weight).toBe(700)
    } else {
      expect(row.weight).toBe(400)
    }
  }
  for (const time of progress.times.filter((value) => value !== '-')) {
    expect(time).not.toContain('UTC')
    expect(time).toMatch(/^\d{2}:\d{2}:\d{2}$/)
  }
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

async function expectWorkflowOverviewVisible(page: Page): Promise<void> {
  await expect
    .poll(async () => page.evaluate(`Math.round(document.querySelector('.hero')?.getBoundingClientRect().top ?? -999)`))
    .toBeGreaterThanOrEqual(0)
  const overview = await page.evaluate<{
    firstRailStepTop: number
    headerBottom: number
    headerTop: number
    railTop: number
    scrollY: number
  }>(`(() => {
    const header = document.querySelector('.hero')?.getBoundingClientRect()
    const rail = document.querySelector('.workflow-rail')?.getBoundingClientRect()
    const firstStep = document.querySelector('.rail-stepper .step')?.getBoundingClientRect()
    return {
      firstRailStepTop: Math.round(firstStep?.top ?? -999),
      headerBottom: Math.round(header?.bottom ?? -999),
      headerTop: Math.round(header?.top ?? -999),
      railTop: Math.round(rail?.top ?? -999),
      scrollY: Math.round(window.scrollY),
    }
  })()`)
  expect(overview.scrollY).toBe(0)
  expect(overview.headerTop).toBeGreaterThanOrEqual(0)
  expect(overview.headerBottom).toBeLessThanOrEqual(64)
  expect(overview.railTop).toBeGreaterThanOrEqual(68)
  expect(overview.firstRailStepTop).toBeGreaterThanOrEqual(72)
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

async function expectRunModeMenuAboveContent(page: Page): Promise<void> {
  const menuHit = await page.evaluate<boolean>(`(() => {
    const menu = document.querySelector('#runModeActions')
    if (!menu || menu.hidden) return false
    const rect = menu.getBoundingClientRect()
    const x = Math.floor(rect.left + rect.width / 2)
    const y = Math.floor(rect.top + Math.min(rect.height - 2, 18))
    return Boolean(document.elementFromPoint(x, y)?.closest('#runModeActions'))
  })()`)
  expect(menuHit).toBe(true)
}

async function expectActionButtonsUseReferenceLayout(page: Page): Promise<void> {
  const buttonGeometry = await page.evaluate<
    Array<{
      buttonDisplay: string
      buttonInsideActions: boolean
      captionFontSize: number
      captionMuted: boolean
      contentDisplay: string
      contentInsideButton: boolean
      copyLeftAlignDelta: number
      iconCopyGap: number
      iconInsideButton: boolean
      iconLabelYDelta: number
      iconTextBlockYDelta: number
      labelFontSize: number
      labelFits: boolean
      labelWeight: number
      noLabelIconCollision: boolean
      smallLeftAlignDelta: number
      smallFits: boolean
      textAlign: string
    }>
  >(`Array.from(document.querySelectorAll('.actions > button')).map((button) => {
    const actionsRect = document.querySelector('.actions')?.getBoundingClientRect()
    const buttonRect = button.getBoundingClientRect()
    const content = button.querySelector('.button-content')?.getBoundingClientRect()
    const icon = button.querySelector('.button-icon')?.getBoundingClientRect()
    const copy = button.querySelector('.action-copy')?.getBoundingClientRect()
    const label = button.querySelector('.button-label')?.getBoundingClientRect()
    const small = button.querySelector('.action-copy small')?.getBoundingClientRect()
    const labelElement = button.querySelector('.button-label')
    const smallElement = button.querySelector('.action-copy small')
    const buttonStyle = getComputedStyle(button)
    const contentElement = button.querySelector('.button-content')
    const labelStyle = labelElement ? getComputedStyle(labelElement) : null
    const smallStyle = smallElement ? getComputedStyle(smallElement) : null
    return {
      buttonDisplay: buttonStyle.display,
      buttonInsideActions: actionsRect
        ? buttonRect.left >= actionsRect.left - 0.5 && buttonRect.right <= actionsRect.right + 0.5
        : false,
      captionFontSize: smallStyle ? Number.parseFloat(smallStyle.fontSize) : 0,
      captionMuted: button.id === 'approve' || (smallStyle ? smallStyle.color === 'rgb(71, 85, 105)' : false),
      contentDisplay: contentElement ? getComputedStyle(contentElement).display : '',
      contentInsideButton: content
        ? content.left >= buttonRect.left && content.right <= buttonRect.right && content.top >= buttonRect.top && content.bottom <= buttonRect.bottom
        : false,
      copyLeftAlignDelta: copy && label ? Math.abs(copy.left - label.left) : 999,
      iconCopyGap: icon && copy ? copy.left - icon.right : 0,
      iconInsideButton: icon
        ? icon.left >= buttonRect.left && icon.right <= buttonRect.right && icon.top >= buttonRect.top && icon.bottom <= buttonRect.bottom
        : false,
      iconLabelYDelta: icon && label
        ? Math.abs((icon.top + icon.height / 2) - (label.top + label.height / 2))
        : 999,
      iconTextBlockYDelta: icon && copy
        ? Math.abs((icon.top + icon.height / 2) - (copy.top + copy.height / 2))
        : 999,
      labelFontSize: labelStyle ? Number.parseFloat(labelStyle.fontSize) : 0,
      labelFits: label ? label.left >= buttonRect.left && label.right <= buttonRect.right : false,
      labelWeight: labelStyle ? Number.parseFloat(labelStyle.fontWeight) : 0,
      noLabelIconCollision: icon && label ? icon.right + 2 <= label.left : false,
      smallLeftAlignDelta: small && label ? Math.abs(small.left - label.left) : 999,
      smallFits: small ? small.left >= buttonRect.left && small.right <= buttonRect.right : false,
      textAlign: copy ? getComputedStyle(button.querySelector('.action-copy')).textAlign : '',
    }
  })`)
  for (const geometry of buttonGeometry) {
    expect(geometry.buttonDisplay).toBe('flex')
    expect(geometry.buttonInsideActions).toBe(true)
    expect(geometry.contentDisplay).toBe('flex')
    expect(geometry.textAlign).toBe('left')
    expect(geometry.contentInsideButton).toBe(true)
    expect(geometry.copyLeftAlignDelta).toBeLessThanOrEqual(1)
    expect(geometry.smallLeftAlignDelta).toBeLessThanOrEqual(1)
    expect(geometry.iconCopyGap).toBeGreaterThanOrEqual(7)
    expect(geometry.iconCopyGap).toBeLessThanOrEqual(10)
    expect(geometry.iconInsideButton).toBe(true)
    expect(geometry.iconTextBlockYDelta).toBeLessThanOrEqual(1.5)
    expect(geometry.iconLabelYDelta).toBeGreaterThan(3)
    expect(geometry.labelFontSize).toBeGreaterThanOrEqual(13)
    expect(geometry.labelWeight).toBeGreaterThanOrEqual(800)
    expect(geometry.captionFontSize).toBeGreaterThanOrEqual(8)
    expect(geometry.captionMuted).toBe(true)
    expect(geometry.labelFits).toBe(true)
    expect(geometry.noLabelIconCollision).toBe(true)
    expect(geometry.smallFits).toBe(true)
  }
}

async function expectDiffLineGutter(page: Page): Promise<void> {
  const gutter = await page.evaluate<{
    allRowsNumbered: boolean
    firstLine: string
    gutterWidth: number
    lineCount: number
    numberCount: number
    textAfterGutter: boolean
  }>(`(() => {
    const code = document.querySelector('.diff-code')?.getBoundingClientRect()
    const rows = Array.from(document.querySelectorAll('.diff-line'))
    const numbers = Array.from(document.querySelectorAll('.diff-line-no'))
    const firstNumber = numbers[0]?.getBoundingClientRect()
    const firstText = document.querySelector('.diff-line-text')?.getBoundingClientRect()
    return {
      allRowsNumbered: rows.every((row, index) => row.querySelector('.diff-line-no')?.textContent === String(index + 1)),
      firstLine: numbers[0]?.textContent ?? '',
      gutterWidth: firstNumber ? Math.round(firstNumber.width) : 0,
      lineCount: rows.length,
      numberCount: numbers.length,
      textAfterGutter: Boolean(code && firstNumber && firstText && firstNumber.left >= code.left && firstText.left > firstNumber.right),
    }
  })()`)
  expect(gutter.lineCount).toBeGreaterThan(1)
  expect(gutter.numberCount).toBe(gutter.lineCount)
  expect(gutter.firstLine).toBe('1')
  expect(gutter.allRowsNumbered).toBe(true)
  expect(gutter.gutterWidth).toBeGreaterThanOrEqual(20)
  expect(gutter.gutterWidth).toBeLessThanOrEqual(24)
  expect(gutter.textAfterGutter).toBe(true)
}

async function expectDiffRowsFillReferenceFrame(page: Page): Promise<void> {
  const rhythm = await page.evaluate<{
    bottomGap: number
    lineHeight: number
    topGap: number
  }>(`(() => {
    const code = document.querySelector('.diff-code')?.getBoundingClientRect()
    const rows = Array.from(document.querySelectorAll('.diff-line'))
    const first = rows[0]?.getBoundingClientRect()
    const last = rows[rows.length - 1]?.getBoundingClientRect()
    const style = document.querySelector('.diff-code')
      ? getComputedStyle(document.querySelector('.diff-code'))
      : null
    if (!code || !first || !last || !style) return { bottomGap: 999, lineHeight: 0, topGap: 999 }
    return {
      bottomGap: Math.round((code.bottom - last.bottom) * 100) / 100,
      lineHeight: Number.parseFloat(style.lineHeight),
      topGap: Math.round((first.top - code.top) * 100) / 100,
    }
  })()`)
  expect(rhythm.lineHeight).toBeGreaterThanOrEqual(13)
  expect(rhythm.lineHeight).toBeLessThanOrEqual(14)
  expect(rhythm.topGap).toBeGreaterThanOrEqual(7)
  expect(rhythm.topGap).toBeLessThanOrEqual(11)
  expect(rhythm.bottomGap).toBeGreaterThanOrEqual(7)
  expect(rhythm.bottomGap).toBeLessThanOrEqual(11)
}

async function expectReferenceProposalPanelChrome(page: Page): Promise<void> {
  const chrome = await page.evaluate<{
    actionPill: { fontSize: number; height: number }
    diffLabel: { fontSize: number; text: string; textTransform: string }
    targetCode: { fontSize: number; height: number }
  }>(`(() => {
    const measure = (selector) => {
      const element = document.querySelector(selector)
      const rect = element?.getBoundingClientRect()
      const style = element ? getComputedStyle(element) : null
      return rect && style
        ? {
            fontSize: Number.parseFloat(style.fontSize),
            height: Math.round(rect.height * 100) / 100,
            text: element.textContent?.trim() ?? '',
            textTransform: style.textTransform,
          }
        : { fontSize: 0, height: 999, text: '', textTransform: '' }
    }
    return {
      actionPill: measure('#proposal .metric .pill'),
      diffLabel: measure('#proposal .diff-head .label'),
      targetCode: measure('#proposal .metric .meta-code'),
    }
  })()`)
  expect(chrome.actionPill.fontSize).toBe(12)
  expect(chrome.actionPill.height).toBeLessThanOrEqual(24)
  expect(chrome.targetCode.fontSize).toBe(12)
  expect(chrome.targetCode.height).toBeLessThanOrEqual(24)
  expect(chrome.diffLabel.text).toBe('Diff (unified)')
  expect(chrome.diffLabel.textTransform).toBe('none')
  expect(chrome.diffLabel.fontSize).toBe(13)
}

async function expectReferenceDesktopPrimaryCaption(page: Page): Promise<void> {
  const captionGeometry = await page.evaluate<{
    fits: boolean
    height: number
    lineHeight: number
    whiteSpace: string
  }>(`(() => {
    const button = document.querySelector('#approve')
    const caption = button?.querySelector('.action-copy small')
    if (!button || !caption) return { fits: false, height: 999, lineHeight: 0, whiteSpace: '' }
    const buttonRect = button.getBoundingClientRect()
    const captionRect = caption.getBoundingClientRect()
    const style = getComputedStyle(caption)
    return {
      fits: captionRect.left >= buttonRect.left && captionRect.right <= buttonRect.right,
      height: captionRect.height,
      lineHeight: Number.parseFloat(style.lineHeight),
      whiteSpace: style.whiteSpace,
    }
  })()`)
  expect(captionGeometry.whiteSpace).toBe('nowrap')
  expect(captionGeometry.fits).toBe(true)
  expect(captionGeometry.height).toBeLessThanOrEqual(captionGeometry.lineHeight + 1)
}

async function expectReferenceDesktopRiskTextFits(page: Page): Promise<void> {
  const riskGeometry = await page.evaluate<{
    clientWidth: number
    gap: number
    scrollWidth: number
    textOverflow: string
  }>(`(() => {
    const bar = document.querySelector('.risk-bar')
    const value = bar?.querySelector('.value')
    const style = value ? getComputedStyle(value) : null
    return {
      clientWidth: value?.clientWidth ?? 0,
      gap: bar ? Number.parseFloat(getComputedStyle(bar).columnGap) : 0,
      scrollWidth: value?.scrollWidth ?? 999,
      textOverflow: style?.textOverflow ?? '',
    }
  })()`)
  expect(riskGeometry.gap).toBeLessThanOrEqual(7)
  expect(riskGeometry.textOverflow).toBe('clip')
  expect(riskGeometry.scrollWidth).toBeLessThanOrEqual(riskGeometry.clientWidth + 1)
}

async function expectReferenceVerificationRows(page: Page): Promise<void> {
  const rows = await page.evaluate<
    Array<{
      borderWidth: string
      detailFontSize: number
      iconHeight: number
      minHeight: number
      paddingLeft: number
      paddingRight: number
      radius: string
      rowGap: number
      strongFontSize: number
      strongWeight: number
    }>
  >(`Array.from(document.querySelectorAll('#verification .verify-row')).map((row) => {
    const style = getComputedStyle(row)
    const icon = row.querySelector('.verify-icon')?.getBoundingClientRect()
    const strong = row.querySelector('strong')
    const detail = row.querySelector('.empty')
    const strongStyle = strong ? getComputedStyle(strong) : null
    const detailStyle = detail ? getComputedStyle(detail) : null
    return {
      borderWidth: style.borderTopWidth,
      detailFontSize: detailStyle ? Number.parseFloat(detailStyle.fontSize) : 0,
      iconHeight: icon ? Math.round(icon.height) : 0,
      minHeight: Math.round(row.getBoundingClientRect().height),
      paddingLeft: Number.parseFloat(style.paddingLeft),
      paddingRight: Number.parseFloat(style.paddingRight),
      radius: style.borderTopLeftRadius,
      rowGap: Number.parseFloat(style.columnGap),
      strongFontSize: strongStyle ? Number.parseFloat(strongStyle.fontSize) : 0,
      strongWeight: strongStyle ? Number.parseFloat(strongStyle.fontWeight) : 0,
    }
  })`)
  expect(rows).toHaveLength(3)
  for (const row of rows) {
    expect(row.borderWidth).toBe('0px')
    expect(row.radius).toBe('0px')
    expect(row.paddingLeft).toBe(0)
    expect(row.paddingRight).toBe(0)
    expect(row.detailFontSize).toBe(11)
    expect(row.minHeight).toBeGreaterThanOrEqual(42)
    expect(row.iconHeight).toBe(28)
    expect(row.rowGap).toBe(8)
    expect(row.strongFontSize).toBe(12)
    expect(row.strongWeight).toBe(700)
  }
}

async function expectVerificationResultRhythm(page: Page): Promise<void> {
  const result = await page.evaluate<{
    background: string
    borderLeftWidth: string
    borderTopWidth: string
    rowGap: number
    rows: Array<{
      detailTop: number
      detailWidth: number
      dotTop: number
      height: number
      labelBottom: number
      text: string
      verticalGap: number
    }>
  }>(`(() => {
    const result = document.querySelector('#verificationResult')
    const resultStyle = result ? getComputedStyle(result) : null
    return {
      background: resultStyle?.backgroundColor ?? '',
      borderLeftWidth: resultStyle?.borderLeftWidth ?? '',
      borderTopWidth: resultStyle?.borderTopWidth ?? '',
      rowGap: resultStyle ? Number.parseFloat(resultStyle.rowGap) : 0,
      rows: Array.from(document.querySelectorAll('#verificationResult .verification-step')).map((row) => {
        const rect = row.getBoundingClientRect()
        const dot = row.querySelector('.verification-dot')?.getBoundingClientRect()
        const copy = row.querySelector(':scope > div')
        const label = copy?.querySelector('strong')?.getBoundingClientRect()
        const detail = copy?.querySelector('span')?.getBoundingClientRect()
        return {
          detailTop: Math.round((detail?.top ?? 0) * 100) / 100,
          detailWidth: Math.round((detail?.width ?? 0) * 100) / 100,
          dotTop: Math.round((dot?.top ?? 0) * 100) / 100,
          height: Math.round(rect.height * 100) / 100,
          labelBottom: Math.round((label?.bottom ?? 0) * 100) / 100,
          text: row.textContent?.trim().replace(/\\s+/g, ' ') ?? '',
          verticalGap: label && detail ? Math.round((detail.top - label.bottom) * 100) / 100 : -999,
        }
      }),
    }
  })()`)
  expect(result.background).toBe('rgba(0, 0, 0, 0)')
  expect(result.borderTopWidth).toBe('1px')
  expect(result.borderLeftWidth).toBe('0px')
  expect(result.rowGap).toBe(8)
  expect(result.rows).toHaveLength(3)
  for (const row of result.rows) {
    expect(row.height).toBeGreaterThanOrEqual(31)
    expect(row.verticalGap).toBeGreaterThanOrEqual(2)
    expect(row.detailWidth).toBeGreaterThan(200)
    expect(row.dotTop).toBeLessThan(row.detailTop)
  }
}

async function expectPendingSignerHashReadable(page: Page): Promise<void> {
  const signature = await page.evaluate<{
    hashText: string
    hashWidth: number
    slotWidth: number
    visibleHashFits: boolean
  }>(`(() => {
    const firstRow = document.querySelector('.signer-row')
    const slot = firstRow?.querySelector('.signature-slot')
    const hash = firstRow?.querySelector('.signature-slot .hash')
    const slotRect = slot?.getBoundingClientRect()
    const hashRect = hash?.getBoundingClientRect()
    return {
      hashText: hash?.textContent?.trim() ?? '',
      hashWidth: Math.round((hashRect?.width ?? 0) * 100) / 100,
      slotWidth: Math.round((slotRect?.width ?? 0) * 100) / 100,
      visibleHashFits: hash ? hash.scrollWidth <= hash.clientWidth + 1 : false,
    }
  })()`)
  expect(signature.hashText).toMatch(/^[a-f0-9]{10}\.\.\.[a-f0-9]{4}$/)
  expect(signature.slotWidth).toBeGreaterThanOrEqual(112)
  expect(signature.hashWidth).toBeGreaterThanOrEqual(76)
  expect(signature.visibleHashFits).toBe(true)
}

async function expectReferenceReceiptJsonSyntax(page: Page): Promise<void> {
  const syntax = await page.evaluate<{
    borderWidth: string
    gutterWidth: number
    keyColor: string
    keyCount: number
    lineCount: number
    maxHeight: number
    numberColor: string
    stringColor: string
    stringCount: number
    tenthLineNumber: string
  }>(`(() => {
    const pre = document.querySelector('#receipts pre')
    const preStyle = pre ? getComputedStyle(pre) : null
    const numbers = Array.from(document.querySelectorAll('#receipts .json-line-number'))
    const firstNumber = numbers[0]?.getBoundingClientRect()
    const key = document.querySelector('#receipts .json-token.key')
    const string = document.querySelector('#receipts .json-token.string')
    const number = document.querySelector('#receipts .json-token.number')
    return {
      borderWidth: preStyle?.borderTopWidth ?? '',
      gutterWidth: firstNumber ? Math.round(firstNumber.width) : 0,
      keyColor: key ? getComputedStyle(key).color : '',
      keyCount: document.querySelectorAll('#receipts .json-token.key').length,
      lineCount: document.querySelectorAll('#receipts .json-line').length,
      maxHeight: preStyle ? Number.parseFloat(preStyle.maxHeight) : 0,
      numberColor: number ? getComputedStyle(number).color : '',
      stringColor: string ? getComputedStyle(string).color : '',
      stringCount: document.querySelectorAll('#receipts .json-token.string').length,
      tenthLineNumber: numbers[9]?.textContent ?? '',
    }
  })()`)
  expect(syntax.borderWidth).toBe('0px')
  expect(syntax.gutterWidth).toBeGreaterThanOrEqual(34)
  expect(syntax.keyCount).toBeGreaterThan(4)
  expect(syntax.lineCount).toBeGreaterThan(1)
  expect(syntax.maxHeight).toBe(188)
  expect(syntax.stringCount).toBeGreaterThan(4)
  expect(syntax.tenthLineNumber).toBe('10')
  expect(syntax.keyColor).toBe('rgb(195, 58, 101)')
  expect(syntax.stringColor).toBe('rgb(40, 79, 147)')
  expect(syntax.numberColor).toBe('rgb(29, 118, 101)')
}

async function expectReceiptPanelFitsReferenceViewport(page: Page): Promise<void> {
  const receiptFit = await page.evaluate<{
    pageHeight: number
    preHeight: number
    receiptBottom: number
    receiptHeight: number
    shellHeight: number
    viewportHeight: number
  }>(`(() => {
    const receipt = document.querySelector('.receipt-panel')?.getBoundingClientRect()
    const shell = document.querySelector('.receipt-shell')?.getBoundingClientRect()
    const pre = document.querySelector('#receipts pre')?.getBoundingClientRect()
    return {
      pageHeight: Math.round(document.body.scrollHeight),
      preHeight: Math.round(pre?.height ?? 0),
      receiptBottom: Math.round(receipt?.bottom ?? 0),
      receiptHeight: Math.round(receipt?.height ?? 0),
      shellHeight: Math.round(shell?.height ?? 0),
      viewportHeight: window.innerHeight,
    }
  })()`)
  expect(receiptFit.viewportHeight).toBe(1024)
  expect(receiptFit.pageHeight).toBeLessThanOrEqual(receiptFit.viewportHeight + 1)
  expect(receiptFit.receiptBottom).toBeLessThanOrEqual(receiptFit.viewportHeight + 1)
  expect(receiptFit.receiptHeight).toBeGreaterThanOrEqual(246)
  expect(receiptFit.receiptHeight).toBeLessThanOrEqual(250)
  expect(receiptFit.shellHeight).toBeLessThanOrEqual(210)
  expect(receiptFit.preHeight).toBeLessThanOrEqual(188)
}

async function expectReferenceReceiptToolbarRhythm(page: Page): Promise<void> {
  const toolbar = await page.evaluate<{
    copyX: number
    downloadWidth: number
    downloadX: number
    formatFontSize: number
    formatWidth: number
    formatX: number
    labelFontSize: number
    labelX: number
    titleWidth: number
    titleX: number
  }>(`(() => {
    const title = document.querySelector('.receipt-toolbar h2')
    const label = document.querySelector('.receipt-controls .label')
    const format = document.querySelector('#receiptFormat')
    const copy = document.querySelector('#copyReceipt')
    const download = document.querySelector('#downloadReceipt')
    const titleRect = title?.getBoundingClientRect()
    const labelRect = label?.getBoundingClientRect()
    const formatRect = format?.getBoundingClientRect()
    const copyRect = copy?.getBoundingClientRect()
    const downloadRect = download?.getBoundingClientRect()
    return {
      copyX: Math.round(copyRect?.x ?? 0),
      downloadWidth: Math.round(downloadRect?.width ?? 0),
      downloadX: Math.round(downloadRect?.x ?? 0),
      formatFontSize: Number.parseFloat(format ? getComputedStyle(format).fontSize : '0'),
      formatWidth: Math.round(formatRect?.width ?? 0),
      formatX: Math.round(formatRect?.x ?? 0),
      labelFontSize: Number.parseFloat(label ? getComputedStyle(label).fontSize : '0'),
      labelX: Math.round(labelRect?.x ?? 0),
      titleWidth: Math.round(titleRect?.width ?? 0),
      titleX: Math.round(titleRect?.x ?? 0),
    }
  })()`)
  expect(toolbar.titleX).toBeGreaterThanOrEqual(24)
  expect(toolbar.titleX).toBeLessThanOrEqual(26)
  expect(toolbar.titleWidth).toBe(123)
  expect(toolbar.labelX).toBeGreaterThanOrEqual(155)
  expect(toolbar.labelX).toBeLessThanOrEqual(157)
  expect(toolbar.labelFontSize).toBe(11)
  expect(toolbar.formatX).toBeGreaterThanOrEqual(203)
  expect(toolbar.formatX).toBeLessThanOrEqual(205)
  expect(toolbar.formatWidth).toBe(121)
  expect(toolbar.formatFontSize).toBe(12)
  expect(toolbar.copyX).toBeGreaterThanOrEqual(332)
  expect(toolbar.copyX).toBeLessThanOrEqual(334)
  expect(toolbar.downloadX).toBeGreaterThanOrEqual(368)
  expect(toolbar.downloadX).toBeLessThanOrEqual(370)
  expect(toolbar.downloadWidth).toBe(128)
}

async function expectReferenceDesktopCenterStack(page: Page): Promise<void> {
  const stackGeometry = await page.evaluate<{
    actionBottomGap: number
    actionsY: number
    diffCodeHeight: number
    panelBottom: number
    riskBarHeight: number
  }>(`(() => {
    const panel = document.querySelector('#proposal')?.closest('.panel')?.getBoundingClientRect()
    const diffCode = document.querySelector('.diff-code')?.getBoundingClientRect()
    const riskBar = document.querySelector('.risk-bar')?.getBoundingClientRect()
    const actions = document.querySelector('.actions')?.getBoundingClientRect()
    if (!panel || !diffCode || !riskBar || !actions) {
      return { actionBottomGap: 999, actionsY: 0, diffCodeHeight: 0, panelBottom: 0, riskBarHeight: 0 }
    }
    return {
      actionBottomGap: Math.round(panel.bottom - actions.bottom),
      actionsY: Math.round(actions.y),
      diffCodeHeight: Math.round(diffCode.height),
      panelBottom: Math.round(panel.bottom),
      riskBarHeight: Math.round(riskBar.height),
    }
  })()`)
  expect(stackGeometry.diffCodeHeight).toBeGreaterThanOrEqual(298)
  expect(stackGeometry.actionBottomGap).toBeGreaterThanOrEqual(12)
  expect(stackGeometry.actionBottomGap).toBeLessThanOrEqual(18)
  expect(stackGeometry.actionsY).toBeGreaterThanOrEqual(690)
  expect(stackGeometry.actionsY).toBeLessThanOrEqual(698)
  expect(stackGeometry.riskBarHeight).toBeGreaterThanOrEqual(38)
}

async function expectWorkflowStepCopyHugsContent(page: Page): Promise<void> {
  const stepGeometry = await page.evaluate<
    Array<{ copyWidth: number; rowWidth: number; step: string | null }>
  >(`Array.from(document.querySelectorAll('.step')).map((step) => {
    const row = step.getBoundingClientRect()
    const copy = step.querySelector('.step-copy')?.getBoundingClientRect()
    return {
      copyWidth: copy ? copy.width : row.width,
      rowWidth: row.width,
      step: step.getAttribute('data-step'),
    }
  })`)
  for (const geometry of stepGeometry) {
    expect(geometry.copyWidth).toBeLessThanOrEqual(geometry.rowWidth - 40)
  }
}

async function expectReferenceDesktopRailGeometry(page: Page): Promise<void> {
  const railGeometry = await page.evaluate<{
    badge: {
      color: string
      fontSize: number
      fontWeight: number
      height: number
      width: number
    } | null
    haltMarker: {
      afterRight: number
      afterWidth: number
      backgroundImage: string
      beforeLeft: number
      beforeWidth: number
      barHeight: number
      borderColor: string
    } | null
    connectors: Array<{
      backgroundColor: string
      backgroundImage: string
      height: number
      step: string | null
    }>
    steps: Array<{
      indexX: number | null
      rectH: number
      rectW: number
      rectX: number
      step: string | null
    }>
  }>(`(() => {
    const badge = document.querySelector('[data-step-badge="halt"]')
    const badgeRect = badge?.getBoundingClientRect()
    const badgeStyle = badge ? getComputedStyle(badge) : null
    const marker = document.querySelector('[data-step="halt"] .step-index')
    const markerStyle = marker ? getComputedStyle(marker) : null
    const markerBefore = marker ? getComputedStyle(marker, '::before') : null
    const markerAfter = marker ? getComputedStyle(marker, '::after') : null
    return {
      badge: badge && badgeRect && badgeStyle ? {
        color: badgeStyle.color,
        fontSize: Number.parseFloat(badgeStyle.fontSize),
        fontWeight: Number.parseFloat(badgeStyle.fontWeight),
        height: Math.round(badgeRect.height),
        width: Math.round(badgeRect.width),
      } : null,
      haltMarker: markerStyle && markerBefore && markerAfter ? {
        afterRight: Number.parseFloat(markerAfter.right),
        afterWidth: Number.parseFloat(markerAfter.width),
        backgroundImage: markerStyle.backgroundImage,
        beforeLeft: Number.parseFloat(markerBefore.left),
        beforeWidth: Number.parseFloat(markerBefore.width),
        barHeight: Number.parseFloat(markerBefore.height),
        borderColor: markerStyle.borderColor,
      } : null,
      connectors: Array.from(document.querySelectorAll('.step:not(:last-child)')).map((step) => {
        const after = getComputedStyle(step, '::after')
        return {
          backgroundColor: after.backgroundColor,
          backgroundImage: after.backgroundImage,
          height: Number.parseFloat(after.height),
          step: step.getAttribute('data-step'),
        }
      }),
      steps: Array.from(document.querySelectorAll('.step')).map((step) => {
    const rect = step.getBoundingClientRect()
    const index = step.querySelector('.step-index')?.getBoundingClientRect()
    return {
      indexX: index ? Math.round(index.x) : null,
      rectH: Math.round(rect.height),
      rectW: Math.round(rect.width),
      rectX: Math.round(rect.x),
      step: step.getAttribute('data-step'),
    }
      }),
    }
  })()`)
  const byStep = Object.fromEntries(
    railGeometry.steps.map((geometry) => [geometry.step, geometry]),
  )
  expect(byStep.trigger.indexX).toBeGreaterThanOrEqual(51)
  expect(byStep.trigger.indexX).toBeLessThanOrEqual(53)
  expect(byStep.autonomous.indexX).toBeGreaterThanOrEqual(339)
  expect(byStep.autonomous.indexX).toBeLessThanOrEqual(341)
  expect(byStep.halt.rectX).toBeGreaterThanOrEqual(598)
  expect(byStep.halt.rectX).toBeLessThanOrEqual(600)
  expect(byStep.halt.rectW).toBeGreaterThanOrEqual(330)
  expect(byStep.halt.rectW).toBeLessThanOrEqual(332)
  expect(byStep.halt.rectH).toBe(58)
  expect(byStep.resume.indexX).toBeGreaterThanOrEqual(985)
  expect(byStep.resume.indexX).toBeLessThanOrEqual(987)
  expect(byStep.audit.indexX).toBeGreaterThanOrEqual(1326)
  expect(byStep.audit.indexX).toBeLessThanOrEqual(1328)
  expect(railGeometry.badge?.fontSize).toBe(10)
  expect(railGeometry.badge?.fontWeight).toBeGreaterThanOrEqual(800)
  expect(railGeometry.badge?.height).toBeLessThanOrEqual(18)
  expect(railGeometry.badge?.width).toBeLessThanOrEqual(112)
  expect(railGeometry.badge?.color).toBe('rgb(164, 73, 0)')
  expect(railGeometry.haltMarker?.backgroundImage).toContain('linear-gradient')
  expect(railGeometry.haltMarker?.borderColor).toBe('rgb(245, 158, 11)')
  expect(railGeometry.haltMarker?.beforeLeft).toBe(13)
  expect(railGeometry.haltMarker?.afterRight).toBe(12)
  expect(railGeometry.haltMarker?.beforeWidth).toBe(3)
  expect(railGeometry.haltMarker?.afterWidth).toBe(3)
  expect(railGeometry.haltMarker?.barHeight).toBe(14)
  const connectors = Object.fromEntries(
    railGeometry.connectors.map((connector) => [connector.step, connector]),
  )
  expect(connectors.trigger.backgroundColor).toBe('rgb(7, 136, 97)')
  expect(connectors.autonomous.backgroundColor).toBe('rgb(7, 136, 97)')
  expect(connectors.halt.backgroundImage).toContain('repeating-linear-gradient')
  expect(connectors.resume.backgroundImage).toContain('repeating-linear-gradient')
  expect(connectors.halt.height).toBe(2)
  expect(connectors.resume.height).toBe(2)
}

async function expectConstrainedDesktopRailGeometry(page: Page): Promise<void> {
  const railGeometry = await page.evaluate<{
    badge: {
      fitsInHalted: boolean
      height: number
      text: string
      whiteSpace: string
      width: number
    } | null
    meta: {
      height: number
      width: number
    } | null
  }>(`(() => {
    const badge = document.querySelector('[data-step-badge="halt"]')
    const halted = document.querySelector('[data-step="halt"]')
    const meta = document.querySelector('[data-step="halt"] .step-meta-line')
    const badgeRect = badge?.getBoundingClientRect()
    const haltedRect = halted?.getBoundingClientRect()
    const metaRect = meta?.getBoundingClientRect()
    return {
      badge: badge && badgeRect ? {
        fitsInHalted: haltedRect ? badgeRect.left >= haltedRect.left && badgeRect.right <= haltedRect.right : false,
        height: Math.round(badgeRect.height),
        text: badge.textContent?.trim() ?? '',
        whiteSpace: getComputedStyle(badge).whiteSpace,
        width: Math.round(badgeRect.width),
      } : null,
      meta: meta && metaRect ? {
        height: Math.round(metaRect.height),
        width: Math.round(metaRect.width),
      } : null,
    }
  })()`)
  expect(railGeometry.badge?.text).toBe('Awaiting review')
  expect(railGeometry.badge?.whiteSpace).toBe('nowrap')
  expect(railGeometry.badge?.fitsInHalted).toBe(true)
  expect(railGeometry.badge?.height).toBeLessThanOrEqual(18)
  expect(railGeometry.badge?.width).toBeGreaterThanOrEqual(86)
  expect(railGeometry.meta?.height).toBeLessThanOrEqual(18)
}

async function expectTraceRowsReadable(page: Page): Promise<void> {
  const rowOpacity = await page.evaluate<Array<{ opacity: number; selector: string }>>(
    `Array.from(document.querySelectorAll('.progress-item, #timeline .event, #timeline .event-future')).map((row) => ({
      opacity: Number(getComputedStyle(row).opacity),
      selector: row.className,
    }))`,
  )
  for (const row of rowOpacity) {
    expect(row.opacity).toBeGreaterThanOrEqual(0.98)
  }
}

async function expectReferenceTimelineSpacing(page: Page): Promise<void> {
  const timeline = await page.evaluate<{
    rows: Array<{
      copyLeft: number
      cueLeft: number | null
      hashLeft: number
      hashTextAlign: string
      label: string
      markerLeft: number
      markerToTimeGap: number
      rowClass: string
      timeLeft: number
      timestampToCopyOffset: number
    }>
    viewportWidth: number
  }>(`(() => ({
    viewportWidth: window.innerWidth,
    rows: Array.from(document.querySelectorAll('#timeline .event, #timeline .event-future')).map((row) => {
      const marker = row.querySelector('.event-marker')?.getBoundingClientRect()
      const time = row.querySelector('.event-time')?.getBoundingClientRect()
      const copy = row.querySelector('.event-copy')?.getBoundingClientRect()
      const hashElement = row.querySelector('.event-hash')
      const hash = hashElement?.getBoundingClientRect()
      const cue = row.querySelector('.event-cue')?.getBoundingClientRect()
      return {
        copyLeft: copy ? Math.round(copy.left) : 0,
        cueLeft: cue ? Math.round(cue.left) : null,
        hashLeft: hash ? Math.round(hash.left) : 0,
        hashTextAlign: hashElement ? getComputedStyle(hashElement).textAlign : '',
        label: row.querySelector('strong')?.textContent?.trim() ?? '',
        markerLeft: marker ? Math.round(marker.left) : 0,
        markerToTimeGap: marker && time ? Math.round(time.left - marker.right) : 0,
        rowClass: row.className,
        timeLeft: time ? Math.round(time.left) : 0,
        timestampToCopyOffset: time && copy ? Math.round(copy.left - time.left) : 0,
      }
    }),
  }))()`)
  const minTimestampOffset = timeline.viewportWidth >= 1450 ? 90 : 82
  const maxTimestampOffset = timeline.viewportWidth >= 1450 ? 100 : 92
  for (const row of timeline.rows) {
    expect(row.markerLeft).toBeLessThan(row.timeLeft)
    expect(row.timeLeft).toBeLessThan(row.copyLeft)
    expect(row.copyLeft).toBeLessThan(row.hashLeft)
    if (row.cueLeft !== null) expect(row.hashLeft).toBeLessThan(row.cueLeft)
    expect(row.markerToTimeGap).toBeGreaterThanOrEqual(6)
    expect(row.markerToTimeGap).toBeLessThanOrEqual(10)
    expect(row.timestampToCopyOffset).toBeGreaterThanOrEqual(minTimestampOffset)
    expect(row.timestampToCopyOffset).toBeLessThanOrEqual(maxTimestampOffset)
    if (row.rowClass.includes('event-future')) expect(row.hashTextAlign).toBe('left')
  }
}

test.describe('Cloudflare approval trace browser UI', () => {
  test('clicks through approved execution and opens the signed receipt', async ({ page }) => {
    await expectCleanConsole(page, async () => {
      await page.setViewportSize({ width: 1536, height: 1024 })
      await page.context().grantPermissions(['clipboard-write'])
      await createProposal(page)
      await expectNoHorizontalOverflow(page)
      await expectActionButtonsUseReferenceLayout(page)
      await expectReferenceProposalPanelChrome(page)
      await expectReferenceDesktopPrimaryCaption(page)
      await expectReferenceDesktopCenterStack(page)
      await expect(page.locator('.risk-bar .value')).toHaveText(
        'Introduces rate limiting which may impact client traffic if misconfigured.',
      )
      await expectReferenceDesktopRiskTextFits(page)
      await expect(
        page.locator('.risk-bar').evaluate((element) =>
          element.ownerDocument.defaultView?.getComputedStyle(element).backgroundColor ?? '',
        ),
      ).resolves.toBe('rgb(255, 255, 255)')
      await expectWorkflowStepCopyHugsContent(page)
      await expectReferenceDesktopRailGeometry(page)
      await expectTraceRowsReadable(page)
      await expectReferenceTimelineSpacing(page)
      await expectReceiptPanelFitsReferenceViewport(page)
      await expectReferenceReceiptToolbarRhythm(page)

      const visibleTimes = await page.locator('#answer .progress-time').allTextContents()
      const populatedTimes = visibleTimes.filter((time) => time !== '-')
      expect(new Set(populatedTimes).size).toBeGreaterThan(3)

      const runId = await page.locator('#runIdLabel').getAttribute('data-run-id')
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
      await expect(page.locator('.diff-code')).toContainText('const config = getConfig();')
      await expect(page.locator('.diff-code')).toContainText('next();')
      await expect(page.locator('.diff-code')).not.toContainText('logRequest')
      await expectDiffLineGutter(page)
      await expectDiffRowsFillReferenceFrame(page)

      await page.locator('#diffWrapToggle').click()
      await expect(page.locator('#diffWrapToggle')).toHaveAttribute('aria-pressed', 'true')
      await expect(page.locator('.diff-code')).toHaveClass(/wrap/)
      const threeLineDiffCount = await page.locator('.diff-line').count()
      await page.locator('#diffContext').selectOption('all')
      await expect.poll(async () => page.locator('.diff-line').count()).toBeGreaterThan(threeLineDiffCount)
      await page.locator('#diffContext').selectOption('6')
      await expect(page.locator('.diff')).toHaveAttribute('data-context-lines', '6')
      await expect(page.locator('.diff-code')).toContainText('logRequest')
      await expectDiffLineGutter(page)

      await page.locator('#headerMenu').click()
      await expect(page.locator('#headerActions')).toBeVisible()
      await expect(page.locator('[data-header-action="copy-link"]')).toBeEnabled()
      await expect(page.locator('[data-header-action="open-json"]')).toBeEnabled()
      await expect(page.locator('[data-header-action="reset"]')).toBeEnabled()
      await expectHeaderMenuAboveContent(page)
      await page.keyboard.press('Escape')
      await expect(page.locator('#headerActions')).toBeHidden()

      await expect(page.locator('#runModeMenu')).toHaveAttribute('aria-haspopup', 'menu')
      await expect(page.locator('#runModeMenu')).toHaveAttribute('aria-expanded', 'false')
      await expect(page.getByRole('button', { name: 'Live run' })).toBeVisible()
      await expect(page.locator('#runModeMenu .menu-chevron')).toBeVisible()
      await page.getByRole('button', { name: 'Live run' }).click()
      await expect(page.locator('#runModeMenu')).toHaveAttribute('aria-expanded', 'true')
      await expect(page.locator('#runModeActions')).toBeVisible()
      await expect(page.locator('[data-run-mode-action="live"]')).toHaveAttribute('aria-checked', 'true')
      await expect(
        page.locator('[data-run-mode-action="live"]').evaluate((element) =>
          element.ownerDocument.defaultView?.getComputedStyle(element, '::before').content ?? '',
        ),
      ).resolves.toBe('"✓"')
      await expect(page.locator('[data-run-mode-action="open-json"]')).toBeEnabled()
      await expect(page.locator('[data-run-mode-action="reset"]')).toBeEnabled()
      await expectRunModeMenuAboveContent(page)
      await page.locator('[data-run-mode-action="live"]').click()
      await expect(page.locator('#runModeMenu')).toHaveAttribute('aria-expanded', 'false')
      await expect(page.locator('#runModeActions')).toBeHidden()
      await page.locator('#runModeMenu').click()
      await expect(page.locator('#runModeActions')).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(page.locator('#runModeActions')).toBeHidden()

      await page.getByRole('tab', { name: 'Record details' }).click()
      await expect(page.locator('#receiptSummary')).toContainText('Record hash')
      await expect(page.locator('#receiptSummary')).toContainText('Timestamp')
      await page.getByRole('tab', { name: 'Summary' }).click()
      const prettyReceiptLines = await page.locator('#receipts .json-line').count()
      expect(prettyReceiptLines).toBeGreaterThan(1)
      await expectReferenceReceiptJsonSyntax(page)
      await page.locator('#receiptFormat').selectOption('compact')
      await expect.poll(async () => page.locator('#receipts .json-line').count()).toBe(1)
      await page.locator('#receiptFormat').selectOption('pretty')
      await expect.poll(async () => page.locator('#receipts .json-line').count()).toBeGreaterThan(1)
      await expectReferenceReceiptJsonSyntax(page)

      await expectCopies(page.getByRole('button', { name: 'Copy trace ID' }))
      await expectCopies(page.getByRole('button', { name: 'Copy Agent signature' }))
      await expectCopies(page.locator('.trace-integrity').getByRole('button', { name: 'Copy Merkle root' }))
      await expectCopies(page.getByRole('button', { name: 'Copy receipt' }))
      await expect(page.locator('#verification').getByRole('link', { name: 'View proof' })).toHaveAttribute(
        'href',
        /log\.atrib\.dev|\/api\/runs\//,
      )
      await expectReferenceVerificationRows(page)
      await page.locator('#verification').getByRole('button', { name: 'Verify' }).click()
      await expect(page.locator('#verificationResult')).toContainText('Record hash matches')
      await expect(page.locator('#verificationResult')).toContainText('Signature valid')
      await expect(page.locator('#verificationResult')).toContainText('Receipt verified')
      await expectVerificationResultRhythm(page)
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
      await expect(page.locator('#receipts pre')).toContainText('"proof":')
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
      await page.setViewportSize({ width: 1280, height: 720 })
      await page.goto('/')
      await expect(page).toHaveTitle('Cloudflare Agent Trace')
      await expect(page.getByTestId('approval-trace-app')).toBeVisible()
      await expectNoHorizontalOverflow(page)

      await expect(page.locator('#statusTitle')).toHaveText('Halted for human review', {
        timeout: 15_000,
      })
      await expect(page.locator('[data-step="halt"]')).toContainText('Awaiting review')
      await expectNoHorizontalOverflow(page)
      await expectWorkflowOverviewVisible(page)
      await expectActionButtonsUseReferenceLayout(page)
      await expectDiffLineGutter(page)
      await expectDiffRowsFillReferenceFrame(page)
      await expectWorkflowStepCopyHugsContent(page)
      await expectConstrainedDesktopRailGeometry(page)
      await expectTraceRowsReadable(page)
      await expectReferenceTimelineSpacing(page)

      const firstRunId = await page.locator('#runIdLabel').textContent()
      await page.locator('#headerMenu').click()
      await page.locator('[data-header-action="reset"]').click()
      await expect(page.locator('#runIdLabel')).not.toHaveText('pending')
      await expect(page.locator('#runIdLabel')).toHaveText(/^run_[A-Z0-9]+/)
      await expect(page.locator('#runIdLabel')).toHaveAttribute('data-run-id', /.+/)
      await expect.poll(async () => page.locator('#runIdLabel').textContent()).not.toBe(firstRunId)
      await expect(page.locator('#answer')).toContainText('Trigger received')
      await expect(page.locator('#statusTitle')).toHaveText('Halted for human review', {
        timeout: 15_000,
      })
      await expectNoHorizontalOverflow(page)
      await expectWorkflowOverviewVisible(page)

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
