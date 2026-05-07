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

import {
  DirectoryHandle,
  verify_lookup_proof as wasmVerifyLookupProof,
  verify_audit_proof as wasmVerifyAuditProof,
  vrf_public_key as wasmVrfPublicKey,
} from '../wasm/atrib_directory_bridge.js'
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
    // wasm-bindgen 0.2.120 deprecated async-typed constructors but still
    // returns a Promise at runtime for our async `new()`. Cast through
    // unknown so the await keeps working until the upstream API shifts.
    const handle = await (new DirectoryHandle() as unknown as Promise<DirectoryHandle>)
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

// =============================================================================
// Verifier-side primitives (§6.3 steps 5 + 7).
// =============================================================================
//
// These are stateless free functions — verifiers don't need an
// `AtribDirectory` instance (they have no directory state to maintain).
// A consumer fetches a serialized proof from the directory's HTTP API
// (`GET /v6/lookup/:key` returns base64url-encoded bincode for both the
// proof and the lookup result; same for `GET /v6/audit-proof`), fetches
// the anchored root from the tlog (`directory_anchor` records), and
// calls these to validate.

/** Inputs to verifyLookupProof — keyword-arg style for clarity. */
export interface VerifyLookupProofInput {
  /** Operator's VRF public key (32 bytes). For the reference HardCodedAkdVRF use {@link directoryVrfPublicKey}. */
  vrfPublicKey: Uint8Array
  /** Anchored root hash at the proof's epoch (32 bytes), captured from a `directory_anchor` log entry. */
  rootHash: Uint8Array
  /** Current directory epoch as advertised at the time the proof was generated. */
  currentEpoch: number
  /** Looked-up label (the `creator_key` queried). */
  label: string
  /** Bincode-serialized lookup proof bytes from `GET /v6/lookup/:key`. */
  proof: Uint8Array
}

/**
 * Verify an AKD lookup proof against a known anchored root.
 *
 * Per spec §6.3 step 7. Returns `true` for a valid proof, `false` for a
 * proof that decodes correctly but fails verification. Throws only on
 * malformed input (wrong byte length, undeserializable bincode).
 *
 * Synchronous — `lookup_verify` is a pure function with no I/O.
 */
export function verifyLookupProof(input: VerifyLookupProofInput): boolean {
  if (input.rootHash.length !== 32) {
    throw new Error(`rootHash must be 32 bytes (got ${input.rootHash.length})`)
  }
  if (input.vrfPublicKey.length !== 32) {
    throw new Error(`vrfPublicKey must be 32 bytes (got ${input.vrfPublicKey.length})`)
  }
  return wasmVerifyLookupProof(
    input.vrfPublicKey,
    input.rootHash,
    BigInt(input.currentEpoch),
    input.label,
    input.proof,
  )
}

/** Inputs to verifyAuditProof. */
export interface VerifyAuditProofInput {
  /**
   * Sequence of 32-byte root hashes captured at each anchored checkpoint
   * from the proof's start epoch through its end epoch, in order. For
   * an audit proof from epoch `e` to epoch `f`, this array has `f - e + 1`
   * entries (one per epoch boundary).
   */
  rootHashes: Uint8Array[]
  /** Bincode-serialized append-only proof bytes from `GET /v6/audit-proof`. */
  proof: Uint8Array
}

/**
 * Verify an AKD audit (append-only consistency) proof.
 *
 * Per spec §6.3 step 5. Returns `true` for a valid proof, `false` for a
 * proof that decodes correctly but fails verification. Throws only on
 * malformed input.
 *
 * Async — wraps the underlying audit_verify which is async for hash
 * recomputation reasons (no I/O).
 */
export async function verifyAuditProof(input: VerifyAuditProofInput): Promise<boolean> {
  if (input.rootHashes.length === 0) {
    throw new Error('rootHashes must be non-empty')
  }
  for (const [i, h] of input.rootHashes.entries()) {
    if (h.length !== 32) {
      throw new Error(`rootHashes[${i}] must be 32 bytes (got ${h.length})`)
    }
  }
  // Concatenate into the byte buffer the bridge expects.
  const concat = new Uint8Array(input.rootHashes.length * 32)
  for (const [i, h] of input.rootHashes.entries()) {
    concat.set(h, i * 32)
  }
  return await wasmVerifyAuditProof(concat, input.proof)
}

/**
 * Return the VRF public key for the bridge's reference HardCodedAkdVRF.
 *
 * This is the operator's VRF public key for an in-process atrib
 * directory created via {@link AtribDirectory.create}. Production
 * directories that swap the VRF backend MUST publish their own VRF
 * pubkey out of band (e.g., as a field on the directory's identity
 * claim) and pass it to {@link verifyLookupProof} directly.
 *
 * Returns the 32-byte VRF public key.
 */
export async function directoryVrfPublicKey(): Promise<Uint8Array> {
  return await wasmVrfPublicKey()
}
