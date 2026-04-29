// @atrib/directory — AKD-backed identity-claim directory SDK
//
// Implements spec §6 publish/lookup/history/proveAbsence operations as
// thin TypeScript wrappers over the Rust→WASM bridge in
// packages/directory-bridge. Plus the per-operation anchoring helpers
// that callers use to emit `directory_anchor` records to the tlog
// (§6.2.4).
//
// Per D034 / the WASM-vs-NAPI benchmark dated 2026-04-29: this package
// ships the WASM bridge inline. No platform-specific binaries.
//
// Trust posture: per spec §6.3 + §8.7, the directory returns CLAIMS,
// not facts. Verifiers cross-check against the anchored checkpoint root
// from the tlog and surface signals; consumers decide policy.

import * as ed25519 from '@noble/ed25519'
import canonicalize from 'canonicalize'

import { DirectoryHandle } from '../wasm/atrib_directory_bridge.js'
import type {
  IdentityClaim,
  LookupResult,
  HistoryResult,
  HistoryEntry,
  DirectorySnapshot,
  DirectoryIdentity,
  CapabilityEnvelope,
  ClaimMethod,
} from './types.js'

export type {
  IdentityClaim,
  LookupResult,
  HistoryResult,
  HistoryEntry,
  DirectorySnapshot,
  DirectoryIdentity,
  CapabilityEnvelope,
  ClaimMethod,
}

const ENCODER = new TextEncoder()

/** Deserialize a hex-encoded claim payload back into an IdentityClaim.
 *  The bridge returns AKD value bytes hex-encoded; we decode hex → UTF-8 → JSON. */
function decodeClaim(valueHex: string): IdentityClaim {
  const bytes = Buffer.from(valueHex, 'hex')
  const text = bytes.toString('utf8')
  return JSON.parse(text) as IdentityClaim
}

/** Encode a claim as the AKD value: canonical JSON string, sent as UTF-8.
 *  The bridge converts the JS string to a Rust String and stores its UTF-8 bytes
 *  via AkdValue::from(&str). On lookup, the bridge hex-encodes the stored bytes
 *  for transport across the WASM boundary. So we pass canonical JSON as a string here. */
function encodeClaim(claim: IdentityClaim): string {
  return canonicalize(claim) ?? JSON.stringify(claim)
}

/** Compute the canonical signing input for an identity claim (§6.1). */
function claimSigningInput(claim: IdentityClaim): Uint8Array {
  const withoutSig = { ...claim, signature: '' }
  const canonical = canonicalize(withoutSig) ?? JSON.stringify(withoutSig)
  return ENCODER.encode(canonical)
}

/** Sign an identity claim with the operator's Ed25519 key. */
export async function signClaim(unsigned: Omit<IdentityClaim, 'signature'>, privateKey: Uint8Array): Promise<IdentityClaim> {
  const claim: IdentityClaim = { ...unsigned, signature: '' }
  const input = claimSigningInput(claim)
  const sig = await ed25519.signAsync(input, privateKey)
  claim.signature = Buffer.from(sig).toString('base64url').replace(/=+$/, '')
  return claim
}

/** Verify an identity claim's signature. */
export async function verifyClaimSignature(claim: IdentityClaim): Promise<boolean> {
  try {
    const input = claimSigningInput(claim)
    const sig = Buffer.from(claim.signature.padEnd(claim.signature.length + (4 - (claim.signature.length % 4)) % 4, '='), 'base64url')
    const pubKey = Buffer.from(claim.creator_key.padEnd(claim.creator_key.length + (4 - (claim.creator_key.length % 4)) % 4, '='), 'base64url')
    return await ed25519.verifyAsync(sig, input, pubKey)
  } catch {
    return false
  }
}

/**
 * In-process atrib directory client.
 *
 * Owns a single AKD handle. Production deployments embed this inside
 * services/directory-node, exposing the operations over an HTTP API
 * (§6.2). Tests and demos use the in-memory client directly.
 *
 * Per D034 §3.1: backed by Meta's `akd` crate via WASM bridge.
 */
export class AtribDirectory {
  private inner: DirectoryHandle
  private operatorKey: Uint8Array | null

  private constructor(inner: DirectoryHandle, operatorKey: Uint8Array | null) {
    this.inner = inner
    this.operatorKey = operatorKey
  }

  /**
   * Create a new empty directory.
   *
   * @param operatorPrivateKey  Optional Ed25519 32-byte seed for signing
   *   identity claims emitted via this client. When absent, the client
   *   can still publish externally-signed claims via {@link publishSigned}.
   */
  static async create(operatorPrivateKey?: Uint8Array): Promise<AtribDirectory> {
    const handle = await new DirectoryHandle()
    return new AtribDirectory(handle, operatorPrivateKey ?? null)
  }

  /**
   * Publish a single (already-signed) claim under its `creator_key`.
   *
   * Per spec §6.2.4, callers SHOULD invoke `currentSnapshot()` afterwards
   * and emit a `directory_anchor` record to the tlog with the resulting
   * root hash. The atrib reference implementation does this automatically;
   * external operators wiring their own anchoring path call this method
   * directly.
   */
  async publishSigned(claim: IdentityClaim): Promise<{ epoch: number }> {
    if (!claim.signature) {
      throw new Error('claim is unsigned; sign with signClaim() before publishing')
    }
    const labels = [claim.creator_key]
    const values = [encodeClaim(claim)]
    const epoch = await this.inner.publish_batch(labels, values)
    return { epoch: Number(epoch) }
  }

  /**
   * Sign a claim with the operator's configured private key and publish it.
   *
   * Convenience for the common case where the directory operator and the
   * claim signer are the same party. Errors if the directory was created
   * without an operator key.
   */
  async publishAndSign(unsigned: Omit<IdentityClaim, 'signature'>): Promise<IdentityClaim & { epoch: number }> {
    if (!this.operatorKey) {
      throw new Error('directory has no operator key configured; use publishSigned() instead')
    }
    const signed = await signClaim(unsigned, this.operatorKey)
    const { epoch } = await this.publishSigned(signed)
    return { ...signed, epoch }
  }

  /**
   * Look up a `creator_key` and return the active claim with a verifiable
   * AKD lookup proof.
   *
   * Returns `claim: null` for verified non-membership (the key has never
   * been registered). The proof is valid in both cases; verifiers
   * distinguish membership from non-membership by checking the proof type.
   */
  async lookup(creatorKey: string): Promise<LookupResult> {
    const result = await this.inner.lookup(creatorKey) as { value: string; version: number; proof: Uint8Array } | null
    if (!result) {
      return { claim: null, version: null, proof: new Uint8Array() }
    }
    return {
      claim: decodeClaim(result.value),
      version: Number(result.version),
      proof: result.proof,
    }
  }

  /**
   * Return the full version chain for a `creator_key` (initial publication +
   * all rotations + revocations).
   */
  async history(creatorKey: string): Promise<HistoryResult> {
    const result = await this.inner.history(creatorKey) as {
      versions: { value: string; version: number; epoch: number }[]
      proof: Uint8Array
    }
    const versions: HistoryEntry[] = result.versions.map(v => ({
      claim: decodeClaim(v.value),
      version: Number(v.version),
      epoch: Number(v.epoch),
    }))
    return { versions, proof: result.proof }
  }

  /**
   * Snapshot the directory's current anchored state. Used to emit
   * `directory_anchor` records to the tlog per §6.2.4.
   */
  async currentSnapshot(): Promise<DirectorySnapshot> {
    const epoch = await this.inner.current_epoch()
    const root_hash = await this.inner.current_root()
    return { epoch: Number(epoch), root_hash }
  }

  /**
   * Generate an audit proof between two epochs (append-only consistency
   * proof). Verifiers use this in §6.3 step 5 to confirm the directory
   * has not rolled back between two anchored checkpoints.
   */
  async auditProof(fromEpoch: number, toEpoch: number): Promise<Uint8Array> {
    return this.inner.audit_proof(BigInt(fromEpoch), BigInt(toEpoch))
  }
}
