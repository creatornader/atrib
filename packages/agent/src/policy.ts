/**
 * Policy negotiation and session policy record (§4.5, §5.4.2, §5.4.6).
 */

import { sha256, hexEncode } from '@atrib/mcp'
import canonicalize from 'canonicalize'

const POLICY_FETCH_TIMEOUT_MS = 1000
const INIT_BUDGET_MS = 3000
const POLICY_PATH = '/.well-known/atrib-policy.json'

/** A fetched policy document (§4.2). */
export interface PolicyDocument {
  spec_version: string
  edge_weights?: Record<string, number>
  modifiers?: unknown[]
  constraints?: {
    minimum_share?: number
    maximum_share?: number
    minimum_own_share?: number
    maximum_total_share?: number
  }
}

/** Creator policy entry in the session policy record. */
export interface CreatorPolicyEntry {
  server_url: string
  policy_url: string
  status: 'compatible' | 'floor_scaled' | 'conflict_defaulted' | 'not_found'
  policy?: PolicyDocument | undefined
}

/** The session policy record (§4.5.3). */
export interface SessionPolicyRecord {
  spec_version: 'atrib/1.0'
  record_id: string
  context_id: string
  created_at: number
  merchant_policy: string
  creator_policies: CreatorPolicyEntry[]
  agreed_policy: string
  applied_constraints: {
    minimum_floors: Record<string, number>
  }
  warnings: string[]
}

/**
 * Fetch a policy document from a URL with timeout.
 * Returns null on any error (404, timeout, parse error).
 */
async function fetchPolicy(url: string): Promise<PolicyDocument | null> {
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), POLICY_FETCH_TIMEOUT_MS)

    const response = await fetch(url, { signal: controller.signal })
    clearTimeout(timeoutId)

    if (!response.ok) return null

    const doc = (await response.json()) as PolicyDocument

    // §4.5.2 Rule 6: reject contradictory constraints
    if (doc.constraints) {
      const { minimum_share, maximum_share } = doc.constraints
      if (
        minimum_share !== undefined &&
        maximum_share !== undefined &&
        minimum_share > maximum_share
      ) {
        return null
      }
      // Reject negative values
      for (const val of Object.values(doc.constraints)) {
        if (typeof val === 'number' && val < 0) return null
      }
    }

    return doc
  } catch {
    return null
  }
}

/** Options for session initialization. */
export interface PolicyInitOptions {
  contextId: string
  merchantDomain?: string | undefined
  /** Server URLs for all tools the agent intends to call. */
  serverUrls?: string[] | undefined
}

/**
 * Run session initialization: fetch policies and negotiate (§5.4.2).
 * Must complete within 3 seconds.
 */
export async function initializeSessionPolicy(
  options: PolicyInitOptions,
): Promise<SessionPolicyRecord> {
  const warnings: string[] = []
  const startTime = Date.now()

  // Step 1: Fetch merchant policy
  let merchantPolicyDoc: PolicyDocument | null = null
  let merchantPolicyUrl = 'default'
  if (options.merchantDomain) {
    merchantPolicyUrl = `${options.merchantDomain}${POLICY_PATH}`
    merchantPolicyDoc = await fetchPolicy(merchantPolicyUrl)
    if (!merchantPolicyDoc) {
      merchantPolicyUrl = 'default'
      warnings.push(`merchant policy not found at ${options.merchantDomain}${POLICY_PATH}`)
    }
  }

  // Step 2: Fetch creator policies concurrently (§5.4.2 step 4)
  const creatorEntries: CreatorPolicyEntry[] = []
  if (options.serverUrls && options.serverUrls.length > 0) {
    const fetches = options.serverUrls.map(async (serverUrl) => {
      const policyUrl = `${serverUrl}${POLICY_PATH}`
      const doc = await fetchPolicy(policyUrl)
      return { serverUrl, policyUrl, doc }
    })

    const results = await Promise.allSettled(fetches)
    for (const result of results) {
      if (result.status === 'fulfilled') {
        const { serverUrl, policyUrl, doc } = result.value
        creatorEntries.push({
          server_url: serverUrl,
          policy_url: policyUrl,
          status: doc ? 'compatible' : 'not_found',
          ...(doc ? { policy: doc } : {}),
        })
      }
    }
  }

  // Check init budget
  if (Date.now() - startTime > INIT_BUDGET_MS) {
    warnings.push('negotiation_skipped: session initialization exceeded 3-second budget')
    return buildSessionPolicyRecord(options.contextId, 'default', creatorEntries, {}, warnings)
  }

  // Step 3: Conflict resolution (§4.5.2)
  const { agreedPolicy, minimumFloors, negotiationWarnings } = negotiatePolicies(
    merchantPolicyDoc,
    merchantPolicyUrl,
    creatorEntries,
  )
  warnings.push(...negotiationWarnings)

  return buildSessionPolicyRecord(
    options.contextId,
    agreedPolicy,
    creatorEntries,
    minimumFloors,
    warnings,
  )
}

/** Run the 7-rule conflict resolution (§4.5.2). */
function negotiatePolicies(
  merchantPolicy: PolicyDocument | null,
  merchantPolicyUrl: string,
  creatorEntries: CreatorPolicyEntry[],
): {
  agreedPolicy: string
  minimumFloors: Record<string, number>
  negotiationWarnings: string[]
} {
  const warnings: string[] = []
  const minimumFloors: Record<string, number> = {}

  const merchantCap = merchantPolicy?.constraints?.maximum_total_share

  // Collect creator floors
  let floorSum = 0
  for (const entry of creatorEntries) {
    if (entry.policy?.constraints?.minimum_own_share !== undefined) {
      const floor = entry.policy.constraints.minimum_own_share
      minimumFloors[entry.server_url] = floor
      floorSum += floor
    }
  }

  // Rule 5: Creator floors summing to >1.0 are irreconcilable
  if (floorSum > 1.0) {
    warnings.push(
      `creator minimum floors sum to ${floorSum} (>1.0), falling back to default policy. ` +
        `Contributors: ${Object.keys(minimumFloors).join(', ')}`,
    )
    for (const entry of creatorEntries) {
      if (entry.status === 'compatible' && entry.policy) {
        entry.status = 'conflict_defaulted'
      }
    }
    return { agreedPolicy: 'default', minimumFloors: {}, negotiationWarnings: warnings }
  }

  // Rule 3: Check if single creator floor exceeds merchant cap (BEFORE scaling)
  // Must check before Rule 2 scaling, a single floor > cap is irreconcilable
  if (merchantCap !== undefined) {
    for (const entry of creatorEntries) {
      const floor = entry.policy?.constraints?.minimum_own_share
      if (floor !== undefined && floor > merchantCap) {
        warnings.push(
          `creator ${entry.server_url} minimum floor ${floor} exceeds merchant cap ${merchantCap}, ` +
            `falling back to default`,
        )
        for (const e of creatorEntries) {
          if (e.status !== 'not_found') e.status = 'conflict_defaulted'
        }
        return { agreedPolicy: 'default', minimumFloors: {}, negotiationWarnings: warnings }
      }
    }
  }

  // Rule 1 & 2: Merchant cap + creator floor scaling
  // Multiple floors that individually fit the cap but sum > cap get scaled down proportionally
  if (merchantCap !== undefined && floorSum > merchantCap) {
    const scaleFactor = merchantCap / floorSum
    for (const [url, floor] of Object.entries(minimumFloors)) {
      minimumFloors[url] = floor * scaleFactor
    }
    warnings.push(
      `creator minimum floors scaled by ${scaleFactor.toFixed(4)} to fit merchant cap of ${merchantCap}`,
    )
    for (const entry of creatorEntries) {
      if (entry.status === 'compatible' && minimumFloors[entry.server_url] !== undefined) {
        entry.status = 'floor_scaled'
      }
    }
  }

  // Rule 4: Edge weight disagreements, merchant governs (advisory only for creators)

  const agreedPolicy = merchantPolicyUrl !== 'default' ? merchantPolicyUrl : 'default'
  return { agreedPolicy, minimumFloors, negotiationWarnings: warnings }
}

/** Build the session policy record (§4.5.3). */
function buildSessionPolicyRecord(
  contextId: string,
  agreedPolicy: string,
  creatorEntries: CreatorPolicyEntry[],
  minimumFloors: Record<string, number>,
  warnings: string[],
): SessionPolicyRecord {
  // Build the record without record_id first, then compute it
  const record = {
    spec_version: 'atrib/1.0' as const,
    record_id: '', // placeholder
    context_id: contextId,
    created_at: Date.now(),
    merchant_policy: agreedPolicy === 'default' ? 'default' : agreedPolicy,
    creator_policies: creatorEntries.map(({ server_url, policy_url, status }) => ({
      server_url,
      policy_url,
      status,
    })),
    agreed_policy: agreedPolicy,
    applied_constraints: {
      minimum_floors: minimumFloors,
    },
    warnings,
  }

  // Compute record_id = sha256 of JCS canonical form (excluding record_id)
  const { record_id: _, ...forHashing } = record
  const canonical = canonicalize(forHashing)
  if (canonical) {
    const encoder = new TextEncoder()
    const hash = sha256(encoder.encode(canonical))
    record.record_id = `sha256:${hexEncode(hash)}`
  }

  return record
}
