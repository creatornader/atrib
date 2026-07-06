// SPDX-License-Identifier: Apache-2.0
//
// Cross-implementation determinism judge — TypeScript side.
//
// Reads a JSON case file (path in argv[2]) with shape:
//   { cases: [{ seed_hex, event_type, context_id, chain_root?, content,
//               informed_by?, annotates?, revises?, tool_name?, args_hash?,
//               result_hash?, provenance_token?, timestamp_ms }] }
//
// For each case it assembles and signs an emit record EXACTLY the way
// @atrib/emit's buildAndSignEmitRecord (services/atrib-emit/src/sign.ts)
// does — synthetic content_id pair, D099 default args_hash over JCS(content),
// lexicographically sorted informed_by, omission-not-null optional fields —
// with the single deliberate deviation that `timestamp` is injected from the
// case's timestamp_ms instead of Date.now(), so the Python side can build the
// byte-identical record.
//
// Output (stdout, JSON):
//   { results: [{ record, canonical_signing_input_b64, record_hash_hex,
//                 token, derived_provenance_token }] }
//
// canonical_signing_input_b64 is standard base64 of the §1.4.2 signing input
// (JCS of the signed record with `signature` removed). record_hash_hex is the
// §1.2.3 hash over the COMPLETE signed record. token is the §1.5.2
// propagation token. derived_provenance_token is the §1.2.6 22-char token a
// downstream genesis record would carry when anchored to this record.
//
// Requires packages/sdk to be built (imports from ../dist/index.js).

import { readFileSync } from 'node:fs'
import {
  base64urlEncode,
  canonicalRecord,
  canonicalSigningInput,
  computeContentId,
  deriveProvenanceToken,
  encodeToken,
  genesisChainRoot,
  getPublicKey,
  hexDecode,
  hexEncode,
  recordHashHex,
  sha256,
  signRecord,
} from '../dist/index.js'

// Frozen historical constant shared with @atrib/emit (services/atrib-emit/src/sign.ts).
const SYNTHETIC_SERVER_URL = 'mcp://atrib-emit'

/** Mirror of @atrib/emit's leafOfEventTypeUri — trailing path segment for
 * slash-bearing URIs, the URI itself for slash-less or trailing-slash inputs. */
function leafOfEventTypeUri(uri) {
  const slashIdx = uri.lastIndexOf('/')
  if (slashIdx === -1) return uri
  const leaf = uri.slice(slashIdx + 1)
  return leaf.length > 0 ? leaf : uri
}

/** Mirror of @atrib/emit's contentHash — the D099 default args_hash
 * commitment: sha256:<hex(SHA-256(UTF-8(JCS(content))))>. canonicalRecord
 * JCS-canonicalizes any JSON-compatible object. */
function contentHash(content) {
  return `sha256:${hexEncode(sha256(canonicalRecord(content)))}`
}

async function buildSigned(c) {
  const seed = hexDecode(c.seed_hex)
  const publicKey = base64urlEncode(await getPublicKey(seed))
  const contentId = computeContentId(
    SYNTHETIC_SERVER_URL,
    leafOfEventTypeUri(c.event_type),
  )
  const argsHash = c.args_hash ?? contentHash(c.content)
  const informedBySorted =
    c.informed_by && c.informed_by.length > 0
      ? [...c.informed_by].sort()
      : undefined
  const chainRoot = c.chain_root ?? genesisChainRoot(c.context_id)

  const record = {
    spec_version: 'atrib/1.0',
    content_id: contentId,
    creator_key: publicKey,
    chain_root: chainRoot,
    event_type: c.event_type,
    context_id: c.context_id,
    timestamp: c.timestamp_ms,
    signature: '',
    ...(informedBySorted ? { informed_by: informedBySorted } : {}),
    ...(c.annotates ? { annotates: c.annotates } : {}),
    ...(argsHash ? { args_hash: argsHash } : {}),
    ...(c.provenance_token ? { provenance_token: c.provenance_token } : {}),
    ...(c.result_hash ? { result_hash: c.result_hash } : {}),
    ...(c.revises ? { revises: c.revises } : {}),
    ...(c.tool_name ? { tool_name: c.tool_name } : {}),
  }
  return signRecord(record, seed)
}

async function main() {
  const casesPath = process.argv[2]
  if (!casesPath) {
    console.error('usage: node cross-impl-vectors.mjs <cases.json>')
    process.exit(2)
  }
  const { cases } = JSON.parse(readFileSync(casesPath, 'utf8'))
  const results = []
  for (const c of cases) {
    const signed = await buildSigned(c)
    results.push({
      record: signed,
      canonical_signing_input_b64: Buffer.from(
        canonicalSigningInput(signed),
      ).toString('base64'),
      record_hash_hex: recordHashHex(signed),
      token: encodeToken(signed),
      derived_provenance_token: deriveProvenanceToken(signed),
    })
  }
  process.stdout.write(JSON.stringify({ results }))
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err))
  process.exit(1)
})
