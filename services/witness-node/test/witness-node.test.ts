// SPDX-License-Identifier: Apache-2.0

import { createServer, type Server } from 'node:http'
import { appendFileSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import * as ed from '@noble/ed25519'
import { sha512 } from '@noble/hashes/sha2.js'
import { leafHash } from '@atrib/mcp'
import {
  checkpointKeyId,
  checkpointRootFromLeafHashes,
  verifyCheckpointWitnessThreshold,
} from '@atrib/verify'
import { startWitnessServer } from '../src/server.js'

ed.hashes.sha512 = sha512
ed.hashes.sha512Async = (message) => Promise.resolve(sha512(message))

const LOG_NAME = 'log.fixture/v1'
const WITNESS_NAME = 'witness.fixture'
const LOG_SEED = new Uint8Array(32).fill(31)
const WITNESS_SEED = new Uint8Array(32).fill(41)

let logPublicKey: Uint8Array
let witnessPublicKey: Uint8Array
const temporaryDirectories: string[] = []
const closers: Array<() => Promise<void>> = []

beforeAll(async () => {
  logPublicKey = await ed.getPublicKeyAsync(LOG_SEED)
  witnessPublicKey = await ed.getPublicKeyAsync(WITNESS_SEED)
})

afterEach(async () => {
  while (closers.length > 0) await (closers.pop() as () => Promise<void>)()
  while (temporaryDirectories.length > 0) {
    rmSync(temporaryDirectories.pop() as string, { recursive: true, force: true })
  }
})

describe('witness node end to end', () => {
  it('witnesses extensions, publishes a verifiable cosignature, and rejects a rewrite', async () => {
    const log = await startFixtureLog([
      leafHash(Uint8Array.of(1)),
      leafHash(Uint8Array.of(2)),
      leafHash(Uint8Array.of(3)),
    ])
    const stateDirectory = mkdtempSync(join(tmpdir(), 'atrib-witness-test-'))
    temporaryDirectories.push(stateDirectory)
    const witness = await startWitnessServer({
      identity: { name: WITNESS_NAME, privateKey: WITNESS_SEED },
      log: {
        logBaseUrl: `${log.url}////`,
        logKey: { name: LOG_NAME, publicKey: logPublicKey },
      },
      stateDirectory,
    })
    closers.push(witness.close)

    await witness.update()
    expect((await fetch(`${witness.url}/v1/update`, { method: 'POST' })).status).toBe(404)
    const firstCheckpoint = await (await fetch(`${log.url}/v1/checkpoint`)).text()
    const firstRoot = checkpointRootFromLeafHashes(log.hashes)
    const firstCosigUrl =
      `${witness.url}/v1/cosig/${encodeURIComponent(LOG_NAME)}/` +
      Buffer.from(firstRoot).toString('base64url')
    const firstCosigResponse = await fetch(firstCosigUrl)
    expect(firstCosigResponse.status).toBe(200)
    expect(firstCosigResponse.headers.get('cache-control')).toContain('immutable')
    const firstCosig = await firstCosigResponse.text()
    const verification = await verifyCheckpointWitnessThreshold(
      `${firstCheckpoint.trimEnd()}\n${firstCosig}`,
      {
        operatorKey: { name: LOG_NAME, publicKey: logPublicKey },
        witnessKeys: [{ name: WITNESS_NAME, publicKey: witnessPublicKey }],
        requiredWitnesses: 1,
        nowSeconds: Math.floor(Date.now() / 1000),
      },
    )
    expect(verification.thresholdMet).toBe(true)

    const leafHistory = readdirSync(stateDirectory).find((name) => name.endsWith('.leaves'))
    expect(leafHistory).toBeDefined()
    appendFileSync(join(stateDirectory, leafHistory as string), Buffer.alloc(32, 255))

    log.hashes.push(leafHash(Uint8Array.of(4)), leafHash(Uint8Array.of(5)))
    await witness.update()
    expect(statSync(join(stateDirectory, leafHistory as string)).size).toBe(5 * 32)
    expect(await (await fetch(`${witness.url}/v1/status`)).json()).toMatchObject({
      tree_size: 5,
      error: null,
    })

    log.hashes[1] = leafHash(Uint8Array.of(99))
    log.hashes.push(leafHash(Uint8Array.of(6)))
    await expect(witness.update()).rejects.toThrow('leaf 1 changed')
    expect(await (await fetch(`${witness.url}/v1/status`)).json()).toMatchObject({
      tree_size: 5,
      error: 'checkpoint split view: leaf 1 changed',
    })
  })

  it('refuses a gossiped split view and publishes an immutable incident', async () => {
    const primary = await startFixtureLog([
      leafHash(Uint8Array.of(1)),
      leafHash(Uint8Array.of(2)),
      leafHash(Uint8Array.of(3)),
    ])
    const peer = await startFixtureLog([
      leafHash(Uint8Array.of(1)),
      leafHash(Uint8Array.of(99)),
      leafHash(Uint8Array.of(3)),
    ])
    const stateDirectory = mkdtempSync(join(tmpdir(), 'atrib-witness-gossip-test-'))
    temporaryDirectories.push(stateDirectory)
    const witness = await startWitnessServer({
      identity: { name: WITNESS_NAME, privateKey: WITNESS_SEED },
      log: {
        logBaseUrl: primary.url,
        logKey: { name: LOG_NAME, publicKey: logPublicKey },
        gossipSources: [{ sourceId: 'peer-observer', logBaseUrl: peer.url }],
      },
      stateDirectory,
    })
    closers.push(witness.close)

    await expect(witness.update()).rejects.toThrow('checkpoint gossip conflict')
    await expect(witness.update()).rejects.toThrow('checkpoint gossip conflict')
    expect(await (await fetch(`${witness.url}/v1/status`)).json()).toMatchObject({
      tree_size: null,
      incident_count: 1,
    })

    const incidentList = (await (await fetch(`${witness.url}/v1/incidents`)).json()) as {
      incidents: Array<{ incident_id: string; kind: string }>
    }
    expect(incidentList.incidents).toHaveLength(1)
    expect(incidentList.incidents[0]).toMatchObject({
      kind: 'same_size_split_view',
    })
    const incidentId = incidentList.incidents[0]?.incident_id
    expect(incidentId).toMatch(/^sha256:[0-9a-f]{64}$/)
    const incidentResponse = await fetch(
      `${witness.url}/v1/incidents/${incidentId?.slice('sha256:'.length)}`,
    )
    expect(incidentResponse.status).toBe(200)
    expect(incidentResponse.headers.get('cache-control')).toContain('immutable')
  })
})

interface FixtureLog {
  url: string
  hashes: Uint8Array[]
}

async function startFixtureLog(initialHashes: Uint8Array[]): Promise<FixtureLog> {
  const fixture = { hashes: [...initialHashes] }
  const server = createServer((request, response) => {
    void routeFixture(request.url ?? '/').catch((error: unknown) => {
      response.statusCode = 500
      response.end(error instanceof Error ? error.message : String(error))
    })

    async function routeFixture(path: string): Promise<void> {
      if (path === '/v1/checkpoint') {
        const note = await signedCheckpoint(fixture.hashes)
        response.statusCode = 200
        response.setHeader('content-type', 'text/plain')
        response.end(note)
        return
      }
      const tile = path.match(/^\/v1\/tile\/0\/000(?:\.p\/(\d+))?$/)
      if (tile) {
        const width = tile[1] ? Number(tile[1]) : 256
        if (width > fixture.hashes.length) {
          response.statusCode = 404
          response.end()
          return
        }
        response.statusCode = 200
        response.setHeader('content-type', 'application/octet-stream')
        response.end(Buffer.concat(fixture.hashes.slice(0, width).map((hash) => Buffer.from(hash))))
        return
      }
      response.statusCode = 404
      response.end()
    }
  })
  await listen(server)
  closers.push(() => close(server))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('fixture log did not bind')
  return { url: `http://127.0.0.1:${address.port}`, hashes: fixture.hashes }
}

async function signedCheckpoint(hashes: Uint8Array[]): Promise<string> {
  const root = checkpointRootFromLeafHashes(hashes)
  const body = `${LOG_NAME}\n${hashes.length}\n${Buffer.from(root).toString('base64')}\n`
  const signature = await ed.signAsync(new TextEncoder().encode(body), LOG_SEED)
  const payload = Buffer.concat([
    Buffer.from(checkpointKeyId(LOG_NAME, logPublicKey)),
    Buffer.from(signature),
  ])
  return `${body}\n\u2014 ${LOG_NAME} ${payload.toString('base64')}\n`
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
}
