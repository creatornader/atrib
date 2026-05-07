/* tslint:disable */
/* eslint-disable */

/**
 * In-process AKD directory handle. Holds a single in-memory database
 * instance and provides the publish/lookup/history/audit operations.
 *
 * Production deployments will typically replace `AsyncInMemoryDatabase`
 * with a persistent backend (e.g., a SQLite-backed `Database` impl).
 * The bridge surface stays identical.
 */
export class DirectoryHandle {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Generate an audit proof between two epochs (verifies append-only consistency).
     *
     * Per §6.3 step 5: verifiers use this to confirm the directory has not
     * rolled back between two anchored checkpoints.
     */
    audit_proof(from_epoch: bigint, to_epoch: bigint): Promise<Uint8Array>;
    /**
     * Get current epoch number.
     */
    current_epoch(): Promise<bigint>;
    /**
     * Get current root hash (hex-encoded). Anchored into the tlog as the
     * `directory_root` field of a `directory_anchor` record per §6.2.4.
     */
    current_root(): Promise<string>;
    /**
     * Retrieve the full version chain for a label (publish + rotations + revocations).
     *
     * Returns `{ versions: [{ value, version, epoch }], proof: bytes }`.
     * Returns `{ versions: [], proof: empty }` for an unregistered label.
     */
    history(label: string): Promise<any>;
    /**
     * Look up a label's current value at the latest epoch.
     *
     * Returns `{ value: hex, version: u64, proof: bincode_bytes }` for
     * membership, or `null` for an unregistered label (when the AKD
     * returns a NotFound storage error, indicating no claim exists).
     *
     * A future `prove_absence` method will return a verifiable
     * non-membership proof; this method's null-on-miss is a soft
     * fallback for callers that only need binary membership.
     */
    lookup(label: string): Promise<any>;
    /**
     * Create a new empty directory.
     */
    constructor();
    /**
     * Publish a batch of (label, value) pairs as a single epoch.
     *
     * Per §6.2.4 per-operation anchoring, callers SHOULD invoke this
     * once per logical update and emit a `directory_anchor` log entry
     * after each successful publish.
     *
     * Returns the new epoch number.
     */
    publish_batch(labels: Array<any>, values: Array<any>): Promise<bigint>;
}

export function init(): void;

/**
 * Verify an AKD audit (append-only) proof against a sequence of root hashes.
 *
 * Per spec §6.3 step 5. Takes (a) the concatenated 32-byte root hashes
 * captured at each anchored checkpoint between two epochs, in order
 * (so for epochs e..f, that's `f - e + 1` hashes = `(f-e+1)*32` bytes),
 * and (b) the bincode-serialized audit proof from the `/v6/audit-proof`
 * endpoint.
 *
 * We inline akd's `audit_verify` rather than calling the upstream
 * function because upstream's `verify_append_only_hash` hardcodes
 * `AzksParallelismConfig::default()` (= `AvailableOr(32)`) which calls
 * `std::thread::available_parallelism()` and tries to spawn parallel
 * Tokio tasks. WASM has no Tokio executor, so the upstream path panics
 * with `RuntimeError: unreachable`. Our inlined path passes
 * `AzksParallelismConfig::disabled()` everywhere.
 *
 * Async because the underlying AKD storage backend is async; no actual I/O.
 */
export function verify_audit_proof(hashes_concat: Uint8Array, proof_bytes: Uint8Array): Promise<boolean>;

/**
 * Verify an AKD lookup proof against a known root hash.
 *
 * Per spec §6.3 step 7. The verifier holds (a) the directory operator's
 * VRF public key (out of band; for HardCodedAkdVRF use [`vrf_public_key`]),
 * (b) the anchored root hash at the proof's epoch (from a `directory_anchor`
 * log entry), (c) the directory's current epoch, (d) the looked-up label,
 * and (e) the bincode-serialized lookup proof from the `/v6/lookup/:key`
 * endpoint.
 *
 * Wraps [`akd_core::verify::lookup_verify`] which is `pub fn` and pure.
 */
export function verify_lookup_proof(vrf_public_key: Uint8Array, root_hash: Uint8Array, current_epoch: bigint, label: string, proof_bytes: Uint8Array): boolean;

/**
 * Return the VRF public key for the bridge's `HardCodedAkdVRF`.
 *
 * Verifiers need the operator's VRF public key to validate lookup
 * proofs. For production directories the operator publishes their own
 * VRF pubkey in their identity claim or a dedicated record. For this
 * reference implementation (which uses `HardCodedAkdVRF` per
 * `DirectoryHandle::new`), the key is constant and exposed here.
 *
 * Returns the 32-byte VRF public key.
 */
export function vrf_public_key(): Promise<Uint8Array>;
