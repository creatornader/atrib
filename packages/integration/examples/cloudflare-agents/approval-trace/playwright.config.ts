// SPDX-License-Identifier: Apache-2.0

import { defineConfig } from '@playwright/test'

const browserPort = Number.parseInt(process.env.APPROVAL_TRACE_TEST_PORT ?? '8788', 10)
if (!Number.isSafeInteger(browserPort) || browserPort <= 0) {
  throw new Error(`invalid APPROVAL_TRACE_TEST_PORT: ${process.env.APPROVAL_TRACE_TEST_PORT}`)
}

const browserBaseUrl = `http://127.0.0.1:${browserPort}`

export default defineConfig({
  testDir: './test/browser',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: {
    timeout: 15_000,
  },
  reporter: [['list']],
  use: {
    baseURL: browserBaseUrl,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `pnpm exec wrangler dev --config wrangler.test.jsonc --ip 127.0.0.1 --port ${browserPort} --persist-to .wrangler/browser-test-state --log-level error`,
    url: browserBaseUrl,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
