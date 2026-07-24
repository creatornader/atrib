// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from 'vitest'
import {
  createToolNameCommitment,
  runVerifiableAction,
  verifyJsonCommitment,
  type AttestInput,
  type AttestResult,
} from '../src/index.js'

const REQUEST_HASH = `sha256:${'a'.repeat(64)}`
const OUTCOME_HASH = `sha256:${'b'.repeat(64)}`
const CONTEXT_ID = 'c'.repeat(32)

function signedResult(record_hash: string): AttestResult {
  return {
    record_hash,
    context_id: CONTEXT_ID,
    log_index: null,
    inclusion_proof: null,
    via: 'in-process',
    warnings: [],
  }
}

describe('runVerifiableAction', () => {
  it('signs a request before execution and a linked successful outcome', async () => {
    const calls: AttestInput[] = []
    const order: string[] = []
    const attest = vi.fn(async (input: AttestInput) => {
      calls.push(input)
      order.push(`attest:${String(input.content['action_phase'])}`)
      return signedResult(calls.length === 1 ? REQUEST_HASH : OUTCOME_HASH)
    })

    const result = await runVerifiableAction(attest, {
      name: 'write_invoice',
      args: { invoice_id: 'inv-7', cents: 1200 },
      execute: ({ request }) => {
        order.push(`execute:${request.record_hash}`)
        return { accepted: true }
      },
    })

    expect(result.ok).toBe(true)
    expect(order).toEqual(['attest:request', `execute:${REQUEST_HASH}`, 'attest:outcome'])
    expect(calls).toHaveLength(2)
    expect(calls[0]).toMatchObject({
      event_type: 'tool_call',
      tool_name: createToolNameCommitment('write_invoice'),
      content: {
        action_phase: 'request',
        tool_name: 'write_invoice',
        args: { invoice_id: 'inv-7', cents: 1200 },
      },
    })
    expect(calls[0]?.args_hash).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(calls[0]?.args_salt).toMatch(/^[A-Za-z0-9_-]{22}$/)
    expect(
      verifyJsonCommitment(
        { invoice_id: 'inv-7', cents: 1200 },
        { hash: calls[0]!.args_hash!, salt: calls[0]!.args_salt },
      ),
    ).toBe(true)
    expect(calls[1]).toMatchObject({
      context_id: CONTEXT_ID,
      chain_root: REQUEST_HASH,
      informed_by: [REQUEST_HASH],
      args_hash: calls[0]?.args_hash,
      args_salt: calls[0]?.args_salt,
      content: {
        action_phase: 'outcome',
        is_error: false,
        result: { accepted: true },
      },
    })
    expect(calls[1]?.result_hash).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(calls[1]?.result_salt).toMatch(/^[A-Za-z0-9_-]{22}$/)
    expect(
      verifyJsonCommitment(
        { accepted: true },
        { hash: calls[1]!.result_hash!, salt: calls[1]!.result_salt },
      ),
    ).toBe(true)
  })

  it('signs a linked failure outcome and returns the application error', async () => {
    const calls: AttestInput[] = []
    const attest = async (input: AttestInput): Promise<AttestResult> => {
      calls.push(input)
      return signedResult(calls.length === 1 ? REQUEST_HASH : OUTCOME_HASH)
    }
    const applicationError = new Error('bank unavailable')

    const result = await runVerifiableAction(attest, {
      name: 'send_payment',
      args: { cents: 300 },
      execute: () => {
        throw applicationError
      },
    })

    expect(result).toMatchObject({
      ok: false,
      error: applicationError,
      request: { record_hash: REQUEST_HASH },
      outcome: { record_hash: OUTCOME_HASH },
    })
    expect(calls[1]).toMatchObject({
      chain_root: REQUEST_HASH,
      informed_by: [REQUEST_HASH],
      content: {
        action_phase: 'outcome',
        is_error: true,
        result: {
          isError: true,
          error: { name: 'Error', message: 'bank unavailable' },
        },
      },
    })
  })

  it('keeps executing when request signing degrades', async () => {
    const degraded: AttestResult = {
      record_hash: null,
      context_id: null,
      log_index: null,
      inclusion_proof: null,
      via: 'none',
      warnings: ['no signer'],
    }
    let executed = false
    const result = await runVerifiableAction(async () => degraded, {
      name: 'local_only',
      args: {},
      execute: () => {
        executed = true
        return null
      },
    })

    expect(executed).toBe(true)
    expect(result.ok).toBe(true)
    expect(result.request.record_hash).toBeNull()
    expect(result.outcome.record_hash).toBeNull()
  })
})
