// SPDX-License-Identifier: Apache-2.0

/**
 * Standalone entry point for the atrib graph query service.
 *
 * Usage:
 *   pnpm --filter @atrib/graph-node start
 *
 * Environment variables:
 *   PORT . TCP port to bind (default: 3200)
 *   HOST . Bind address (default: 127.0.0.1)
 */

import { bindGraphServer } from './server.js'

const port = parseInt(process.env.PORT ?? '3200', 10)
const host = process.env.HOST ?? '127.0.0.1'

const server = await bindGraphServer(port, host)

// eslint-disable-next-line no-console
console.log(`atrib-graph listening on ${server.url}`)

// Graceful shutdown
process.on('SIGTERM', async () => {
  await server.close()
  process.exit(0)
})
process.on('SIGINT', async () => {
  await server.close()
  process.exit(0)
})
