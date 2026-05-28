// SPDX-License-Identifier: Apache-2.0

import { defineConfig } from '@playwright/test'

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
    baseURL: 'http://127.0.0.1:8788',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command:
      'pnpm exec wrangler dev --config wrangler.test.jsonc --ip 127.0.0.1 --port 8788 --persist-to .wrangler/browser-test-state --log-level error',
    url: 'http://127.0.0.1:8788',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
