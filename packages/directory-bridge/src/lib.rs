// atrib-directory-bridge
//
// Rust→WASM bridge wrapping Meta's `akd` Rust crate. Exposes the four
// directory operations atrib's spec §6 normatively requires:
//
//   - publish:        insert (label, value) batches into a new epoch
//   - lookup:         retrieve a label's current value + verifiable proof
//   - history:        retrieve a label's full version chain
//   - prove_absence:  verifiable non-membership proof for an unregistered label
//
// Plus operations supporting per-operation anchoring (§6.2.4) and the
// 9-step verifier consultation algorithm (§6.3):
//
// Prover side (directory operator):
//   - current_epoch:        latest epoch number
//   - current_root:         latest root hash for anchoring
//   - audit_proof:          consistency proof between two epochs (append-only check)
//
// Verifier side (consumers, no directory state needed):
//   - verify_lookup_proof:  validates a lookup proof against a known root (§6.3 step 7)
//   - verify_audit_proof:   validates an audit proof against a sequence of roots (§6.3 step 5)
//   - vrf_public_key:       VRF pubkey bytes for HardCodedAkdVRF, verifiers need
//                           this out of band; for production directories the
//                           operator publishes their own VRF pubkey.
//
// AKD parallelism is gated to `disabled()` because WASM runtimes lack a
// Tokio executor. The WASM-bridge decision (D034 §3.1) was motivated by a
// runtime benchmark; see D034 for the criterion and the conclusion.

use wasm_bindgen::prelude::*;
use akd::storage::memory::AsyncInMemoryDatabase;
use akd::storage::manager::StorageManager;
use akd::ecvrf::{HardCodedAkdVRF, VRFKeyStorage};
use akd::{Directory, AkdLabel, AkdValue, AzksParallelismConfig};
use akd::{LookupProof, AppendOnlyProof, Digest};
use akd::WhatsAppV1Configuration as Cfg;
use std::sync::Arc;

#[wasm_bindgen(start)]
pub fn init() {
    #[cfg(feature = "console_error_panic_hook")]
    console_error_panic_hook::set_once();
}

/// In-process AKD directory handle. Holds a single in-memory database
/// instance and provides the publish/lookup/history/audit operations.
///
/// Production deployments will typically replace `AsyncInMemoryDatabase`
/// with a persistent backend (e.g., a SQLite-backed `Database` impl).
/// The bridge surface stays identical.
#[wasm_bindgen]
pub struct DirectoryHandle {
    inner: Arc<Directory<Cfg, AsyncInMemoryDatabase, HardCodedAkdVRF>>,
}

#[wasm_bindgen]
impl DirectoryHandle {
    /// Create a new empty directory.
    #[wasm_bindgen(constructor)]
    pub async fn new() -> Result<DirectoryHandle, JsValue> {
        let db = AsyncInMemoryDatabase::new();
        let manager = StorageManager::new_no_cache(db);
        let vrf = HardCodedAkdVRF{};
        // Disabled parallelism: WASM has no Tokio runtime; AKD's parallel paths panic.
        let dir = Directory::<Cfg, _, _>::new(manager, vrf, AzksParallelismConfig::disabled())
            .await
            .map_err(|e| JsValue::from_str(&format!("init: {e:?}")))?;
        Ok(DirectoryHandle { inner: Arc::new(dir) })
    }

    /// Publish a batch of (label, value) pairs as a single epoch.
    ///
    /// Per §6.2.4 per-operation anchoring, callers SHOULD invoke this
    /// once per logical update and emit a `directory_anchor` log entry
    /// after each successful publish.
    ///
    /// Returns the new epoch number.
    #[wasm_bindgen]
    pub async fn publish_batch(&self, labels: js_sys::Array, values: js_sys::Array) -> Result<u64, JsValue> {
        if labels.length() != values.length() {
            return Err(JsValue::from_str("labels.length != values.length"));
        }
        let mut updates = Vec::with_capacity(labels.length() as usize);
        for i in 0..labels.length() {
            let label_str = labels.get(i).as_string().ok_or_else(|| JsValue::from_str("label not string"))?;
            let value_str = values.get(i).as_string().ok_or_else(|| JsValue::from_str("value not string"))?;
            updates.push((AkdLabel::from(label_str.as_str()), AkdValue::from(value_str.as_str())));
        }
        let epoch_hash = self.inner.publish(updates)
            .await
            .map_err(|e| JsValue::from_str(&format!("publish: {e:?}")))?;
        Ok(epoch_hash.epoch())
    }

    /// Look up a label's current value at the latest epoch.
    ///
    /// Returns `{ value: hex, version: u64, proof: bincode_bytes }` for
    /// membership, or `null` for an unregistered label (when the AKD
    /// returns a NotFound storage error, indicating no claim exists).
    ///
    /// A future `prove_absence` method will return a verifiable
    /// non-membership proof; this method's null-on-miss is a soft
    /// fallback for callers that only need binary membership.
    #[wasm_bindgen]
    pub async fn lookup(&self, label: String) -> Result<JsValue, JsValue> {
        let label = AkdLabel::from(label.as_str());
        match self.inner.lookup(label.clone()).await {
            Ok((proof, _root)) => {
                let proof_bytes = bincode::serialize(&proof)
                    .map_err(|e| JsValue::from_str(&format!("serialize: {e:?}")))?;
                let result = LookupResult {
                    value: hex::encode(&proof.value.0),
                    version: proof.version,
                    proof: proof_bytes,
                };
                serde_wasm_bindgen::to_value(&result).map_err(|e| JsValue::from_str(&format!("to_js: {e:?}")))
            }
            Err(akd::errors::AkdError::Storage(akd::errors::StorageError::NotFound(_))) => {
                // Unregistered label: return null. Non-membership proof comes from prove_absence.
                Ok(JsValue::NULL)
            }
            Err(e) => Err(JsValue::from_str(&format!("lookup: {e:?}"))),
        }
    }

    /// Retrieve the full version chain for a label (publish + rotations + revocations).
    ///
    /// Returns `{ versions: [{ value, version, epoch }], proof: bytes }`.
    /// Returns `{ versions: [], proof: empty }` for an unregistered label.
    #[wasm_bindgen]
    pub async fn history(&self, label: String) -> Result<JsValue, JsValue> {
        use akd::HistoryParams;
        let label = AkdLabel::from(label.as_str());
        let (proof, _root) = match self.inner.key_history(&label, HistoryParams::default()).await {
            Ok(v) => v,
            Err(akd::errors::AkdError::Storage(akd::errors::StorageError::NotFound(_))) => {
                let result = HistoryResult { versions: vec![], proof: vec![] };
                return serde_wasm_bindgen::to_value(&result).map_err(|e| JsValue::from_str(&format!("to_js: {e:?}")));
            }
            Err(e) => return Err(JsValue::from_str(&format!("history: {e:?}"))),
        };
        let proof_bytes = bincode::serialize(&proof)
            .map_err(|e| JsValue::from_str(&format!("serialize: {e:?}")))?;
        let versions: Vec<HistoryVersion> = proof.update_proofs.iter().map(|p| HistoryVersion {
            value: hex::encode(&p.value.0),
            version: p.version,
            epoch: p.epoch,
        }).collect();
        let result = HistoryResult {
            versions,
            proof: proof_bytes,
        };
        serde_wasm_bindgen::to_value(&result).map_err(|e| JsValue::from_str(&format!("to_js: {e:?}")))
    }

    /// Get current epoch number.
    #[wasm_bindgen]
    pub async fn current_epoch(&self) -> Result<u64, JsValue> {
        let info = self.inner.get_epoch_hash()
            .await
            .map_err(|e| JsValue::from_str(&format!("epoch: {e:?}")))?;
        Ok(info.epoch())
    }

    /// Get current root hash (hex-encoded). Anchored into the tlog as the
    /// `directory_root` field of a `directory_anchor` record per §6.2.4.
    #[wasm_bindgen]
    pub async fn current_root(&self) -> Result<String, JsValue> {
        let info = self.inner.get_epoch_hash()
            .await
            .map_err(|e| JsValue::from_str(&format!("root: {e:?}")))?;
        Ok(hex::encode(info.hash()))
    }

    /// Generate an audit proof between two epochs (verifies append-only consistency).
    ///
    /// Per §6.3 step 5: verifiers use this to confirm the directory has not
    /// rolled back between two anchored checkpoints.
    #[wasm_bindgen]
    pub async fn audit_proof(&self, from_epoch: u64, to_epoch: u64) -> Result<Vec<u8>, JsValue> {
        let proof = self.inner.audit(from_epoch, to_epoch)
            .await
            .map_err(|e| JsValue::from_str(&format!("audit: {e:?}")))?;
        bincode::serialize(&proof)
            .map_err(|e| JsValue::from_str(&format!("serialize: {e:?}")))
    }
}

#[derive(serde::Serialize)]
struct LookupResult {
    value: String,
    version: u64,
    proof: Vec<u8>,
}

#[derive(serde::Serialize)]
struct HistoryResult {
    versions: Vec<HistoryVersion>,
    proof: Vec<u8>,
}

#[derive(serde::Serialize)]
struct HistoryVersion {
    value: String,
    version: u64,
    epoch: u64,
}

// =============================================================================
// Verifier-side primitives (§6.3 steps 5 + 7).
// =============================================================================
//
// These are stateless free functions: no `DirectoryHandle` required. A
// consumer fetches a serialized proof from the directory's HTTP API
// (`GET /v6/lookup/:key` returns base64url-encoded bincode bytes; same
// for `GET /v6/audit-proof?from=N&to=M`), fetches the anchored root from
// the tlog (`directory_anchor` records), and calls these to validate.
//
// Both functions return `Ok(true)` on a valid proof, `Ok(false)` on a
// proof that decodes correctly but fails verification, and `Err(_)` only
// when the inputs are malformed (wrong length, bincode decode failure).
// This shape lets verifiers distinguish "input was bad" (programmer
// error / API drift) from "proof was correctly formed but not valid"
// (the result we surface to consumers).

/// Verify an AKD lookup proof against a known root hash.
///
/// Per spec §6.3 step 7. The verifier holds (a) the directory operator's
/// VRF public key (out of band; for HardCodedAkdVRF use [`vrf_public_key`]),
/// (b) the anchored root hash at the proof's epoch (from a `directory_anchor`
/// log entry), (c) the directory's current epoch, (d) the looked-up label,
/// and (e) the bincode-serialized lookup proof from the `/v6/lookup/:key`
/// endpoint.
///
/// Wraps [`akd_core::verify::lookup_verify`] which is `pub fn` and pure.
#[wasm_bindgen]
pub fn verify_lookup_proof(
    vrf_public_key: Vec<u8>,
    root_hash: Vec<u8>,
    current_epoch: u64,
    label: String,
    proof_bytes: Vec<u8>,
) -> Result<bool, JsValue> {
    use akd::client::lookup_verify;

    if root_hash.len() != 32 {
        return Err(JsValue::from_str("root_hash must be 32 bytes"));
    }
    let mut root: Digest = [0u8; 32];
    root.copy_from_slice(&root_hash);

    let proof: LookupProof = bincode::deserialize(&proof_bytes)
        .map_err(|e| JsValue::from_str(&format!("deserialize lookup proof: {e:?}")))?;

    match lookup_verify::<Cfg>(&vrf_public_key, root, current_epoch, AkdLabel::from(label.as_str()), proof) {
        Ok(_) => Ok(true),
        Err(_) => Ok(false),
    }
}

/// Verify an AKD audit (append-only) proof against a sequence of root hashes.
///
/// Per spec §6.3 step 5. Takes (a) the concatenated 32-byte root hashes
/// captured at each anchored checkpoint between two epochs, in order
/// (so for epochs e..f, that's `f - e + 1` hashes = `(f-e+1)*32` bytes),
/// and (b) the bincode-serialized audit proof from the `/v6/audit-proof`
/// endpoint.
///
/// We inline akd's `audit_verify` rather than calling the upstream
/// function because upstream's `verify_append_only_hash` hardcodes
/// `AzksParallelismConfig::default()` (= `AvailableOr(32)`) which calls
/// `std::thread::available_parallelism()` and tries to spawn parallel
/// Tokio tasks. WASM has no Tokio executor, so the upstream path panics
/// with `RuntimeError: unreachable`. Our inlined path passes
/// `AzksParallelismConfig::disabled()` everywhere.
///
/// Async because the underlying AKD storage backend is async; no actual I/O.
#[wasm_bindgen]
pub async fn verify_audit_proof(
    hashes_concat: Vec<u8>,
    proof_bytes: Vec<u8>,
) -> Result<bool, JsValue> {
    if hashes_concat.is_empty() || hashes_concat.len() % 32 != 0 {
        return Err(JsValue::from_str("hashes_concat must be a non-empty multiple of 32 bytes"));
    }
    let hashes: Vec<Digest> = hashes_concat
        .chunks_exact(32)
        .map(|chunk| {
            let mut d: Digest = [0u8; 32];
            d.copy_from_slice(chunk);
            d
        })
        .collect();

    let proof: AppendOnlyProof = bincode::deserialize(&proof_bytes)
        .map_err(|e| JsValue::from_str(&format!("deserialize audit proof: {e:?}")))?;

    match audit_verify_wasm_safe::<Cfg>(hashes, proof).await {
        Ok(()) => Ok(true),
        Err(_) => Ok(false),
    }
}

// =============================================================================
// WASM-safe audit_verify chain.
// =============================================================================
//
// Mirrors akd::auditor::audit_verify / verify_consecutive_append_only /
// verify_append_only_hash but threads `AzksParallelismConfig::disabled()`
// through the only call site that hardcoded the default. Mirror updates:
// any change to the upstream chain in akd-0.12 should be reflected here.

use akd::append_only_zks::InsertMode;
use akd::configuration::Configuration;
use akd::{Azks, AzksElement, AzksValue, SingleAppendOnlyProof};

async fn audit_verify_wasm_safe<TC: Configuration>(
    hashes: Vec<Digest>,
    proof: AppendOnlyProof,
) -> Result<(), akd::errors::AkdError> {
    use akd::errors::{AkdError, AuditorError};
    if proof.epochs.len() + 1 != hashes.len() {
        return Err(AkdError::AuditErr(AuditorError::VerifyAuditProof(format!(
            "epoch/hash count mismatch: epochs={}, hashes={}",
            proof.epochs.len(),
            hashes.len()
        ))));
    }
    if proof.epochs.len() != proof.proofs.len() {
        return Err(AkdError::AuditErr(AuditorError::VerifyAuditProof(format!(
            "epoch/proof count mismatch: epochs={}, proofs={}",
            proof.epochs.len(),
            proof.proofs.len()
        ))));
    }
    for i in 0..hashes.len() - 1 {
        verify_consecutive_append_only_wasm_safe::<TC>(
            &proof.proofs[i],
            hashes[i],
            hashes[i + 1],
            proof.epochs[i] + 1,
        )
        .await?;
    }
    Ok(())
}

async fn verify_consecutive_append_only_wasm_safe<TC: Configuration>(
    proof: &SingleAppendOnlyProof,
    start_hash: Digest,
    end_hash: Digest,
    end_epoch: u64,
) -> Result<(), akd::errors::AkdError> {
    verify_append_only_hash_wasm_safe::<TC>(proof.unchanged_nodes.clone(), start_hash, None).await?;
    let mut combined = proof.unchanged_nodes.clone();
    combined.extend(proof.inserted.iter().map(|x| {
        let mut y = *x;
        y.value = AzksValue(TC::hash_leaf_with_commitment(x.value, end_epoch).0);
        y
    }));
    verify_append_only_hash_wasm_safe::<TC>(combined, end_hash, Some(end_epoch - 1)).await?;
    Ok(())
}

async fn verify_append_only_hash_wasm_safe<TC: Configuration>(
    nodes: Vec<AzksElement>,
    expected_hash: Digest,
    latest_epoch: Option<u64>,
) -> Result<(), akd::errors::AkdError> {
    use akd::errors::{AkdError, AzksError};
    let manager = StorageManager::new_no_cache(
        AsyncInMemoryDatabase::new_with_remove_child_nodes_on_insertion(),
    );
    let mut azks = Azks::new::<TC, _>(&manager).await?;
    if let Some(epoch) = latest_epoch {
        azks.latest_epoch = epoch;
    }
    azks.batch_insert_nodes::<TC, _>(
        &manager,
        nodes,
        InsertMode::Auditor,
        AzksParallelismConfig::disabled(),
    )
    .await?;
    let computed: Digest = azks.get_root_hash::<TC, _>(&manager).await?;
    if computed != expected_hash {
        return Err(AkdError::AzksErr(AzksError::VerifyAppendOnlyProof(format!(
            "expected {} got {}",
            hex::encode(expected_hash),
            hex::encode(computed)
        ))));
    }
    Ok(())
}

/// Return the VRF public key for the bridge's `HardCodedAkdVRF`.
///
/// Verifiers need the operator's VRF public key to validate lookup
/// proofs. For production directories the operator publishes their own
/// VRF pubkey in their identity claim or a dedicated record. For this
/// reference implementation (which uses `HardCodedAkdVRF` per
/// `DirectoryHandle::new`), the key is constant and exposed here.
///
/// Returns the 32-byte VRF public key.
#[wasm_bindgen]
pub async fn vrf_public_key() -> Result<Vec<u8>, JsValue> {
    let vrf = HardCodedAkdVRF{};
    let pk = vrf.get_vrf_public_key()
        .await
        .map_err(|e| JsValue::from_str(&format!("vrf pubkey: {e:?}")))?;
    Ok(pk.as_bytes().to_vec())
}
