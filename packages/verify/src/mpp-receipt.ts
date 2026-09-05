// SPDX-License-Identifier: Apache-2.0

/**
 * Structural inspection for Machine Payments Protocol receipts.
 *
 * These helpers inspect the public receipt shape only. They do not verify a
 * payment method, wallet, facilitator, PSP, signature, or settlement rail.
 */

export interface MppReceipt {
  status: 'success'
  method: string
  timestamp: string
  reference?: string
  challengeId?: string
}

export interface MppReceiptInspection {
  /** Structural parsing is declared evidence, not settlement verification. */
  evidence: 'declared' | 'malformed'
  receipt: MppReceipt | null
  errors: string[]
}

export interface MppReceiptInspectionOptions {
  /** HTTP receipts require the IETF draft's method-specific reference. */
  requireReference?: boolean
  /** MCP receipts require the challenge that was fulfilled. */
  requireChallengeId?: boolean
}

const RFC3339_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/
const MCP_RECEIPT_META_KEY = 'org.paymentauth/receipt'

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function malformed(errors: string[]): MppReceiptInspection {
  return { evidence: 'malformed', receipt: null, errors }
}

/** Inspect the common MPP receipt object shape. */
export function inspectMppReceipt(
  value: unknown,
  options: MppReceiptInspectionOptions = {},
): MppReceiptInspection {
  if (!isRecord(value)) return malformed(['mpp_receipt_not_object'])

  const errors: string[] = []
  if (value['status'] !== 'success') errors.push('mpp_receipt_status_not_success')
  if (!isNonEmptyString(value['method'])) errors.push('mpp_receipt_method_missing')
  if (
    !isNonEmptyString(value['timestamp']) ||
    !RFC3339_TIMESTAMP.test(value['timestamp']) ||
    Number.isNaN(Date.parse(value['timestamp']))
  ) {
    errors.push('mpp_receipt_timestamp_invalid')
  }
  if (options.requireReference && !isNonEmptyString(value['reference'])) {
    errors.push('mpp_receipt_reference_missing')
  } else if (value['reference'] !== undefined && !isNonEmptyString(value['reference'])) {
    errors.push('mpp_receipt_reference_invalid')
  }
  if (options.requireChallengeId && !isNonEmptyString(value['challengeId'])) {
    errors.push('mpp_receipt_challenge_id_missing')
  } else if (value['challengeId'] !== undefined && !isNonEmptyString(value['challengeId'])) {
    errors.push('mpp_receipt_challenge_id_invalid')
  }

  if (errors.length > 0) return malformed(errors)

  const receipt: MppReceipt = {
    status: 'success',
    method: value['method'] as string,
    timestamp: value['timestamp'] as string,
    ...(value['reference'] !== undefined ? { reference: value['reference'] as string } : {}),
    ...(value['challengeId'] !== undefined ? { challengeId: value['challengeId'] as string } : {}),
  }
  return { evidence: 'declared', receipt, errors: [] }
}

/** Inspect an HTTP Payment-Receipt object after decoding its header value. */
export function inspectMppHttpReceipt(value: unknown): MppReceiptInspection {
  return inspectMppReceipt(value, { requireReference: true })
}

/** Inspect the receipt at the MPP MCP result metadata location. */
export function inspectMppMcpResult(result: unknown): MppReceiptInspection {
  if (!isRecord(result)) return malformed(['mpp_mcp_receipt_missing'])

  const metadataCandidates: Record<string, unknown>[] = []
  if (isRecord(result['_meta'])) metadataCandidates.push(result['_meta'])
  if (isRecord(result['result']) && isRecord(result['result']['_meta'])) {
    metadataCandidates.push(result['result']['_meta'])
  }
  for (const metadata of metadataCandidates) {
    if (MCP_RECEIPT_META_KEY in metadata) {
      return inspectMppReceipt(metadata[MCP_RECEIPT_META_KEY], { requireChallengeId: true })
    }
  }
  return malformed(['mpp_mcp_receipt_missing'])
}

/** Decode and inspect an HTTP Payment-Receipt header value. */
export function inspectMppHttpReceiptHeader(value: string): MppReceiptInspection {
  if (!isNonEmptyString(value)) return malformed(['mpp_receipt_header_empty'])

  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
    if (normalized.length % 4 === 1) {
      return malformed(['mpp_receipt_header_invalid_encoding'])
    }
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=')
    const binary = atob(padded)
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    const decoded = JSON.parse(new TextDecoder().decode(bytes)) as unknown
    return inspectMppHttpReceipt(decoded)
  } catch {
    return malformed(['mpp_receipt_header_invalid_encoding'])
  }
}
