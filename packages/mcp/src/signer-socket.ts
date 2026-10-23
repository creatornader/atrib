// SPDX-License-Identifier: Apache-2.0

/**
 * Local signer socket client (D190, a D102 host signer over a Unix socket).
 *
 * A producer that uses this client never holds the Ed25519 seed. It builds
 * the unsigned record with the pinned creator_key, sends it to a host-owned
 * signer process over a Unix socket, and accepts the returned signature only
 * if it verifies under the pinned key. The signer can apply its own policy
 * (which identities a caller may use, rate limits, an audit log) before it
 * signs.
 *
 * Wire format: one newline-terminated JSON request per connection, answered
 * by one newline-terminated JSON response.
 *
 *   request:  {"v":1,"op":"sign","identity":"<name>","record":{...,"signature":""}}
 *   response: {"v":1,"ok":true,"signature":"<base64url>"}
 *             {"v":1,"ok":false,"error":"<reason>"}
 *
 * Configuration comes from the environment through `signerSocketFromEnv`:
 *
 *   ATRIB_SIGNER_SOCK        socket path. When set, it is the only key source.
 *   ATRIB_SIGNER_PUBKEY      pinned creator_key (base64url). Required.
 *   ATRIB_SIGNER_IDENTITY    identity requested from the signer. Defaults to
 *                            ATRIB_AGENT, then 'claude-code'.
 *   ATRIB_SIGNER_TIMEOUT_MS  bound on one request, connect included. Default 500.
 *
 * Producers that resolve keys MUST treat a set ATRIB_SIGNER_SOCK as final:
 * no fallback to env, file, Keychain, or 1Password seeds, so a leftover seed
 * can never silently fork the identity.
 */

import { connect } from 'node:net'
import { statSync } from 'node:fs'
import { dirname } from 'node:path'
import { base64urlDecode } from './base64url.js'
import { verifyRecord } from './signing.js'
import type { AtribRecord } from './types.js'

export const ATRIB_SIGNER_SOCK_ENV = 'ATRIB_SIGNER_SOCK'
export const ATRIB_SIGNER_PUBKEY_ENV = 'ATRIB_SIGNER_PUBKEY'
export const ATRIB_SIGNER_IDENTITY_ENV = 'ATRIB_SIGNER_IDENTITY'
export const ATRIB_SIGNER_TIMEOUT_MS_ENV = 'ATRIB_SIGNER_TIMEOUT_MS'

const DEFAULT_TIMEOUT_MS = 500
const MAX_RESPONSE_BYTES = 64 * 1024
const TRANSACTION_EVENT_TYPE = 'https://atrib.dev/v1/types/transaction'

/** A signer that holds the key outside the calling process. */
export interface RecordSigner {
  readonly source: 'signer-socket'
  readonly socketPath: string
  readonly identity: string
  /** Pinned creator_key (base64url). Producers put this in the record before signing. */
  readonly creatorKey: string
  /** Sign a record whose creator_key equals `creatorKey`. Rejects unless the signature verifies. */
  signRecord(record: AtribRecord): Promise<AtribRecord>
}

export interface SignerSocketOptions {
  socketPath: string
  /** Pinned creator_key (base64url, 32 bytes). */
  creatorKey: string
  identity: string
  timeoutMs?: number
  /**
   * Accept a socket, or a socket directory, owned by the calling user. Off by
   * default: a same-user socket can be planted by any process running as that
   * user. Tests and single-user development set this.
   */
  allowSameOwner?: boolean
}

/**
 * Build a signer from the environment. Returns null when ATRIB_SIGNER_SOCK is
 * unset. Throws when it is set but the rest of the configuration is missing or
 * invalid, so callers fail closed instead of falling back to a seed.
 */
export function signerSocketFromEnv(
  env: Record<string, string | undefined> = process.env,
): RecordSigner | null {
  const socketPath = env[ATRIB_SIGNER_SOCK_ENV]
  if (socketPath === undefined || socketPath === '') return null
  const creatorKey = env[ATRIB_SIGNER_PUBKEY_ENV]
  if (creatorKey === undefined || creatorKey === '') {
    throw new Error(
      `atrib: ${ATRIB_SIGNER_SOCK_ENV} is set but ${ATRIB_SIGNER_PUBKEY_ENV} is not; refusing to sign without a pinned key`,
    )
  }
  const identity = env[ATRIB_SIGNER_IDENTITY_ENV] || env['ATRIB_AGENT'] || 'claude-code'
  const rawTimeout = env[ATRIB_SIGNER_TIMEOUT_MS_ENV]
  const timeoutMs = rawTimeout ? Number(rawTimeout) : DEFAULT_TIMEOUT_MS
  return createSignerSocket({ socketPath, creatorKey, identity, timeoutMs })
}

export function createSignerSocket(options: SignerSocketOptions): RecordSigner {
  const pinned = options.creatorKey.trim()
  let pinnedBytes: Uint8Array
  try {
    pinnedBytes = base64urlDecode(pinned)
  } catch {
    throw new Error('atrib: signer socket creator key is not valid base64url')
  }
  if (pinnedBytes.length !== 32) {
    throw new Error('atrib: signer socket creator key must decode to 32 bytes')
  }
  const timeoutMs =
    Number.isFinite(options.timeoutMs) && (options.timeoutMs ?? 0) > 0
      ? (options.timeoutMs as number)
      : DEFAULT_TIMEOUT_MS
  const socketPath = options.socketPath
  const identity = options.identity
  const allowSameOwner = options.allowSameOwner === true

  return {
    source: 'signer-socket',
    socketPath,
    identity,
    creatorKey: pinned,
    async signRecord(record: AtribRecord): Promise<AtribRecord> {
      if (record.creator_key !== pinned) {
        throw new Error('atrib: record creator_key does not match the pinned signer key')
      }
      if (record.event_type === TRANSACTION_EVENT_TYPE) {
        throw new Error('atrib: the signer socket does not sign transaction records')
      }
      if (!allowSameOwner) checkSocketOwnership(socketPath)
      const unsigned = withoutUndefinedSessionToken({ ...record, signature: '' })
      const response = await request(
        socketPath,
        { v: 1, op: 'sign', identity, record: unsigned },
        timeoutMs,
      )
      if (response.ok !== true || typeof response.signature !== 'string') {
        const reason = typeof response.error === 'string' ? response.error : 'malformed response'
        throw new Error(`atrib: signer refused: ${reason}`)
      }
      const signed = { ...unsigned, signature: response.signature } as AtribRecord
      if (!(await verifyRecord(signed))) {
        throw new Error(
          'atrib: signer returned a signature that does not verify under the pinned key',
        )
      }
      return signed
    },
  }
}

function withoutUndefinedSessionToken(record: AtribRecord): AtribRecord {
  if ('session_token' in record && record.session_token === undefined) {
    const { session_token: _, ...rest } = record as AtribRecord & { session_token?: never }
    return rest as AtribRecord
  }
  return record
}

/**
 * Refuse a socket that the calling user could have planted: one owned by the
 * calling uid, or one in a directory the calling uid owns or anyone can write.
 */
function checkSocketOwnership(socketPath: string): void {
  if (typeof process.getuid !== 'function') return
  const uid = process.getuid()
  const sock = statSync(socketPath)
  const dir = statSync(dirname(socketPath))
  if (sock.uid === uid || dir.uid === uid) {
    throw new Error(
      'atrib: signer socket is owned by the calling user; it must belong to a separate signer account',
    )
  }
  if ((dir.mode & 0o002) !== 0) {
    throw new Error('atrib: signer socket directory is world-writable')
  }
}

interface SignerResponse {
  ok?: unknown
  signature?: unknown
  error?: unknown
}

function request(socketPath: string, body: unknown, timeoutMs: number): Promise<SignerResponse> {
  return new Promise((resolve, reject) => {
    const socket = connect({ path: socketPath })
    const decoder = new TextDecoder()
    let text = ''
    let size = 0
    let settled = false
    const finish = (error: Error | null, value?: SignerResponse): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      if (error) reject(error)
      else resolve(value as SignerResponse)
    }
    const timer = setTimeout(
      () => finish(new Error(`atrib: signer socket timed out after ${timeoutMs}ms`)),
      timeoutMs,
    )
    socket.on('connect', () => {
      socket.write(`${JSON.stringify(body)}\n`)
    })
    socket.on('data', (chunk: Uint8Array) => {
      size += chunk.length
      if (size > MAX_RESPONSE_BYTES) {
        finish(new Error('atrib: signer response too large'))
        return
      }
      text += decoder.decode(chunk, { stream: true })
      const newline = text.indexOf('\n')
      if (newline === -1) return
      try {
        const parsed: unknown = JSON.parse(text.slice(0, newline))
        if (typeof parsed !== 'object' || parsed === null) {
          finish(new Error('atrib: signer response is not an object'))
          return
        }
        finish(null, parsed as SignerResponse)
      } catch {
        finish(new Error('atrib: signer response is not JSON'))
      }
    })
    socket.on('error', (error: Error) =>
      finish(new Error(`atrib: signer socket: ${error.message}`)),
    )
    socket.on('end', () =>
      finish(new Error('atrib: signer closed the connection without answering')),
    )
  })
}
