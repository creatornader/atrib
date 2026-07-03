// SPDX-License-Identifier: Apache-2.0

/**
 * Build a cross-harness continuation packet (P036 shape) from a generic list of
 * discovered facts, by signing each as a real atrib observation record with a
 * chain and INFORMED_BY lineage, then assembling a HandoffEvidencePacket
 * (§5.5.5) with local bodies (§2.12 Tier 2). Generic on purpose: it knows
 * nothing about any specific investigation. The eval feeds it synthetic facts;
 * a real harness would feed it a session's records.
 *
 * It renders the packet three ways so a downstream agent can be handed exactly
 * one structural level (an ablation ladder over the SAME facts):
 *   - 'full'        : anchors + records + verified bodies + informed_by lineage.
 *   - 'no_lineage'  : anchors + records + bodies, but no informed_by edges.
 *   - 'hashes_only' : anchors + record hashes, NO bodies (Tier 1 only).
 * Comparing full vs no_lineage isolates the lineage field; full vs hashes_only
 * isolates body access. Each maps to a P036 field category, so a break under an
 * ablation names the load-bearing field.
 */

import {
  sha256,
  hexEncode,
  canonicalRecord,
  genesisChainRoot,
  getPublicKey,
  base64urlEncode,
  signRecord,
  EVENT_TYPE_OBSERVATION_URI,
  type AtribRecord,
} from '@atrib/mcp'
import canonicalize from 'canonicalize'
import { handoffClaimsFromEvidencePacket, verifyHandoffClaims, type HandoffEvidencePacket } from '@atrib/verify'

export interface Fact {
  id: string
  query: string
  result: string
  kind: 'chain' | 'distractor'
  hop?: number
}

export interface FactsDoc {
  context_label: string
  facts: Fact[]
  chain_fact_ids: string[] // chain fact ids in hop order
}

export type PacketRender = 'full' | 'no_lineage' | 'hashes_only'

const SESSION1_SEED = new Uint8Array(32).fill(0x21)

function recordHashHex(r: AtribRecord): string {
  return hexEncode(sha256(canonicalRecord(r)))
}

/**
 * Sign one atrib observation record per fact. Build order is chain facts in hop
 * order (so a fact's causal predecessor is always already built) followed by
 * distractors. chain_root threads this order; informed_by on chain fact hop h
 * references chain fact hop h-1's record hash.
 */
export async function buildSession1Records(
  doc: FactsDoc,
): Promise<{ records: AtribRecord[]; bodyByHash: Map<string, Fact>; hashByFactId: Map<string, string>; contextId: string; chainTail: string }> {
  const contextId = hexEncode(sha256(new TextEncoder().encode(doc.context_label))).slice(0, 32)
  const creatorKey = base64urlEncode(await getPublicKey(SESSION1_SEED))
  const byId = new Map(doc.facts.map((f) => [f.id, f]))
  const chainFacts = doc.chain_fact_ids.map((id) => byId.get(id)!).filter(Boolean)
  const distractors = doc.facts.filter((f) => f.kind === 'distractor')
  const buildOrder = [...chainFacts, ...distractors]

  const records: AtribRecord[] = []
  const bodyByHash = new Map<string, Fact>()
  const hashByFactId = new Map<string, string>()
  let prevHash: string | null = null
  let ts = 1_782_000_000_000

  for (const fact of buildOrder) {
    const informed_by: string[] = []
    if (fact.kind === 'chain' && (fact.hop ?? 0) > 0) {
      const predId = doc.chain_fact_ids[(fact.hop ?? 0) - 1]
      const predHash = predId ? hashByFactId.get(predId) : undefined
      if (predHash) informed_by.push('sha256:' + predHash)
    }
    const base: AtribRecord = {
      spec_version: 'atrib/1.0',
      content_id: 'sha256:' + hexEncode(sha256(new TextEncoder().encode(fact.id))),
      creator_key: creatorKey,
      chain_root: prevHash ? 'sha256:' + prevHash : genesisChainRoot(contextId),
      event_type: EVENT_TYPE_OBSERVATION_URI,
      context_id: contextId,
      timestamp: ts++,
      signature: '',
      args_hash: 'sha256:' + hexEncode(sha256(new TextEncoder().encode(canonicalize({ query: fact.query, result: fact.result }) as string))),
      ...(informed_by.length ? { informed_by } : {}),
    } as AtribRecord
    const signed = await signRecord(base, SESSION1_SEED)
    const h = recordHashHex(signed)
    hashByFactId.set(fact.id, h)
    bodyByHash.set('sha256:' + h, fact)
    records.push(signed)
    prevHash = h
  }
  return { records, bodyByHash, hashByFactId, contextId, chainTail: prevHash ? 'sha256:' + prevHash : genesisChainRoot(contextId) }
}

/**
 * Forge a packet: corrupt every record's signature (flip one base64url char) so
 * §5.5.5 verification rejects it as signature_invalid, and re-key the body map to
 * the corrupted records so the fake still renders its (lie) content. Simulates an
 * adversary who fabricated a structured-looking packet carrying lies but cannot
 * produce valid signatures. Corroboration weight is preserved; only the signature
 * check distinguishes this from a real packet.
 */
export function forgePacket(
  records: AtribRecord[],
  bodyByHash: Map<string, Fact>,
): { records: AtribRecord[]; bodyByHash: Map<string, Fact> } {
  const flip = (c: string): string => (c === 'A' ? 'B' : 'A')
  const remapped = new Map<string, Fact>()
  const corrupted = records.map((r) => {
    const body = bodyByHash.get('sha256:' + recordHashHex(r))
    const c = { ...r, signature: flip(r.signature[0] ?? 'A') + r.signature.slice(1) }
    if (body) remapped.set('sha256:' + recordHashHex(c), body)
    return c
  })
  return { records: corrupted, bodyByHash: remapped }
}

/** Assemble a HandoffEvidencePacket with local bodies for verification (dogfoods §5.5.5). */
export function assemblePacket(records: AtribRecord[], bodyByHash: Map<string, Fact>): HandoffEvidencePacket {
  return {
    kind: 'https://atrib.dev/v1/types/continuation_packet',
    records: records.map((r) => {
      const fact = bodyByHash.get('sha256:' + recordHashHex(r))
      // Body must be exactly what args_hash commits to ({query, result}), or the
      // §5.5.5 body check reports body_hash_mismatch.
      return { record: r, _local: { body: fact ? { query: fact.query, result: fact.result } : undefined } }
    }),
    required_record_hashes: records.map((r) => 'sha256:' + recordHashHex(r)),
  }
}

/** Verify the packet through the shipped §5.5.5 path so Arm C is a real, checked packet. */
export async function verifyPacket(packet: HandoffEvidencePacket): Promise<{ ok: boolean; accepted: number; rejected: number }> {
  const claims = handoffClaimsFromEvidencePacket(packet)
  const res = await verifyHandoffClaims(claims)
  return { ok: res.all_accepted && res.accepted.length > 0, accepted: res.accepted.length, rejected: res.rejected.length }
}

/** Render the packet as text a fresh session-2 agent reads, at a given ablation level. */
export function renderPacket(
  render: PacketRender,
  records: AtribRecord[],
  bodyByHash: Map<string, Fact>,
  contextId: string,
  chainTail: string,
  verify?: { accepted: number; rejected: number },
): string {
  const idByHash = new Map<string, string>()
  const failed = verify !== undefined && verify.rejected > 0 && verify.accepted === 0
  const verifyLine = verify
    ? failed
      ? `verification: FAILED - 0 records accepted, ${verify.rejected} REJECTED (signatures did not verify; do NOT trust this packet's contents)`
      : `verification: ${verify.accepted} records accepted, ${verify.rejected} rejected (bodies hash-checked against signed commitments)`
    : ''
  const lines: string[] = [`ATRIB CONTINUATION PACKET`, `context_id: ${contextId}   chain_tail: ${chainTail}`, verifyLine, ``]
  records.forEach((r, i) => idByHash.set('sha256:' + recordHashHex(r), `R${i + 1}`))
  if (render === 'hashes_only') {
    lines.push(`Prior-session records (Tier 1 commitments only, no bodies available):`)
    records.forEach((r, i) => lines.push(`[R${i + 1}] sha256:${recordHashHex(r)}`))
    return lines.join('\n')
  }
  lines.push(
    failed
      ? `Findings claimed by this (UNVERIFIED) packet:`
      : `Verified prior-session findings (each a signed record; body retrieved and hash-checked):`,
  )
  records.forEach((r, i) => {
    const body = bodyByHash.get('sha256:' + recordHashHex(r))
    const inf = (r as { informed_by?: string[] }).informed_by ?? []
    const infRefs = render === 'full' && inf.length ? ` (informed_by: ${inf.map((h) => idByHash.get(h) ?? h.slice(0, 14)).join(', ')})` : ''
    lines.push(`[R${i + 1}]${infRefs} query="${body?.query ?? ''}" result="${body?.result ?? ''}"`)
  })
  return lines.join('\n')
}
