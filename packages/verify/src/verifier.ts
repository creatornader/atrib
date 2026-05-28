// SPDX-License-Identifier: Apache-2.0

/**
 * AtribVerifier. the merchant verification class (§5.5).
 *
 * Provides:
 *   - verify(recommendationDoc) → independently reproduces calculation (§5.5.2)
 *   - calculate({ context_id, policy, signWith }) → post-hoc calculation (§5.5.3)
 *
 * Per §5.8 degradation contract: never throws on missing keys, returns warnings instead.
 */

import { base64urlDecode } from '@atrib/mcp'
import { calculate, DEFAULT_POLICY } from './calculate.js'
import { fetchGraph, fetchSessionPolicyRecord, fetchPolicyDocument } from './graph-fetch.js'
import {
  signRecommendation,
  verifyRecommendationSignature,
  distributionsMatch,
} from './recommendation.js'
import { verifyAp2ViEvidenceAsync } from './ap2-vi-evidence.js'
import type {
  Ap2ViEvidenceBundle,
  Ap2ViEvidenceVerification,
  VerifyAp2ViEvidenceOptions,
} from './ap2-vi-evidence.js'
import type {
  PolicyDocument,
  RecommendationDocument,
  SessionPolicyRecord,
  VerificationResult,
} from './types.js'

const DEFAULT_LOG_ENDPOINT = 'https://log.atrib.dev/v1'
const DEFAULT_GRAPH_ENDPOINT = 'https://graph.atrib.dev/v1'
const DEFAULT_RESOLVE_ENDPOINT = 'https://resolve.atrib.dev/v1'

/** Init options for AtribVerifier (§5.5.1). */
export interface AtribVerifierOptions {
  logEndpoint?: string
  graphEndpoint?: string
  resolveEndpoint?: string
  /** Base64url Ed25519 32-byte seed. Optional. verify() works without it. */
  merchantKey?: string
}

/** Options for post-hoc calculation (§5.5.3). */
export interface CalculateOptions {
  context_id: string
  /** A policy document, or "default" to use the §4.3 default policy. */
  policy: PolicyDocument | 'default'
  /** Whether to sign the result with merchantKey. */
  signWith?: 'merchant'
  /** Optional pin to a specific log tree size. */
  treeSize?: number
}

/** Options for settlement recommendation verification (§5.5.2). */
export interface VerifyRecommendationOptions {
  /**
   * Caller-supplied AP2 / Verifiable Intent evidence for the transaction
   * represented by the recommendation document. Evidence verification is
   * tiered and attaches as `ap2_vi_evidence`; it does not change the base
   * recommendation signature or calculation checks.
   */
  ap2ViEvidence?: Ap2ViEvidenceBundle
  /** Options passed through to `verifyAp2ViEvidenceAsync()`. */
  ap2ViEvidenceOptions?: VerifyAp2ViEvidenceOptions
}

export class AtribVerifier {
  private readonly logEndpoint: string
  private readonly graphEndpoint: string
  private readonly merchantPrivateKey: Uint8Array | null

  constructor(options: AtribVerifierOptions = {}) {
    this.logEndpoint = options.logEndpoint ?? DEFAULT_LOG_ENDPOINT
    this.graphEndpoint = options.graphEndpoint ?? DEFAULT_GRAPH_ENDPOINT
    // resolveEndpoint reserved for v2 remote-calculation API
    void (options.resolveEndpoint ?? DEFAULT_RESOLVE_ENDPOINT)

    let key: Uint8Array | null = null
    if (options.merchantKey) {
      try {
        const decoded = base64urlDecode(options.merchantKey)
        if (decoded.length === 32) {
          key = decoded
        } else {
          console.warn('atrib: merchantKey must be 32 bytes; recommendations will be unsigned')
        }
      } catch {
        console.warn('atrib: failed to decode merchantKey; recommendations will be unsigned')
      }
    }
    this.merchantPrivateKey = key
  }

  /**
   * Verify a settlement recommendation (§5.5.2).
   *
   * Steps:
   *   1. Verify Ed25519 signature using calculated_by's public key (looked up
   *      via the resolve service when calculated_by is a known service URL,
   *      or assumed to be the merchant key when calculated_by is "local").
   *   2. Fetch the graph at graph_tree_size.
   *   3. Fetch the session policy record (or use default if "default").
   *   4. Run calculate() locally and compare distributions within 1e-9.
   */
  async verify(
    doc: RecommendationDocument,
    options: VerifyRecommendationOptions = {},
  ): Promise<VerificationResult> {
    const warnings: string[] = []
    let signatureOk = false
    let calcMatch = false
    let localDistribution = doc.distribution
    let nodeCount = 0
    let ap2ViEvidence: Ap2ViEvidenceVerification | undefined

    // Step 1: signature
    try {
      const pubKey = await this.resolveCalculatedByPublicKey(doc.calculated_by)
      if (!pubKey) {
        warnings.push(`unknown calculated_by; cannot verify signature: ${doc.calculated_by}`)
      } else {
        signatureOk = await verifyRecommendationSignature(doc, pubKey)
        if (!signatureOk) warnings.push('signature verification failed')
      }
    } catch (err) {
      warnings.push(`signature verification error: ${(err as Error).message}`)
    }

    // Step 2 & 3 & 4: re-run calculation
    try {
      const graph = await fetchGraph(this.graphEndpoint, doc.context_id, doc.graph_tree_size)
      nodeCount = graph.node_count

      let policyRecord: SessionPolicyRecord | null = null
      let policy: PolicyDocument = DEFAULT_POLICY
      if (doc.policy_record_id !== 'default') {
        try {
          policyRecord = await fetchSessionPolicyRecord(this.graphEndpoint, doc.policy_record_id)
          if (policyRecord.agreed_policy && policyRecord.agreed_policy !== 'default') {
            try {
              policy = await fetchPolicyDocument(policyRecord.agreed_policy)
            } catch {
              warnings.push(
                `failed to fetch agreed policy ${policyRecord.agreed_policy}, falling back to default`,
              )
            }
          }
        } catch {
          warnings.push(
            `failed to fetch session policy record ${doc.policy_record_id}, falling back to default`,
          )
        }
      }

      localDistribution = calculate(graph, policy, policyRecord)
      calcMatch = distributionsMatch(localDistribution, doc.distribution)
      if (!calcMatch) {
        warnings.push('local recalculation does not match document distribution')
      }
    } catch (err) {
      warnings.push(`graph fetch or calculation error: ${(err as Error).message}`)
    }

    if (options.ap2ViEvidence !== undefined) {
      try {
        ap2ViEvidence = await verifyAp2ViEvidenceAsync(
          options.ap2ViEvidence,
          options.ap2ViEvidenceOptions,
        )
      } catch (err) {
        ap2ViEvidence = ap2ViEvidenceErrorResult(err)
      }
    }

    return {
      valid: signatureOk && calcMatch,
      signatureOk,
      calcMatch,
      distribution: localDistribution,
      warnings,
      graph_node_count: nodeCount,
      ...(ap2ViEvidence ? { ap2_vi_evidence: ap2ViEvidence } : {}),
    }
  }

  /**
   * Post-hoc calculation when no agent SDK was present (§5.5.3).
   *
   * Always returns a recommendation document. If signWith === "merchant" but
   * no merchantKey is set, the document is returned UNSIGNED with a warning
   * (degradation contract §5.8: never throws due to a missing key).
   */
  async calculate(options: CalculateOptions): Promise<RecommendationDocument> {
    const warnings: string[] = []
    const policy: PolicyDocument = options.policy === 'default' ? DEFAULT_POLICY : options.policy

    // graph_checkpoint records the log origin, not a full signed checkpoint.
    // A full checkpoint would require fetching GET /v1/checkpoint from the log,
    // which is not available in the post-hoc path. The origin string is
    // sufficient for identifying which log the data came from.
    const graphCheckpoint = this.logEndpoint
    let treeSize = options.treeSize ?? 0
    let distribution: Record<string, number> = {}
    let transactionId = ''
    let maxTotalShare: number | null = null

    try {
      const graph = await fetchGraph(this.graphEndpoint, options.context_id, options.treeSize)
      treeSize = options.treeSize ?? 0 // 0 = unpinned; caller should supply treeSize for reproducible verification
      const txNode = graph.nodes.find((n) => n.event_type === 'transaction')
      if (!txNode) {
        warnings.push('no transaction node found in graph; distribution is empty')
      } else {
        transactionId = txNode.id
      }
      distribution = calculate(graph, policy, null)
      maxTotalShare = policy.constraints?.maximum_total_share ?? null
    } catch (err) {
      warnings.push(`graph fetch or calculation error: ${(err as Error).message}`)
    }

    const unsigned: Omit<RecommendationDocument, 'signature'> = {
      spec_version: 'atrib/1.0',
      document_type: 'settlement_recommendation',
      context_id: options.context_id,
      transaction_id: transactionId,
      policy_record_id: options.policy === 'default' ? 'default' : (policy.policy_id ?? 'default'),
      graph_checkpoint: graphCheckpoint,
      graph_tree_size: treeSize,
      calculated_at: Date.now(),
      calculated_by: 'local',
      distribution,
      maximum_total_share: maxTotalShare,
      warnings,
    }

    if (options.signWith === 'merchant') {
      if (!this.merchantPrivateKey) {
        warnings.push('merchantKey not set. Recommendation unsigned')
        return { ...unsigned, signature: '' }
      }
      try {
        return await signRecommendation(unsigned, this.merchantPrivateKey)
      } catch (err) {
        warnings.push(`signing failed: ${(err as Error).message}`)
        return { ...unsigned, signature: '' }
      }
    }
    return { ...unsigned, signature: '' }
  }

  /**
   * Resolve the public key for a `calculated_by` URL.
   *
   * For v1: only "local" (returns null. caller must supply key separately or
   * accept signatureOk=false) and the well-known atrib resolve endpoint are
   * supported. Future revisions may add a key directory.
   */
  private async resolveCalculatedByPublicKey(calculatedBy: string): Promise<string | null> {
    if (calculatedBy === 'local') {
      // For "local", the merchant signed it themselves. but we have no way
      // to know which merchant. Caller would need to supply the public key
      // out-of-band. Return null to surface this.
      return null
    }
    // atrib resolution service publishes its key at /pubkey.
    // Validate hostname to prevent SSRF via crafted calculated_by URLs.
    try {
      const parsed = new URL(calculatedBy)
      if (parsed.protocol !== 'https:' || parsed.hostname !== 'resolve.atrib.dev') {
        return null
      }
      const url = `${calculatedBy.replace(/\/$/, '')}/pubkey`
      const res = await fetch(url)
      if (!res.ok) return null
      const text = (await res.text()).trim()
      return text
    } catch {
      return null
    }
  }
}

function ap2ViEvidenceErrorResult(err: unknown): Ap2ViEvidenceVerification {
  const message = err instanceof Error ? err.message : String(err)
  return {
    valid: false,
    transactionAccepted: false,
    ap2: {},
    vi: {
      mode: 'unknown',
      credentials: [],
      delegationOk: null,
      checkoutPaymentBindingOk: null,
      constraints: { status: 'not_checked', checks: [] },
    },
    errors: [`ap2_vi_evidence verification error: ${message}`],
    warnings: [],
  }
}
