#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0

// atrib-local-substrate forwarding shim. The host implementation lives in
// @atrib/attest; this bin keeps the historical name working for operator
// LaunchAgents and scripts that exec it.

import { runLocalSubstrateHost } from '@atrib/attest/dist/local-substrate-host.js'

runLocalSubstrateHost().catch((error: unknown) => {
  process.stderr.write(
    `atrib-local-substrate: fatal ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  )
  process.exit(1)
})
