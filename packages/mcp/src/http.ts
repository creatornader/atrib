// SPDX-License-Identifier: Apache-2.0

/**
 * HTTP handler for atrib well-known endpoints (§5.3.5, §5.3.6).
 *
 * Serves two routes:
 *   GET /.well-known/atrib-policy.json , policy document (§5.3.6)
 *   GET /.well-known/atrib-proof/{hash}, cached inclusion proof (§5.3.5)
 *
 * Two API surfaces:
 *   1. createAtribHttpHandler(), returns a web-standard Request => Response
 *      handler for Hono, Deno, Bun, Cloudflare Workers, and similar runtimes.
 *   2. handleAtribRequest(), returns a plain { status, headers, body } object
 *      for Express, Fastify, or any custom HTTP framework.
 */

import type { AtribServer } from './middleware.js'

const POLICY_PATH = '/.well-known/atrib-policy.json'
const PROOF_PATH_PREFIX = '/.well-known/atrib-proof/'

/** Framework-agnostic response shape for handleAtribRequest(). */
export interface AtribHttpResult {
  status: number
  headers: Record<string, string>
  body: string
}

/**
 * Resolve an atrib well-known request to a plain response object.
 *
 * Returns null if the pathname does not match any atrib endpoint,
 * allowing the caller to fall through to their own routing.
 *
 * @param server - The AtribServer instance returned by atrib().
 * @param method - HTTP method (e.g. "GET").
 * @param pathname - URL pathname (e.g. "/.well-known/atrib-policy.json").
 */
export function handleAtribRequest(
  server: AtribServer,
  method: string,
  pathname: string,
): AtribHttpResult | null {
  const isHead = method === 'HEAD'

  // Policy endpoint (§5.3.6)
  if (pathname === POLICY_PATH) {
    if (method !== 'GET' && method !== 'HEAD') {
      return {
        status: 405,
        headers: { 'Allow': 'GET, HEAD', 'Content-Type': 'text/plain' },
        body: 'Method Not Allowed',
      }
    }

    const policy = server.policy
    if (!policy) {
      return {
        status: 404,
        headers: { 'Content-Type': 'text/plain' },
        body: 'No policy configured',
      }
    }

    return {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'max-age=300',
      },
      body: isHead ? '' : JSON.stringify(policy),
    }
  }

  // Proof endpoint (§5.3.5)
  if (pathname.startsWith(PROOF_PATH_PREFIX)) {
    if (method !== 'GET' && method !== 'HEAD') {
      return {
        status: 405,
        headers: { 'Allow': 'GET, HEAD', 'Content-Type': 'text/plain' },
        body: 'Method Not Allowed',
      }
    }

    const recordHash = pathname.slice(PROOF_PATH_PREFIX.length)
    if (!recordHash || !/^[0-9a-f]{64}$/.test(recordHash)) {
      return {
        status: 400,
        headers: { 'Content-Type': 'text/plain' },
        body: 'Invalid record hash: expected 64 hex characters',
      }
    }

    const proof = server.getProof(recordHash)
    if (!proof) {
      return {
        status: 404,
        headers: { 'Content-Type': 'text/plain' },
        body: 'Proof not found',
      }
    }

    return {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
      body: isHead ? '' : JSON.stringify(proof),
    }
  }

  // Not an atrib endpoint; let the caller handle it.
  return null
}

/**
 * Create a web-standard HTTP handler for atrib well-known endpoints.
 *
 * Returns a function that accepts a Request and returns a Response for
 * matched routes, or null for unmatched routes.
 *
 * Works natively with Hono, Deno.serve, Bun.serve, Cloudflare Workers,
 * and any runtime that uses the Fetch API Request/Response types.
 *
 * Usage with Hono:
 * ```ts
 * const handler = createAtribHttpHandler(atribServer)
 * app.all('/.well-known/*', (c) => {
 *   const response = handler(c.req.raw)
 *   return response ?? c.notFound()
 * })
 * ```
 *
 * Usage with Express (via a small adapter):
 * ```ts
 * const handler = createAtribHttpHandler(atribServer)
 * app.use((req, res, next) => {
 *   const response = handler(new Request(`http://localhost${req.url}`, { method: req.method }))
 *   if (!response) return next()
 *   res.status(response.status)
 *   response.headers.forEach((v, k) => res.setHeader(k, v))
 *   response.text().then((body) => res.send(body))
 * })
 * ```
 */
export function createAtribHttpHandler(
  server: AtribServer,
): (request: Request) => Response | null {
  return (request: Request): Response | null => {
    const url = new URL(request.url)
    const result = handleAtribRequest(server, request.method, url.pathname)

    if (!result) return null

    return new Response(request.method === 'HEAD' ? null : result.body, {
      status: result.status,
      headers: result.headers,
    })
  }
}
