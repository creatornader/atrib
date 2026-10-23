import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createServer, type Server, type Socket } from 'node:net'
import { chownSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSignerSocket, signerSocketFromEnv } from '../src/signer-socket.js'
import { getPublicKey, signRecord, verifyRecord } from '../src/signing.js'
import { base64urlEncode } from '../src/base64url.js'
import type { AtribRecord } from '../src/types.js'

const brokerKey = new Uint8Array(32).fill(7)
const otherKey = new Uint8Array(32).fill(8)

type Handler = (
  request: { op: string; identity: string; record: AtribRecord },
  socket: Socket,
) => void

let dir: string
let socketPath: string
let server: Server | undefined

async function startBroker(handler: Handler): Promise<void> {
  server = createServer((socket) => {
    let text = ''
    socket.on('data', (chunk) => {
      text += chunk.toString('utf-8')
      const newline = text.indexOf('\n')
      if (newline !== -1) handler(JSON.parse(text.slice(0, newline)), socket)
    })
  })
  await new Promise<void>((resolve) => server!.listen(socketPath, resolve))
}

/** A broker that signs only for the claude-code identity, like a policy-checking host signer. */
function policyBroker(key: Uint8Array): Handler {
  return (request, socket) => {
    if (request.op !== 'sign' || request.identity !== 'claude-code') {
      socket.end(`${JSON.stringify({ v: 1, ok: false, error: 'identity not allowed' })}\n`)
      return
    }
    void signRecord(request.record, key).then((signed) => {
      socket.end(`${JSON.stringify({ v: 1, ok: true, signature: signed.signature })}\n`)
    })
  }
}

async function unsignedRecord(key: Uint8Array): Promise<AtribRecord> {
  return {
    spec_version: 'atrib/1.0',
    content_id: 'sha256:3f8a2b0000000000000000000000000000000000000000000000000000000000',
    creator_key: base64urlEncode(await getPublicKey(key)),
    chain_root: 'sha256:7e1f4a0000000000000000000000000000000000000000000000000000000000',
    event_type: 'https://atrib.dev/v1/types/observation',
    context_id: '4bf92f3577b34da6a3ce929d0e0e4736',
    timestamp: 1743850000000,
    signature: '',
  } as AtribRecord
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'atrib-signer-'))
  socketPath = join(dir, 'signer.sock')
})

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()))
  server = undefined
  rmSync(dir, { recursive: true, force: true })
})

describe('signer socket client', () => {
  it('returns a record byte-identical to in-process signRecord', async () => {
    await startBroker(policyBroker(brokerKey))
    const record = await unsignedRecord(brokerKey)
    const signer = createSignerSocket({
      socketPath,
      creatorKey: record.creator_key,
      identity: 'claude-code',
      allowSameOwner: true,
    })
    const viaSocket = await signer.signRecord(record)
    const inProcess = await signRecord(record, brokerKey)
    expect(viaSocket).toEqual(inProcess)
    expect(await verifyRecord(viaSocket)).toBe(true)
  })

  it("passes the signer's refusal through", async () => {
    await startBroker(policyBroker(brokerKey))
    const record = await unsignedRecord(brokerKey)
    const signer = createSignerSocket({
      socketPath,
      creatorKey: record.creator_key,
      identity: 'scheduled-job',
      allowSameOwner: true,
    })
    await expect(signer.signRecord(record)).rejects.toThrow('signer refused: identity not allowed')
  })

  it('rejects a signature that does not verify under the pinned key', async () => {
    await startBroker(policyBroker(otherKey))
    const record = await unsignedRecord(brokerKey)
    const signer = createSignerSocket({
      socketPath,
      creatorKey: record.creator_key,
      identity: 'claude-code',
      allowSameOwner: true,
    })
    await expect(signer.signRecord(record)).rejects.toThrow('does not verify under the pinned key')
  })

  it('rejects a record whose creator_key is not the pinned key, without contacting the signer', async () => {
    const record = await unsignedRecord(otherKey)
    const signer = createSignerSocket({
      socketPath,
      creatorKey: base64urlEncode(await getPublicKey(brokerKey)),
      identity: 'claude-code',
      allowSameOwner: true,
    })
    await expect(signer.signRecord(record)).rejects.toThrow('does not match the pinned signer key')
  })

  it('times out instead of hanging when the signer never answers', async () => {
    await startBroker(() => {})
    const record = await unsignedRecord(brokerKey)
    const signer = createSignerSocket({
      socketPath,
      creatorKey: record.creator_key,
      identity: 'claude-code',
      timeoutMs: 100,
      allowSameOwner: true,
    })
    const started = Date.now()
    await expect(signer.signRecord(record)).rejects.toThrow('timed out after 100ms')
    expect(Date.now() - started).toBeLessThan(1000)
  })

  it('fails fast when the socket does not exist', async () => {
    const record = await unsignedRecord(brokerKey)
    const signer = createSignerSocket({
      socketPath,
      creatorKey: record.creator_key,
      identity: 'claude-code',
      allowSameOwner: true,
    })
    await expect(signer.signRecord(record)).rejects.toThrow('atrib: signer socket')
  })

  it.skipIf(typeof process.getuid !== 'function' || process.getuid() === 0)(
    'refuses a socket owned by the calling user unless allowed',
    async () => {
      await startBroker(policyBroker(brokerKey))
      const record = await unsignedRecord(brokerKey)
      const signer = createSignerSocket({
        socketPath,
        creatorKey: record.creator_key,
        identity: 'claude-code',
      })
      await expect(signer.signRecord(record)).rejects.toThrow('owned by the calling user')
    },
  )

  it.skipIf(typeof process.getuid !== 'function' || process.getuid() !== 0)(
    'accepts a socket that belongs to a different account',
    async () => {
      await startBroker(policyBroker(brokerKey))
      chownSync(dir, 1, 1)
      chownSync(socketPath, 1, 1)
      const record = await unsignedRecord(brokerKey)
      const signer = createSignerSocket({
        socketPath,
        creatorKey: record.creator_key,
        identity: 'claude-code',
      })
      expect(await verifyRecord(await signer.signRecord(record))).toBe(true)
      chownSync(dir, 0, 0)
    },
  )

  it('refuses transaction records', async () => {
    const record = {
      ...(await unsignedRecord(brokerKey)),
      event_type: 'https://atrib.dev/v1/types/transaction',
    } as AtribRecord
    const signer = createSignerSocket({
      socketPath,
      creatorKey: record.creator_key,
      identity: 'claude-code',
      allowSameOwner: true,
    })
    await expect(signer.signRecord(record)).rejects.toThrow('does not sign transaction records')
  })
})

describe('signerSocketFromEnv', () => {
  it('returns null when ATRIB_SIGNER_SOCK is unset', () => {
    expect(signerSocketFromEnv({})).toBeNull()
  })

  it('throws when the socket is set without a pinned key', () => {
    expect(() => signerSocketFromEnv({ ATRIB_SIGNER_SOCK: '/tmp/x.sock' })).toThrow(
      'ATRIB_SIGNER_PUBKEY is not',
    )
  })

  it('reads the identity from ATRIB_SIGNER_IDENTITY, then ATRIB_AGENT', async () => {
    const creatorKey = base64urlEncode(await getPublicKey(brokerKey))
    const base = { ATRIB_SIGNER_SOCK: '/tmp/x.sock', ATRIB_SIGNER_PUBKEY: creatorKey }
    expect(signerSocketFromEnv({ ...base, ATRIB_AGENT: 'codex' })?.identity).toBe('codex')
    expect(
      signerSocketFromEnv({ ...base, ATRIB_AGENT: 'codex', ATRIB_SIGNER_IDENTITY: 'job-runner' })
        ?.identity,
    ).toBe('job-runner')
    expect(signerSocketFromEnv(base)?.identity).toBe('claude-code')
  })

  it('throws on a pinned key that is not 32 bytes', () => {
    expect(() =>
      signerSocketFromEnv({ ATRIB_SIGNER_SOCK: '/tmp/x.sock', ATRIB_SIGNER_PUBKEY: 'AAAA' }),
    ).toThrow('32 bytes')
  })
})
