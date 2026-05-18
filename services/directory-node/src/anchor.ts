// directory-node anchor emission
//
// Per spec §6.2.4: every successful directory publish triggers an Ed25519-signed
// `directory_anchor` record submitted to the configured atrib log endpoint.
// The anchor commits the directory's checkpoint root + epoch + origin to the
// log; verifiers fetch the latest anchor in §6.3 step 1.

import { sha256 } from '@noble/hashes/sha2.js'
import * as ed25519 from '@noble/ed25519'
import canonicalize from 'canonicalize'

export interface AnchorEmissionInput {
  logEndpoint: string
  directoryOrigin: string
  operatorPrivateKey: Uint8Array
  epoch: number
  rootHash: string
}

export interface AnchorEmissionResult {
  record_hash?: string
  submitted: boolean
  error?: string
  /**
   * The full signed anchor record, returned to callers so the directory
   * can persist a body-history map for §6.3 step 1 verifiers (until the
   * §2.12 record-body archive layer ships and supersedes per-producer
   * body retrieval; D070 placeholder ADR).
   *
   * Shape mirrors AtribRecord: every field that goes into the canonical
   * signed bytes plus the `signature` itself.
   */
  record?: AnchorRecord
}

/**
 * Signed `directory_anchor` record body. Shape matches the canonical
 * AtribRecord with the directory_anchor-specific `metadata` payload.
 *
 * Verifiers (§6.3 step 1) read `metadata.directory_root` +
 * `metadata.directory_epoch` to cross-check against the directory's
 * `/v6/anchor` self-report. The full body also lets verifiers
 * re-canonicalize and re-verify the signature against the operator's
 * pubkey (defense-in-depth beyond log inclusion).
 */
export interface AnchorRecord {
  chain_root: string
  content_id: string
  context_id: string
  creator_key: string
  event_type: 'https://atrib.dev/v1/types/directory_anchor'
  metadata: {
    directory_origin: string
    directory_root: string
    directory_epoch: number
  }
  spec_version: 'atrib/1.0'
  timestamp: number
  signature: string
}

const ENCODER = new TextEncoder()

/**
 * Build, sign, and submit a `directory_anchor` record per spec §6.2.4.
 *
 * The record uses the atrib normative event_type URI for directory anchors,
 * carries the directory's epoch + root_hash in the metadata, and is signed
 * by the operator's Ed25519 key. Submission errors are caught and surfaced
 * (per §5.8 degradation contract: directory publish never blocks on
 * anchoring failure).
 */
export async function emitDirectoryAnchor(input: AnchorEmissionInput): Promise<AnchorEmissionResult> {
  const operatorPubBytes = await ed25519.getPublicKeyAsync(input.operatorPrivateKey)
  const operatorPub = Buffer.from(operatorPubBytes).toString('base64url').replace(/=+$/, '')

  // Reserved context_id for the directory's own anchoring chain.
  // Derived deterministically from the directory origin so multiple replicas
  // produce the same chain.
  const originHash = sha256(ENCODER.encode(input.directoryOrigin))
  const contextId = Buffer.from(originHash).toString('hex').slice(0, 32)

  // chain_root for genesis: SHA-256(UTF-8(context_id)) per spec §1.2.3.
  const chainRoot = `sha256:${Buffer.from(sha256(ENCODER.encode(contextId))).toString('hex')}`

  // content_id derives from the directory origin per §1.2.2 server-URL pattern.
  const contentInput = `${input.directoryOrigin}:directory_anchor`
  const contentId = `sha256:${Buffer.from(sha256(ENCODER.encode(contentInput))).toString('hex')}`

  const unsigned = {
    chain_root: chainRoot,
    content_id: contentId,
    context_id: contextId,
    creator_key: operatorPub,
    event_type: 'https://atrib.dev/v1/types/directory_anchor',
    metadata: {
      directory_origin: input.directoryOrigin,
      directory_root: input.rootHash,
      directory_epoch: input.epoch,
    },
    spec_version: 'atrib/1.0',
    timestamp: Date.now(),
  }
  const canonical = canonicalize(unsigned) ?? JSON.stringify(unsigned)
  const sigBytes = await ed25519.signAsync(ENCODER.encode(canonical), input.operatorPrivateKey)
  const signature = Buffer.from(sigBytes).toString('base64url').replace(/=+$/, '')
  const record = { ...unsigned, signature }

  // Compute record_hash for the response (callers may want to reference the anchor).
  const completeCanonical = canonicalize(record) ?? JSON.stringify(record)
  const recordHash = `sha256:${Buffer.from(sha256(ENCODER.encode(completeCanonical))).toString('hex')}`

  // Submit to log. Failures are caught per §5.8 degradation contract.
  try {
    const submitUrl = `${input.logEndpoint.replace(/\/$/, '')}/entries`
    const response = await fetch(submitUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record),
    })
    if (!response.ok) {
      const errBody = await response.text().catch(() => '')
      return { record_hash: recordHash, submitted: false, error: `log returned ${response.status}: ${errBody.slice(0, 200)}`, record: record as AnchorRecord }
    }
    return { record_hash: recordHash, submitted: true, record: record as AnchorRecord }
  } catch (e) {
    return { record_hash: recordHash, submitted: false, error: e instanceof Error ? e.message : String(e), record: record as AnchorRecord }
  }
}
