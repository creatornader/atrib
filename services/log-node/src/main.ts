// SPDX-License-Identifier: Apache-2.0

/**
 * Standalone entry point for the atrib log service.
 *
 * Usage:
 *   ATRIB_LOG_KEY=<base64url-ed25519-seed> pnpm --filter @atrib/log-node start
 *
 * Environment variables:
 *   ATRIB_LOG_KEY               base64url-encoded 32-byte Ed25519 private key
 *                                for checkpoint signing. REQUIRED in production
 *                                (NODE_ENV=production) unless
 *                                ATRIB_LOG_KEY_ALLOW_RANDOM=1 is also set.
 *                                When omitted in development, a random key is
 *                                generated and a warning is printed; checkpoints
 *                                will not survive restarts.
 *   ATRIB_LOG_KEY_ALLOW_RANDOM  Set to "1" to permit random-key fallback in
 *                                production. Use only when you know what you're
 *                                doing, random keys invalidate every prior
 *                                inclusion proof on every restart.
 *   ATRIB_LOG_PERSIST           Path to an append-only entries file. When set,
 *                                the tree restores from this file on startup
 *                                and persists each new entry to it before
 *                                responding. Critical for Fly redeploys.
 *   PORT                        TCP port to bind (default: 3100).
 *
 * Why fail-fast on missing ATRIB_LOG_KEY in production:
 *   The log key signs checkpoints. Every restart with a random key produces
 *   a new vkey/origin signature pair. Verifiers consulting old checkpoints
 *   for inclusion proofs will see "key changed" and fail. Persistence
 *   (ATRIB_LOG_PERSIST) keeps tree state across restarts but does NOT keep
 *   the signing key, without ATRIB_LOG_KEY a persistent tree's prior
 *   checkpoints become unverifiable. The fail-fast prevents quietly shipping
 *   a misconfigured production deploy that looks healthy but has invalidated
 *   its own audit trail.
 */

import { startLogServer } from './index.js'

export interface KeyConfigDecision {
  /** True if the server can start. False means caller should exit non-zero. */
  ok: boolean
  /** When ok=true, the decoded private key bytes (or undefined for random). */
  logPrivateKey?: Uint8Array
  /**
   * When ok=true and logPrivateKey is undefined, this message should be
   * surfaced as a warning (development random-key fallback).
   * When ok=false, this message is the fatal error reason.
   */
  message?: string
}

/**
 * Decide whether the log can start given the current key environment.
 * Pure function: no side effects, no process.exit. Caller owns the exit.
 *
 * Inputs are passed in (rather than read from process.env directly) so this
 * is straightforward to unit-test.
 */
export function decideKeyConfig(env: {
  ATRIB_LOG_KEY?: string | undefined
  ATRIB_LOG_KEY_ALLOW_RANDOM?: string | undefined
  NODE_ENV?: string | undefined
}): KeyConfigDecision {
  const isProduction = env.NODE_ENV === 'production'
  const allowRandom = env.ATRIB_LOG_KEY_ALLOW_RANDOM === '1'

  if (env.ATRIB_LOG_KEY) {
    const b64 = env.ATRIB_LOG_KEY.replace(/-/g, '+').replace(/_/g, '/')
    const pad = (4 - (b64.length % 4)) % 4
    const decoded = Uint8Array.from(Buffer.from(b64 + '='.repeat(pad), 'base64'))
    if (decoded.length !== 32) {
      return {
        ok: false,
        message: `ATRIB_LOG_KEY must decode to exactly 32 bytes (got ${decoded.length}). Use \`pnpm exec atrib keygen\` to generate a valid key.`,
      }
    }
    return { ok: true, logPrivateKey: decoded }
  }

  if (isProduction && !allowRandom) {
    return {
      ok: false,
      message:
        'ATRIB_LOG_KEY is not set and NODE_ENV=production. A random key would invalidate every prior inclusion proof on the next restart. Set ATRIB_LOG_KEY (base64url-encoded 32-byte Ed25519 seed) or, only if you know exactly what you are doing, set ATRIB_LOG_KEY_ALLOW_RANDOM=1.',
    }
  }

  return {
    ok: true,
    message:
      'No ATRIB_LOG_KEY. Using a random keypair. Checkpoints will not survive restarts. Acceptable for local development; never for production.',
  }
}

// Allow main() to be skipped when this module is imported (for tests of
// decideKeyConfig in isolation). Vitest sets process.argv[1] to itself.
import { fileURLToPath } from 'node:url'
const isMain = process.argv[1] === fileURLToPath(import.meta.url)

if (isMain) {
  const port = parseInt(process.env.PORT ?? '3100', 10)
  const decision = decideKeyConfig({
    ATRIB_LOG_KEY: process.env.ATRIB_LOG_KEY,
    ATRIB_LOG_KEY_ALLOW_RANDOM: process.env.ATRIB_LOG_KEY_ALLOW_RANDOM,
    NODE_ENV: process.env.NODE_ENV,
  })

  if (!decision.ok) {
    // eslint-disable-next-line no-console
    console.error(`atrib-log: ${decision.message}`)
    process.exit(1)
  }

  if (decision.message) {
    // eslint-disable-next-line no-console
    console.warn(`⚠ atrib-log: ${decision.message}`)
  }

  const opts = {
    port,
    ...(decision.logPrivateKey ? { logPrivateKey: decision.logPrivateKey } : {}),
    ...(process.env.HOST ? { host: process.env.HOST } : {}),
    ...(process.env.ATRIB_LOG_PERSIST ? { persistencePath: process.env.ATRIB_LOG_PERSIST } : {}),
  }
  const server = await startLogServer(opts)

  // eslint-disable-next-line no-console
  console.log(`atrib-log listening on ${server.url}`)

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    await server.close()
    process.exit(0)
  })
  process.on('SIGINT', async () => {
    await server.close()
    process.exit(0)
  })
}
