import { describe, expect, it } from 'vitest'
import {
  inspectMppHttpReceipt,
  inspectMppHttpReceiptHeader,
  inspectMppMcpResult,
  inspectMppReceipt,
} from '../src/mpp-receipt.js'

const receipt = {
  status: 'success',
  method: 'tempo',
  timestamp: '2026-09-02T12:00:15Z',
  reference: '0xtx789',
}

describe('MPP receipt inspection', () => {
  it('inspects the common receipt object as declared evidence', () => {
    expect(inspectMppReceipt(receipt)).toEqual({ evidence: 'declared', receipt, errors: [] })
  })

  it('requires reference for the HTTP receipt shape', () => {
    expect(inspectMppHttpReceipt({ ...receipt, reference: undefined })).toMatchObject({
      evidence: 'malformed',
      receipt: null,
      errors: ['mpp_receipt_reference_missing'],
    })
  })

  it('decodes and inspects a base64url HTTP Payment-Receipt header', () => {
    const encoded = Buffer.from(JSON.stringify(receipt)).toString('base64url')
    expect(inspectMppHttpReceiptHeader(encoded)).toEqual({
      evidence: 'declared',
      receipt,
      errors: [],
    })
  })

  it('inspects the official MCP result metadata shape', () => {
    const mcpReceipt = { ...receipt, challengeId: 'ch_mcp_789' }
    expect(
      inspectMppMcpResult({
        content: [{ type: 'text', text: 'paid result' }],
        _meta: { 'org.paymentauth/receipt': mcpReceipt },
      }),
    ).toEqual({ evidence: 'declared', receipt: mcpReceipt, errors: [] })
  })

  it('also accepts a full JSON-RPC response with nested result metadata', () => {
    const mcpReceipt = { ...receipt, challengeId: 'ch_mcp_789' }
    expect(
      inspectMppMcpResult({
        result: { content: [], _meta: { 'org.paymentauth/receipt': mcpReceipt } },
      }),
    ).toEqual({ evidence: 'declared', receipt: mcpReceipt, errors: [] })
  })

  it('finds nested receipt metadata when root metadata is unrelated', () => {
    const mcpReceipt = { ...receipt, challengeId: 'ch_mcp_789' }
    expect(
      inspectMppMcpResult({
        _meta: { unrelated: true },
        result: { _meta: { 'org.paymentauth/receipt': mcpReceipt } },
      }),
    ).toEqual({ evidence: 'declared', receipt: mcpReceipt, errors: [] })
  })

  it.each([
    [{ ...receipt, status: 'failed' }, 'mpp_receipt_status_not_success'],
    [{ ...receipt, timestamp: 'not-a-date' }, 'mpp_receipt_timestamp_invalid'],
    [{ ...receipt, timestamp: '2026-09-02' }, 'mpp_receipt_timestamp_invalid'],
  ])('rejects malformed receipt %#', (candidate, error) => {
    expect(inspectMppReceipt(candidate)).toMatchObject({
      evidence: 'malformed',
      receipt: null,
      errors: [error],
    })
  })

  it('rejects an MCP receipt without its challenge id', () => {
    expect(inspectMppMcpResult({ _meta: { 'org.paymentauth/receipt': receipt } })).toMatchObject({
      evidence: 'malformed',
      receipt: null,
      errors: ['mpp_receipt_challenge_id_missing'],
    })
  })

  it('does not claim universal settlement verification', () => {
    const result = inspectMppReceipt(receipt)
    expect(result).not.toHaveProperty('verified')
    expect(result).not.toHaveProperty('valid')
  })
})
