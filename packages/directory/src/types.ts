// Identity claim format per spec §6.1.

export type ClaimMethod = 'self_attested' | 'domain_verified' | 'did_resolved'

/** Optional capability envelope (D051 / spec §6.7). */
export interface CapabilityEnvelope {
  tool_names?: string[]
  max_amount?: { currency: string; value: number }
  counterparties?: string[]
  event_types?: string[]
  expires_at?: number
}

/** Identity claim object stored in the directory. */
export interface IdentityClaim {
  creator_key: string
  claim_type: ClaimMethod
  /** Method-specific payload (e.g., DNS TXT record name + signature; DID document URI; etc.). */
  claim_method: string
  /** Method-specific subject content (e.g., display name, organization, attested attributes). */
  claim_subject: Record<string, unknown>
  /** Optional capability envelope (D051). */
  capabilities?: CapabilityEnvelope
  /** Operator's signature over the JCS canonicalization of the claim with `signature: ""`. */
  signature: string
}

/** Lookup result returned by the directory. */
export interface LookupResult {
  /** The identity claim, or null for verified non-membership. */
  claim: IdentityClaim | null
  /** Version number of the resolved claim (1 for first publication, increments on each rotation). */
  version: number | null
  /** AKD lookup proof; verifiers re-validate against the anchored checkpoint root. */
  proof: Uint8Array
}

/** Single version entry in a key's history. */
export interface HistoryEntry {
  claim: IdentityClaim
  version: number
  epoch: number
}

/** Full version history for a key. */
export interface HistoryResult {
  versions: HistoryEntry[]
  /** AKD history proof; verifiers re-validate the chain. */
  proof: Uint8Array
}

/** Snapshot of the directory's current anchored state. */
export interface DirectorySnapshot {
  /** Current epoch number. */
  epoch: number
  /** Current root hash (hex-encoded). Anchored into the tlog as `directory_root`. */
  root_hash: string
}

/** Directory operator's published identity. Used as the `directory_id` in anchor records. */
export interface DirectoryIdentity {
  /** Operator's publicly-known origin string (e.g., `directory.atrib.dev/v6`). */
  origin: string
  /** Operator's checkpoint-signing public key (base64url Ed25519). */
  signing_key: string
}
