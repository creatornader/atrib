// SPDX-License-Identifier: Apache-2.0

/**
 * Standalone entry point for the atrib log service.
 *
 * Usage:
 *   ATRIB_LOG_KEY=<base64url-ed25519-seed> pnpm --filter @atrib/log-node start
 *
 * Environment variables:
 *   ATRIB_LOG_KEY        . base64url-encoded 32-byte Ed25519 private key for
 *                          checkpoint signing. If omitted, a random key is
 *                          generated (checkpoints won't survive restarts).
 *   ATRIB_LOG_PERSIST    . Path to an append-only entries file. When set,
 *                          the tree restores from this file on startup and
 *                          persists each new entry to it before responding.
 *                          Critical for Fly redeploys; without it, the tree
 *                          resets to size 0 on every process start.
 *   PORT                 . TCP port to bind (default: 3100)
 */

import { startLogServer } from './index.js'

const port = parseInt(process.env.PORT ?? '3100', 10)

// Decode key from base64url if provided, otherwise auto-generate
let logPrivateKey: Uint8Array | undefined
if (process.env.ATRIB_LOG_KEY) {
  const b64 = process.env.ATRIB_LOG_KEY.replace(/-/g, '+').replace(/_/g, '/')
  const pad = (4 - (b64.length % 4)) % 4
  logPrivateKey = Uint8Array.from(Buffer.from(b64 + '='.repeat(pad), 'base64'))
}

const opts = {
  port,
  ...(logPrivateKey ? { logPrivateKey } : {}),
  ...(process.env.HOST ? { host: process.env.HOST } : {}),
  ...(process.env.ATRIB_LOG_PERSIST ? { persistencePath: process.env.ATRIB_LOG_PERSIST } : {}),
}
const server = await startLogServer(opts)

// eslint-disable-next-line no-console
console.log(`atrib-log listening on ${server.url}`)
if (!process.env.ATRIB_LOG_KEY) {
  // eslint-disable-next-line no-console
  console.warn('⚠ No ATRIB_LOG_KEY. using random keypair. Checkpoints will not survive restarts.')
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  await server.close()
  process.exit(0)
})
process.on('SIGINT', async () => {
  await server.close()
  process.exit(0)
})
