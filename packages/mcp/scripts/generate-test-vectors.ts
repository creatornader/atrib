// Generate test vectors for the spec appendix
import {
  base64urlEncode,
  base64urlDecode,
  sha256,
  hexEncode,
  canonicalSigningInput,
  canonicalRecord,
  signRecord,
  verifyRecord,
  encodeToken,
  genesisChainRoot,
  chainRoot,
  serializeEntry,
  leafHash,
  computeRoot,
  computeInclusionProof,
  verifyInclusion,
} from '../src/index.js'
import type { AtribRecord, EntryInput } from '../src/index.js'
import * as ed from '@noble/ed25519'
import { sha512 } from '@noble/hashes/sha2.js'

ed.etc.sha512Sync = (...m: Uint8Array[]) => sha512(ed.etc.concatBytes(...m))

const encoder = new TextEncoder()

async function main() {
  // Fixed inputs (all deterministic)
  const privateKeySeed = new Uint8Array(32).fill(0x01)
  const publicKey = await ed.getPublicKeyAsync(privateKeySeed)
  const creatorKeyB64 = base64urlEncode(publicKey)
  const contextId = 'a'.repeat(32)
  const genesis = genesisChainRoot(contextId)
  const contentId = 'sha256:' + hexEncode(sha256(encoder.encode('test-content')))

  const record: AtribRecord = {
    spec_version: 'atrib/1.0',
    event_type: 'tool_call',
    timestamp: 1700000000000,
    context_id: contextId,
    creator_key: creatorKeyB64,
    chain_root: genesis,
    content_id: contentId,
    signature: '',
  }

  // 1. Canonical signing input
  const sigInput = canonicalSigningInput(record)

  // 2. Sign
  const signed = await signRecord(record, privateKeySeed)

  // 3. Canonical record (with signature)
  const canonical = canonicalRecord(signed)

  // 4. Record hash
  const recordHash = sha256(canonical)

  // 5. Propagation token
  const token = encodeToken(signed)

  // 6. Chain root for next record
  const nextChain = chainRoot(signed)

  // 7. Entry serialization
  const entryInput: EntryInput = {
    record_hash_hex: hexEncode(recordHash),
    creator_key_b64url: creatorKeyB64,
    context_id: contextId,
    timestamp: 1700000000000,
    event_type: 'tool_call',
  }
  const entry = serializeEntry(entryInput)

  // 8. Leaf hash
  const leaf = leafHash(entry)

  // 9. Merkle root (single entry tree)
  const root = computeRoot([entry])

  // 10. Inclusion proof (single entry = empty proof)
  const proof = computeInclusionProof(0, [entry])

  // 11. Verify inclusion
  const inclusionValid = verifyInclusion(0, 1, leaf, proof, root)

  // 12. Verify signature
  const sigValid = await verifyRecord(signed)

  // Second record for 2-entry tree
  const record2: AtribRecord = {
    spec_version: 'atrib/1.0',
    event_type: 'tool_call',
    timestamp: 1700000001000,
    context_id: contextId,
    creator_key: creatorKeyB64,
    chain_root: nextChain,
    content_id: 'sha256:' + hexEncode(sha256(encoder.encode('test-content-2'))),
    signature: '',
  }
  const signed2 = await signRecord(record2, privateKeySeed)
  const canonical2 = canonicalRecord(signed2)
  const recordHash2 = sha256(canonical2)
  const entry2Input: EntryInput = {
    record_hash_hex: hexEncode(recordHash2),
    creator_key_b64url: creatorKeyB64,
    context_id: contextId,
    timestamp: 1700000001000,
    event_type: 'tool_call',
  }
  const entry2 = serializeEntry(entry2Input)
  const leaf2 = leafHash(entry2)
  const root2 = computeRoot([entry, entry2])
  const proof2for0 = computeInclusionProof(0, [entry, entry2])
  const proof2for1 = computeInclusionProof(1, [entry, entry2])

  console.log(`## Appendix A: Test Vectors

The following test vectors are generated from the reference implementation. Two independent implementations that produce identical outputs for these inputs are interoperable.

All values are deterministic given the inputs. Ed25519 signing with a fixed seed produces a fixed signature.

### A.1 Key Material

| Field | Value |
| --- | --- |
| Private key seed (hex) | \`${hexEncode(privateKeySeed)}\` |
| Public key (hex) | \`${hexEncode(publicKey)}\` |
| Public key (base64url) | \`${creatorKeyB64}\` |

### A.2 Record Fields

| Field | Value |
| --- | --- |
| spec_version | \`atrib/1.0\` |
| event_type | \`tool_call\` |
| timestamp | \`1700000000000\` |
| context_id | \`${contextId}\` |
| creator_key | \`${creatorKeyB64}\` |
| content_id | \`${contentId}\` |
| chain_root (genesis) | \`${genesis}\` |

### A.3 Canonical Signing Input (§1.3)

The signing input is \`JCS(record without signature)\`:

\`\`\`
${new TextDecoder().decode(sigInput)}
\`\`\`

SHA-256 of signing input (hex): \`${hexEncode(sha256(sigInput))}\`

### A.4 Signature (§1.4)

| Field | Value |
| --- | --- |
| Signature (base64url) | \`${signed.signature}\` |
| Signature (hex) | \`${hexEncode(base64urlDecode(signed.signature))}\` |
| Verification passes | \`${sigValid}\` |

### A.5 Canonical Record and Record Hash

The canonical record is \`JCS(complete record with signature)\`:

\`\`\`
${new TextDecoder().decode(canonical)}
\`\`\`

| Field | Value |
| --- | --- |
| Record hash (hex) | \`${hexEncode(recordHash)}\` |
| Record hash (base64url) | \`${base64urlEncode(recordHash)}\` |

### A.6 Propagation Token (§1.5.2)

| Field | Value |
| --- | --- |
| Token | \`${token}\` |
| Format | \`base64url(record_hash) + "." + base64url(creator_key)\` |

### A.7 Chain Root for Next Record

| Field | Value |
| --- | --- |
| chain_root | \`${nextChain}\` |
| Format | \`"sha256:" + hex(record_hash)\` |
| Matches record_hash from A.5 | \`${nextChain === 'sha256:' + hexEncode(recordHash)}\` |

### A.8 Log Entry Serialization (§2.3.1)

| Field | Value |
| --- | --- |
| Entry (hex, 90 bytes) | \`${hexEncode(entry)}\` |
| Entry length | \`${entry.length}\` |

Byte layout:
- Byte 0: version (\`0x01\`)
- Byte 1: event_type (\`0x01\` = tool_call)
- Bytes 2-33: record_hash (32 bytes)
- Bytes 34-65: creator_key (32 bytes)
- Bytes 66-81: context_id (16 bytes)
- Bytes 82-89: timestamp (uint64 big-endian)

### A.9 Merkle Tree (§2.3.2, §2.7)

**Single-entry tree (tree_size = 1):**

| Field | Value |
| --- | --- |
| Leaf hash | \`${hexEncode(leaf)}\` |
| Leaf hash (base64) | \`${Buffer.from(leaf).toString('base64')}\` |
| Root (= leaf hash for size 1) | \`${hexEncode(root)}\` |
| Inclusion proof | \`[]\` (empty for single-entry tree) |
| Verification passes | \`${inclusionValid}\` |

**Two-entry tree (tree_size = 2):**

| Field | Value |
| --- | --- |
| Leaf 0 hash | \`${hexEncode(leaf)}\` |
| Leaf 1 hash | \`${hexEncode(leaf2)}\` |
| Root | \`${hexEncode(root2)}\` |
| Inclusion proof for index 0 | \`["${Buffer.from(proof2for0[0]!).toString('base64')}"]\` |
| Inclusion proof for index 1 | \`["${Buffer.from(proof2for1[0]!).toString('base64')}"]\` |

Leaf hash computation: \`SHA-256(0x00 || entry_bytes)\`
Internal node hash: \`SHA-256(0x01 || left || right)\`
Root of 2-entry tree: \`SHA-256(0x01 || leaf_hash_0 || leaf_hash_1)\`
`)
}

main().catch(e => { console.error(e); process.exit(1) })
