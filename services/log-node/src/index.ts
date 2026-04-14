export {
  serializeEntry,
  ENTRY_VERSION,
  ENTRY_SIZE,
  EVENT_TYPE_TOOL_CALL,
  EVENT_TYPE_TRANSACTION,
  type EntryInput,
} from './entry.js';

export { createMerkleTree } from './tree.js';
export type { MerkleTree } from './tree.js';

export { createCheckpointSigner, formatCheckpointBody, parseCheckpointBody } from './checkpoint.js';
export type { CheckpointSigner } from './checkpoint.js';

export { bindServer } from './server.js';
export type { ServerHandle, ProofBundle } from './server.js';

import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';
import { createMerkleTree } from './tree.js';
import { createCheckpointSigner } from './checkpoint.js';
import { bindServer } from './server.js';

// Set up sync sha512 for @noble/ed25519 (safe to call multiple times)
ed.etc.sha512Sync = (...m: Uint8Array[]) => sha512(ed.etc.concatBytes(...m));

export interface LogServerOptions {
  port?: number;
  logPrivateKey?: Uint8Array;
}

export interface LogServer {
  readonly url: string;
  readonly logPublicKey: Uint8Array;
  close(): Promise<void>;
}

const LOG_ORIGIN = 'log.atrib.io/v1';

/**
 * Start a production log HTTP server.
 *
 * Generates or accepts an Ed25519 keypair for checkpoint signing, creates the
 * Merkle tree and checkpoint signer, binds the HTTP server, and returns the
 * server's URL, public key, and a close() function.
 */
export async function startLogServer(options?: LogServerOptions): Promise<LogServer> {
  const port = options?.port ?? 0;

  // Generate or use provided private key
  let privateKey: Uint8Array;
  if (options?.logPrivateKey !== undefined) {
    privateKey = options.logPrivateKey;
  } else {
    privateKey = ed.utils.randomPrivateKey();
  }

  const publicKey = await ed.getPublicKeyAsync(privateKey);

  const tree = createMerkleTree();
  const signer = createCheckpointSigner(privateKey, publicKey, LOG_ORIGIN);
  const handle = await bindServer(tree, signer, port);

  return {
    get url() { return handle.url; },
    get logPublicKey() { return publicKey; },
    close: handle.close.bind(handle),
  };
}
