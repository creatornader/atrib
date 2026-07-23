#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0

import { startWitnessServer } from './server.js'

const config = readConfig(process.env)
if (!config.ok) {
  console.error(`atrib-witness: ${config.error}`)
  process.exit(1)
}

const server = await startWitnessServer(config.value)
console.log(`atrib-witness listening on ${server.url}`)
await server.update()
console.log(`atrib-witness verified and cosigned ${config.value.log.logKey.name}`)

process.on('SIGTERM', async () => {
  await server.close()
  process.exit(0)
})
process.on('SIGINT', async () => {
  await server.close()
  process.exit(0)
})

type ConfigResult =
  { ok: true; value: Parameters<typeof startWitnessServer>[0] } | { ok: false; error: string }

export function readConfig(env: NodeJS.ProcessEnv): ConfigResult {
  const required = [
    'ATRIB_WITNESS_NAME',
    'ATRIB_WITNESS_KEY',
    'ATRIB_WITNESS_LOG_URL',
    'ATRIB_WITNESS_LOG_ORIGIN',
    'ATRIB_WITNESS_LOG_PUBLIC_KEY',
    'ATRIB_WITNESS_STATE_DIR',
  ] as const
  const missing = required.filter((name) => !env[name])
  if (missing.length > 0) return { ok: false, error: `missing ${missing.join(', ')}` }

  const witnessKeyText = env.ATRIB_WITNESS_KEY as string
  const logKeyText = env.ATRIB_WITNESS_LOG_PUBLIC_KEY as string
  if (!/^[A-Za-z0-9_-]{43}$/.test(witnessKeyText)) {
    return { ok: false, error: 'ATRIB_WITNESS_KEY must be canonical unpadded base64url' }
  }
  if (!/^[A-Za-z0-9_-]{43}$/.test(logKeyText)) {
    return {
      ok: false,
      error: 'ATRIB_WITNESS_LOG_PUBLIC_KEY must be canonical unpadded base64url',
    }
  }
  const witnessKey = Buffer.from(witnessKeyText, 'base64url')
  const logKey = Buffer.from(logKeyText, 'base64url')
  if (witnessKey.length !== 32) {
    return { ok: false, error: 'ATRIB_WITNESS_KEY must decode to a 32-byte Ed25519 seed' }
  }
  if (logKey.length !== 32) {
    return { ok: false, error: 'ATRIB_WITNESS_LOG_PUBLIC_KEY must decode to 32 bytes' }
  }
  const pollIntervalMs = Number(env.ATRIB_WITNESS_POLL_INTERVAL_MS ?? 30_000)
  const port = Number(env.PORT ?? 3200)
  if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 1_000) {
    return { ok: false, error: 'ATRIB_WITNESS_POLL_INTERVAL_MS must be at least 1000' }
  }
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    return { ok: false, error: 'PORT must be between 1 and 65535' }
  }
  const gossipSources = parseGossipSources(env.ATRIB_WITNESS_GOSSIP_SOURCES)
  if (!gossipSources.ok) return gossipSources
  return {
    ok: true,
    value: {
      port,
      host: env.HOST ?? '0.0.0.0',
      identity: {
        name: env.ATRIB_WITNESS_NAME as string,
        privateKey: new Uint8Array(witnessKey),
      },
      log: {
        logBaseUrl: env.ATRIB_WITNESS_LOG_URL as string,
        logKey: {
          name: env.ATRIB_WITNESS_LOG_ORIGIN as string,
          publicKey: new Uint8Array(logKey),
        },
        ...(gossipSources.value.length > 0 ? { gossipSources: gossipSources.value } : {}),
      },
      stateDirectory: env.ATRIB_WITNESS_STATE_DIR as string,
      pollIntervalMs,
    },
  }
}

function parseGossipSources(
  value: string | undefined,
):
  | { ok: true; value: Array<{ sourceId: string; logBaseUrl: string }> }
  | { ok: false; error: string } {
  if (value === undefined || value.length === 0) return { ok: true, value: [] }
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return { ok: false, error: 'ATRIB_WITNESS_GOSSIP_SOURCES must be valid JSON' }
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, error: 'ATRIB_WITNESS_GOSSIP_SOURCES must be a JSON array' }
  }
  const sources: Array<{ sourceId: string; logBaseUrl: string }> = []
  const ids = new Set<string>()
  for (const entry of parsed) {
    if (
      entry === null ||
      typeof entry !== 'object' ||
      Array.isArray(entry) ||
      typeof (entry as { source_id?: unknown }).source_id !== 'string' ||
      typeof (entry as { log_base_url?: unknown }).log_base_url !== 'string'
    ) {
      return {
        ok: false,
        error: 'ATRIB_WITNESS_GOSSIP_SOURCES entries require string source_id and log_base_url',
      }
    }
    const sourceId = (entry as { source_id: string }).source_id
    const logBaseUrl = (entry as { log_base_url: string }).log_base_url
    if (sourceId.length === 0 || sourceId.includes('\n') || sourceId.includes('\r')) {
      return { ok: false, error: 'gossip source_id must be non-empty and single-line' }
    }
    if (ids.has(sourceId)) {
      return { ok: false, error: `duplicate gossip source_id: ${sourceId}` }
    }
    try {
      const url = new URL(logBaseUrl)
      if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error()
    } catch {
      return { ok: false, error: `gossip log_base_url is invalid: ${logBaseUrl}` }
    }
    ids.add(sourceId)
    sources.push({ sourceId, logBaseUrl })
  }
  return { ok: true, value: sources }
}
