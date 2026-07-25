// SPDX-License-Identifier: Apache-2.0

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import * as ed from '@noble/ed25519'
import { checkpointKeyId } from '@atrib/verify'
import { WitnessStore } from './store.js'
import { witnessOnce, type WitnessIdentity, type WitnessLogConfig } from './witness.js'

export interface WitnessServerConfig {
  port?: number
  host?: string
  identity: WitnessIdentity
  log: WitnessLogConfig
  stateDirectory: string
  pollIntervalMs?: number
  healthMaxCheckAgeSeconds?: number
  fetch?: typeof globalThis.fetch
  nowSeconds?: () => number
}

export interface WitnessServerHandle {
  url: string
  update(): Promise<void>
  close(): Promise<void>
}

export async function startWitnessServer(
  config: WitnessServerConfig,
): Promise<WitnessServerHandle> {
  const store = new WitnessStore(config.stateDirectory)
  const publicKey = await ed.getPublicKeyAsync(config.identity.privateKey)
  const keyId = checkpointKeyId(config.identity.name, publicKey)
  let updating: Promise<void> | undefined
  const nowSeconds = config.nowSeconds ?? (() => Math.floor(Date.now() / 1_000))
  const healthMaxCheckAgeSeconds =
    config.healthMaxCheckAgeSeconds ??
    Math.max(60, Math.ceil((config.pollIntervalMs ?? 30_000) / 500))

  const update = (): Promise<void> => {
    updating ??= witnessOnce({
      log: config.log,
      identity: config.identity,
      store,
      nowSeconds: nowSeconds(),
      ...(config.fetch ? { fetch: config.fetch } : {}),
    })
      .then(() => {
        store.recordCheck(config.log.logKey.name, nowSeconds(), { successful: true })
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        store.recordCheck(config.log.logKey.name, nowSeconds(), {
          successful: false,
          error: message,
        })
        throw error
      })
      .finally(() => {
        updating = undefined
      })
    return updating
  }

  const server = createServer((request, response) => {
    void route(request, response).catch((error: unknown) => {
      sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) })
    })
  })
  const interval =
    config.pollIntervalMs && config.pollIntervalMs > 0
      ? setInterval(() => void update().catch(() => undefined), config.pollIntervalMs)
      : undefined
  interval?.unref()

  async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const path = new URL(request.url ?? '/', 'http://witness.invalid').pathname
    if (request.method === 'GET' && path === '/v1/pubkey') {
      sendJson(response, 200, {
        origin: config.identity.name,
        public_key: Buffer.from(publicKey).toString('base64url'),
        key_id: Buffer.from(keyId).toString('hex'),
        algorithm: 'Ed25519',
      })
      return
    }
    if (request.method === 'GET' && path === '/v1/log-pubkey') {
      const payload = Buffer.concat([Buffer.from([1]), Buffer.from(publicKey)])
      sendText(
        response,
        200,
        `${config.identity.name}+${Buffer.from(keyId).toString('hex')}+${payload.toString('base64')}\n`,
      )
      return
    }
    if (request.method === 'GET' && path === '/v1/status') {
      const state = store.load(config.log.logKey.name)
      const health = store.loadHealth(config.log.logKey.name)
      const checkAgeSeconds =
        health?.lastSuccessfulCheckAtSeconds === undefined
          ? null
          : Math.max(0, nowSeconds() - health.lastSuccessfulCheckAtSeconds)
      const healthStatus =
        health?.lastError !== undefined
          ? 'error'
          : checkAgeSeconds === null || checkAgeSeconds > healthMaxCheckAgeSeconds
            ? 'stale'
            : 'ok'
      sendJson(response, 200, {
        witness: config.identity.name,
        log_origin: config.log.logKey.name,
        tree_size: state?.treeSize ?? null,
        root_hash: state?.rootHashBase64 ?? null,
        checkpoint_witnessed_at: state?.witnessedAtSeconds ?? null,
        witnessed_at: state?.witnessedAtSeconds ?? null,
        last_checked_at: health?.lastCheckedAtSeconds ?? null,
        last_successful_check_at: health?.lastSuccessfulCheckAtSeconds ?? null,
        successful_check_age_seconds: checkAgeSeconds,
        health_max_check_age_seconds: healthMaxCheckAgeSeconds,
        health: healthStatus,
        incident_count: store.listIncidents().length,
        updating: updating !== undefined,
        error: health?.lastError ?? null,
      })
      return
    }
    if (request.method === 'GET' && path === '/v1/health') {
      const state = store.load(config.log.logKey.name)
      const health = store.loadHealth(config.log.logKey.name)
      const checkAgeSeconds =
        health?.lastSuccessfulCheckAtSeconds === undefined
          ? null
          : Math.max(0, nowSeconds() - health.lastSuccessfulCheckAtSeconds)
      const healthy =
        state !== undefined &&
        health?.lastError === undefined &&
        checkAgeSeconds !== null &&
        checkAgeSeconds <= healthMaxCheckAgeSeconds
      sendJson(response, healthy ? 200 : 503, {
        status: healthy ? 'ok' : health?.lastError ? 'error' : 'stale',
        last_successful_check_at: health?.lastSuccessfulCheckAtSeconds ?? null,
        successful_check_age_seconds: checkAgeSeconds,
        incident_count: store.listIncidents().length,
      })
      return
    }
    if (request.method === 'GET' && path === '/v1/checkpoint') {
      const state = store.load(config.log.logKey.name)
      if (!state) {
        sendJson(response, 404, { error: 'checkpoint not witnessed' })
        return
      }
      sendText(response, 200, state.checkpointNote)
      return
    }
    if (request.method === 'GET' && path === '/v1/incidents') {
      sendJson(response, 200, { incidents: store.listIncidents() })
      return
    }
    const incidentMatch = path.match(/^\/v1\/incidents\/([0-9a-f]{64})$/)
    if (request.method === 'GET' && incidentMatch) {
      const incident = store.getIncident(`sha256:${incidentMatch[1] as string}`)
      if (!incident) {
        sendJson(response, 404, { error: 'checkpoint gossip incident not found' })
        return
      }
      sendJson(response, 200, incident, true)
      return
    }
    const match = path.match(/^\/v1\/cosig\/([^/]+)\/([A-Za-z0-9_-]{43})$/)
    if (request.method === 'GET' && match) {
      let logOrigin: string
      try {
        logOrigin = decodeURIComponent(match[1] as string)
      } catch {
        sendJson(response, 400, { error: 'malformed log origin' })
        return
      }
      const cosignature = store.getCosignature(logOrigin, match[2] as string)
      if (!cosignature) {
        sendJson(response, 404, { error: 'checkpoint not witnessed' })
        return
      }
      sendText(response, 200, cosignature, true)
      return
    }
    sendJson(response, 404, { error: 'not found' })
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(config.port ?? 0, config.host ?? '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('witness server did not bind TCP')
  return {
    url: `http://${config.host ?? '127.0.0.1'}:${address.port}`,
    update,
    close: async () => {
      if (interval) clearInterval(interval)
      if (updating) await updating.catch(() => undefined)
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      )
    },
  }
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  immutable = false,
): void {
  const text = `${JSON.stringify(body)}\n`
  response.statusCode = status
  response.setHeader('content-type', 'application/json')
  response.setHeader('content-length', Buffer.byteLength(text))
  response.setHeader(
    'cache-control',
    immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=60',
  )
  response.end(text)
}

function sendText(response: ServerResponse, status: number, body: string, immutable = false): void {
  response.statusCode = status
  response.setHeader('content-type', 'text/plain; charset=utf-8')
  response.setHeader('content-length', Buffer.byteLength(body))
  response.setHeader(
    'cache-control',
    immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=60',
  )
  response.end(body)
}
