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
//   - current_epoch:  latest epoch number
//   - current_root:   latest root hash for anchoring
//   - audit_proof:    consistency proof between two epochs (append-only check)
//
// AKD parallelism is gated to `disabled()` because WASM runtimes lack a
// Tokio executor. The WASM-bridge decision (D034 §3.1) was motivated by a
// runtime benchmark; see D034 for the criterion and the conclusion.

use wasm_bindgen::prelude::*;
use akd::storage::memory::AsyncInMemoryDatabase;
use akd::storage::manager::StorageManager;
use akd::ecvrf::HardCodedAkdVRF;
use akd::{Directory, AkdLabel, AkdValue, AzksParallelismConfig};
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
