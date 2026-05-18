// SPDX-License-Identifier: Apache-2.0

export {
  serializeEntry,
  ENTRY_VERSION,
  ENTRY_SIZE,
  EVENT_TYPE_TOOL_CALL,
  EVENT_TYPE_TRANSACTION,
  type EntryInput,
} from './entry.js'

export { createMerkleTree } from './tree.js'
export type { MerkleTree } from './tree.js'

export {
  createCheckpointSigner,
  formatCheckpointBody,
  parseCheckpointBody,
  parseSignatureLine,
  formatVkey,
} from './checkpoint.js'
export type { CheckpointSigner, ParsedSignatureLine } from './checkpoint.js'

export { bindServer } from './server.js'
export type { ServerHandle } from './server.js'
export type { ProofBundle } from '@atrib/mcp'

import * as ed from '@noble/ed25519'
import { sha512 } from '@noble/hashes/sha2.js'
import { createMerkleTree } from './tree.js'
import { createCheckpointSigner } from './checkpoint.js'
import { bindServer } from './server.js'

// Set up sha512 for @noble/ed25519 (safe to call multiple times)
ed.hashes.sha512 = sha512

export interface LogServerOptions {
  port?: number
  host?: string
  logPrivateKey?: Uint8Array
  /**
   * Path to an append-only entries file. When set, the tree restores from
   * this file on startup and persists every append to it. Critical for
   * surviving Fly redeploys. Without this, the tree resets to size 0 every
   * time the process starts.
   */
  persistencePath?: string
  /**
   * If set, log-node fire-and-forget POSTs every successfully-submitted
   * record to this URL after the local commit completes. Intended for
   * graph-node's /v1/ingest endpoint so the derived graph stays in sync
   * with the source-of-truth log without operator coordination.
   *
   * The fanout never blocks the response or causes a submit to fail; the
   * log is the source of truth and the graph is a derived view.
   * Failures are logged with the `atrib-log: graph fanout` prefix.
   */
  graphFanoutEndpoint?: string
}

export interface LogServer {
  readonly url: string
  readonly logPublicKey: Uint8Array
  close(): Promise<void>
}

const LOG_ORIGIN = 'log.atrib.dev/v1'

/**
 * Start a production log HTTP server.
 *
 * Generates or accepts an Ed25519 keypair for checkpoint signing, creates the
 * Merkle tree and checkpoint signer, binds the HTTP server, and returns the
 * server's URL, public key, and a close() function.
 */
export async function startLogServer(options?: LogServerOptions): Promise<LogServer> {
  const port = options?.port ?? 0

  // Generate or use provided private key
  // IMPORTANT: In production, provide a persistent keypair via logPrivateKey option.
  // A random key means checkpoint signatures change on every restart, invalidating
  // all previously issued inclusion proofs.
  let privateKey: Uint8Array
  if (options?.logPrivateKey !== undefined) {
    privateKey = options.logPrivateKey
  } else {
    privateKey = ed.utils.randomSecretKey()
  }

  const publicKey = await ed.getPublicKeyAsync(privateKey)

  const treeOptions = options?.persistencePath
    ? { persistencePath: options.persistencePath }
    : undefined
  const tree = createMerkleTree(treeOptions)
  const signer = createCheckpointSigner(privateKey, publicKey, LOG_ORIGIN)
  // Note: privateKey remains in memory for the signer's lifetime (the signer
  // captures it in a closure for checkpoint signing). This is intentional.
  // the key must be available for the process lifetime. JavaScript does not
  // support reliable key zeroing (GC is non-deterministic). If memory-dump
  // resistance is ever required, consider a native HSM integration.
  const handle = await bindServer(tree, signer, port, options?.host, options?.graphFanoutEndpoint)

  return {
    get url() {
      return handle.url
    },
    get logPublicKey() {
      return publicKey
    },
    close: handle.close.bind(handle),
  }
}
