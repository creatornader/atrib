// SPDX-License-Identifier: Apache-2.0

import { spawn } from 'node:child_process'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { createClient, type Environment } from '@proof.com/proof-vc-common'
import type { TrustRoot } from '@proof.com/proof-vc-server'
import { runProofVcCommonX401Interop } from '../src/proof-vc-common-x401.js'

const BASIC_SCOPE = 'urn:proof:params:scope:verifiable-credentials:basic' as const

function env(name: string): string | undefined {
  const value = process.env[name]
  return value === undefined || value === '' ? undefined : value
}

function numberEnv(name: string, fallback: number): number {
  const raw = env(name)
  if (raw === undefined) return fallback
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`${name} must be a TCP port`)
  }
  return parsed
}

function readEnvironment(): Environment {
  const value = env('ATRIB_PROOF_VC_CAPTURE_ENVIRONMENT') ?? 'sandbox'
  if (
    value === 'localhost' ||
    value === 'next' ||
    value === 'staging' ||
    value === 'sandbox' ||
    value === 'production'
  ) {
    return value
  }
  throw new Error('ATRIB_PROOF_VC_CAPTURE_ENVIRONMENT is not a supported Proof environment')
}

function readTrustRoot(proofEnvironment: Environment): TrustRoot {
  const value =
    env('ATRIB_PROOF_VC_COMMON_TRUST_ROOT') ??
    env('ATRIB_PROOF_VC_CAPTURE_TRUST_ROOT') ??
    (proofEnvironment === 'production' ? 'production' : 'development')
  if (value === 'development' || value === 'production') return value
  throw new Error('ATRIB_PROOF_VC_CAPTURE_TRUST_ROOT must be development or production')
}

function send(res: ServerResponse, status: number, body: string, contentType = 'text/plain'): void {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
  })
  res.end(body)
}

function sendInternalError(res: ServerResponse): void {
  if (res.writableEnded) return
  if (res.headersSent) {
    res.end()
    return
  }
  send(res, 500, 'Proof credential capture failed')
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.stack ?? err.message
  return String(err)
}

function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => {
      body += chunk
      if (body.length > 2_000_000) {
        reject(new Error('request body too large'))
        req.destroy()
      }
    })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

function callbackPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Proof credential capture</title>
</head>
<body>
  <main>
    <h1>Proof credential capture</h1>
    <p id="status">Capturing the credential response locally.</p>
  </main>
  <script>
    const status = document.getElementById('status');
    const source = window.location.hash || window.location.search;
    const params = new URLSearchParams(source.replace(/^[#?]/, ''));
    const vpToken = params.get('vp_token');
    const state = params.get('state');
    if (!vpToken) {
      status.textContent = 'No vp_token was returned.';
    } else {
      fetch('/proof-vc/capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vpToken, state })
      }).then(async (response) => {
        status.textContent = response.ok
          ? 'Credential captured and verified. You can close this tab.'
          : await response.text();
      }).catch((error) => {
        status.textContent = String(error);
      });
    }
  </script>
</body>
</html>`
}

function maybeOpen(url: string): void {
  if (!process.argv.includes('--open') && env('ATRIB_PROOF_VC_CAPTURE_OPEN') !== '1') return
  if (process.platform !== 'darwin') return
  const child = spawn('open', [url], {
    detached: true,
    stdio: 'ignore',
  })
  child.unref()
}

async function main(): Promise<void> {
  const proofEnvironment = readEnvironment()
  const trustRoot = readTrustRoot(proofEnvironment)
  const host = env('ATRIB_PROOF_VC_CAPTURE_HOST') ?? '127.0.0.1'
  const port = numberEnv('ATRIB_PROOF_VC_CAPTURE_PORT', 8765)
  const clientId = env('ATRIB_PROOF_VC_CAPTURE_CLIENT_ID') ?? 'verifier-demo'
  const callbackPath = env('ATRIB_PROOF_VC_CAPTURE_CALLBACK_PATH') ?? '/proof-vc/callback'
  const nonce = env('ATRIB_PROOF_VC_CAPTURE_NONCE') ?? randomUUID()
  const state = env('ATRIB_PROOF_VC_CAPTURE_STATE') ?? randomUUID()
  const aud = env('ATRIB_PROOF_VC_CAPTURE_AUD') ?? env('ATRIB_PROOF_VC_COMMON_AUD')
  const callbackUri = `http://${host}:${port}${callbackPath}`
  const proof = createClient({
    environment: proofEnvironment,
    clientId,
    callbackUri,
  })
  const authorizationUrl = proof.authorizationUrl({
    nonce,
    scope: BASIC_SCOPE,
    state,
    ...(env('ATRIB_PROOF_VC_CAPTURE_LOGIN_HINT')
      ? { loginHint: env('ATRIB_PROOF_VC_CAPTURE_LOGIN_HINT') }
      : {}),
  })
  if (process.argv.includes('--print-url')) {
    console.log(
      JSON.stringify(
        {
          authorization_url: authorizationUrl,
          callback_uri: callbackUri,
          proof_environment: proofEnvironment,
          trust_root: trustRoot,
          nonce,
          state,
          aud: aud ?? null,
        },
        null,
        2,
      ),
    )
    return
  }

  const done = new Promise<void>((resolve, reject) => {
    const server = createServer(async (req, res) => {
      try {
        const url = new URL(req.url ?? '/', `http://${host}:${port}`)
        if (req.method === 'GET' && url.pathname === '/') {
          send(res, 200, `Open this URL to request a Proof VP token:\n\n${authorizationUrl}\n`)
          return
        }
        if (req.method === 'GET' && url.pathname === callbackPath) {
          send(res, 200, callbackPage(), 'text/html')
          return
        }
        if (req.method === 'POST' && url.pathname === '/proof-vc/capture') {
          const raw = await readRequestBody(req)
          const parsed = JSON.parse(raw) as { vpToken?: unknown; state?: unknown }
          if (parsed.state !== state) {
            send(res, 400, 'Proof credential state mismatch')
            return
          }
          if (typeof parsed.vpToken !== 'string' || parsed.vpToken.length === 0) {
            send(res, 400, 'Proof credential response did not include vp_token')
            return
          }

          const result = await runProofVcCommonX401Interop({
            mode: 'native',
            encodedVPToken: parsed.vpToken,
            nonce,
            trustRoot,
            ...(aud ? { aud } : {}),
          })
          console.log(JSON.stringify(result.public_packet, null, 2))
          send(res, result.verification.valid ? 200 : 422, JSON.stringify(result.public_packet))
          server.close((err) => {
            if (err) reject(err)
            else resolve()
          })
          return
        }
        send(res, 404, 'not found')
      } catch (err) {
        sendInternalError(res)
        console.error(describeError(err))
        reject(err)
      }
    })
    server.listen(port, host, () => {
      console.error(`Proof VP token capture listening at http://${host}:${port}/`)
      console.error(`Callback URI: ${callbackUri}`)
      console.error(`Authorization URL:\n${authorizationUrl}`)
      maybeOpen(authorizationUrl)
    })
  })

  await done
}

main().catch((err: unknown) => {
  console.error(describeError(err))
  process.exitCode = 2
})
