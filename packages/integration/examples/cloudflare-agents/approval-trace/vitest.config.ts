// SPDX-License-Identifier: Apache-2.0

import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: {
        configPath: './wrangler.test.jsonc',
      },
    }),
  ],
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 30_000,
  },
})
