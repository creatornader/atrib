// SPDX-License-Identifier: Apache-2.0

/**
 * Node HTTP binding for the optional local substrate coordinator.
 *
 * This is a hosting adapter around the shared P042 coordinator handler. It is
 * intentionally not a daemon, MCP server, or new process manager.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import {
  LOCAL_SUBSTRATE_HTTP_DEFAULT_HEALTH_PATH,
  LOCAL_SUBSTRATE_HTTP_DEFAULT_PATH,
  handleLocalSubstrateCoordinatorHttpRequest,
} from './local-substrate.js'
import type {
  LocalSubstrateCoordinatorHttpOptions,
  LocalSubstrateCoordinatorService,
} from './local-substrate.js'

export const LOCAL_SUBSTRATE_NODE_DEFAULT_HOST = '127.0.0.1'
export const LOCAL_SUBSTRATE_NODE_DEFAULT_PORT = 8787
export const LOCAL_SUBSTRATE_NODE_DEFAULT_MAX_BODY_BYTES = 1_048_576

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export interface LocalSubstrateNodeServerOptions extends LocalSubstrateCoordinatorHttpOptions {
  host?: string
  port?: number
  maxBodyBytes?: number
}

export interface LocalSubstrateNodeServerHandle {
  server: Server
  url: string
  endpoint: string
  healthEndpoint: string
  close: () => Promise<void>
}

export async function bindLocalSubstrateCoordinatorNodeServer(
  coordinator: LocalSubstrateCoordinatorService,
  options: LocalSubstrateNodeServerOptions = {},
): Promise<LocalSubstrateNodeServerHandle> {
  const endpointPath = options.endpointPath ?? LOCAL_SUBSTRATE_HTTP_DEFAULT_PATH
  const healthPath = options.healthPath ?? LOCAL_SUBSTRATE_HTTP_DEFAULT_HEALTH_PATH
  const maxBodyBytes = positiveIntegerOr(
    options.maxBodyBytes,
    LOCAL_SUBSTRATE_NODE_DEFAULT_MAX_BODY_BYTES,
  )

  const server = createServer((req, res) => {
    handleNodeRequest(req, res, coordinator, {
      endpointPath,
      healthPath,
      maxBodyBytes,
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    }).catch((error) => {
      if (!res.headersSent) {
        sendJson(res, 500, { error: 'internal_error' })
      } else {
        res.destroy(error instanceof Error ? error : undefined)
      }
    })
  })

  server.headersTimeout = 5_000
  server.requestTimeout = 30_000

  const bindHost = options.host ?? LOCAL_SUBSTRATE_NODE_DEFAULT_HOST
  const port = options.port ?? LOCAL_SUBSTRATE_NODE_DEFAULT_PORT
  await new Promise<void>((resolve) => {
    server.listen(port, bindHost, resolve)
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    await closeServer(server)
    throw new Error('local substrate node server address had unexpected shape')
  }

  const url = `http://${bindHost === '0.0.0.0' ? '127.0.0.1' : bindHost}:${address.port}`

  return {
    server,
    url,
    endpoint: `${url}${endpointPath}`,
    healthEndpoint: `${url}${healthPath}`,
    close: () => closeServer(server),
  }
}

interface NodeRequestOptions extends LocalSubstrateCoordinatorHttpOptions {
  endpointPath: string
  healthPath: string
  maxBodyBytes: number
}

async function handleNodeRequest(
  req: IncomingMessage,
  res: ServerResponse,
  coordinator: LocalSubstrateCoordinatorService,
  options: NodeRequestOptions,
): Promise<void> {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return
  }

  const method = req.method ?? 'GET'
  const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
  let body: unknown

  if (method === 'POST' && pathname === options.endpointPath) {
    const rawBody = await readRequestBody(req, options.maxBodyBytes)
    if (rawBody.tooLarge) {
      sendJson(res, 413, {
        error: 'payload_too_large',
        message: `request body exceeds ${options.maxBodyBytes} bytes`,
      })
      return
    }
    try {
      body = rawBody.text.length === 0 ? undefined : JSON.parse(rawBody.text)
    } catch {
      sendJson(res, 400, {
        error: 'invalid_json',
        message: 'request body must be JSON',
      })
      return
    }
  }

  const result = await handleLocalSubstrateCoordinatorHttpRequest(
    coordinator,
    method,
    pathname,
    body,
    {
      endpointPath: options.endpointPath,
      healthPath: options.healthPath,
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    },
  )

  if (!result) {
    sendJson(res, 404, { error: 'not_found' })
    return
  }

  res.statusCode = result.status
  for (const [name, value] of Object.entries(result.headers)) {
    res.setHeader(name, value)
  }
  res.end(method === 'HEAD' ? '' : result.body)
}

async function readRequestBody(
  req: IncomingMessage,
  maxBodyBytes: number,
): Promise<{ text: string; tooLarge: boolean }> {
  const chunks: Uint8Array[] = []
  let total = 0
  let tooLarge = false

  for await (const chunk of req) {
    const buffer = toBytes(chunk)
    total += buffer.length
    if (total > maxBodyBytes) {
      tooLarge = true
      continue
    }
    if (!tooLarge) chunks.push(buffer)
  }

  return { text: decoder.decode(concatBytes(chunks)), tooLarge }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(body))
}

function positiveIntegerOr(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && value !== undefined && value > 0 ? value : fallback
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
}

function toBytes(chunk: unknown): Uint8Array {
  if (chunk instanceof Uint8Array) return chunk
  return encoder.encode(typeof chunk === 'string' ? chunk : String(chunk))
}

function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}
