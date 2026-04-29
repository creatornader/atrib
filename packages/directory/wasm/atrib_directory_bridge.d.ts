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
