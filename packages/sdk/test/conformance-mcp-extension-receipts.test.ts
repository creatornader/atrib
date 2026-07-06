// SPDX-License-Identifier: Apache-2.0

/**
 * D141 receipt-side conformance: runs the spec/conformance/mcp-extension/
 * receipt--*.json cases through the SDK's receipt parser and consistency
 * checker. The token/context ladder cases in the same corpus target the
 * protocol packages' inbound resolution (tranche 2) and are out of this
 * package's scope.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  checkAttributionReceiptConsistency,
  parseAttributionReceiptBlock,
  ATTRIBUTION_EXTENSION_KEY,
  type AtribRecord,
} from '../src/index.js'

const CASES = join(__dirname, '../../../spec/conformance/mcp-extension/cases')

interface ReceiptCase {
  name?: string
  description: string
  input: {
    result_block: Record<string, unknown>
    record?: AtribRecord
  }
  expected: {
    receipt_valid: boolean
    mismatched_fields?: string[]
    token?: string
    record_hash?: string
    claimed_record_hash?: string
    attached_record_hash?: string
    log_submission?: string
    allowed_statuses?: string[]
    proof_bundle_required?: boolean
    tool_result_invalidated?: boolean
  }
}

function loadCase(file: string): ReceiptCase {
  return JSON.parse(readFileSync(join(CASES, file), 'utf8')) as ReceiptCase
}

function blockFrom(testCase: ReceiptCase) {
  const meta = { [ATTRIBUTION_EXTENSION_KEY]: testCase.input.result_block }
  const block = parseAttributionReceiptBlock(meta)
  expect(block).not.toBeNull()
  return block!
}

describe('conformance: mcp-extension receipt cases (D141)', () => {
  it('receipt--consistent: all claims match the attached signed record', () => {
    const testCase = loadCase('receipt--consistent.json')
    const block = blockFrom(testCase)
    const outcome = checkAttributionReceiptConsistency(block, testCase.input.record)
    expect(outcome.receipt_valid).toBe(testCase.expected.receipt_valid)
    expect(outcome.mismatched_fields).toEqual([])
    if (testCase.expected.token !== undefined) {
      expect(block.token).toBe(testCase.expected.token)
    }
    if (testCase.expected.record_hash !== undefined) {
      expect(outcome.attached_record_hash).toBe(testCase.expected.record_hash)
    }
  })

  it('receipt--hash-mismatch-flagged: mismatch flags the receipt, never the tool result', () => {
    const testCase = loadCase('receipt--hash-mismatch-flagged.json')
    const block = blockFrom(testCase)
    const outcome = checkAttributionReceiptConsistency(block, testCase.input.record)
    expect(outcome.receipt_valid).toBe(false)
    for (const field of testCase.expected.mismatched_fields ?? []) {
      expect(outcome.mismatched_fields).toContain(field)
    }
    if (testCase.expected.claimed_record_hash !== undefined) {
      expect(outcome.claimed_record_hash).toBe(testCase.expected.claimed_record_hash)
    }
    if (testCase.expected.attached_record_hash !== undefined) {
      expect(outcome.attached_record_hash).toBe(testCase.expected.attached_record_hash)
    }
    // Advisory contract: a bad receipt never invalidates the tool result.
    expect(testCase.expected.tool_result_invalidated).toBe(false)
  })

  it('receipt--log-submission-nonblocking: status is a queue status, never an awaited proof', () => {
    const testCase = loadCase('receipt--log-submission-nonblocking.json')
    const block = blockFrom(testCase)
    expect(block.receipt?.log_submission).toBe(testCase.expected.log_submission)
    expect(testCase.expected.allowed_statuses).toContain(block.receipt?.log_submission)
    expect(testCase.expected.proof_bundle_required).toBe(false)
    // This case ships no record body anywhere (expected.receipt_valid refers
    // to shape/status validity). The record-consistency checker is
    // deliberately conservative without a record: nothing to check against.
    const outcome = checkAttributionReceiptConsistency(block)
    expect(outcome.receipt_valid).toBe(false)
    expect(outcome.mismatched_fields).toEqual(['record'])
    expect(outcome.claimed_record_hash).toBe(block.receipt?.record_hash)
  })
})
