// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  FIXTURE_CREDENTIAL,
  recordHash,
  runBrokeredSignInReceiptSmoke,
} from '../src/brokered-sign-in-receipt.js'

describe('brokered sign-in receipt', () => {
  it('links every later action to the signed broker outcome when release is granted', async () => {
    const result = await runBrokeredSignInReceiptSmoke({ outcome: 'granted' })

    expect(result.broker_outcome).toBe('granted')
    expect(result.operations).toEqual([
      'browser.action.credential',
      'browser.action.submit',
      'browser.action.observe',
    ])
    expect(recordHash(result.records[0]!)).toBe(result.credential_record_hash)
    expect(result.records[0]!.informed_by).toBeUndefined()
    for (const record of result.records.slice(1)) {
      expect(record.informed_by).toEqual([result.credential_record_hash])
    }
    expect(result.later_actions_cite_credential_record).toBe(true)
  })

  it('takes no later action when release is denied', async () => {
    const result = await runBrokeredSignInReceiptSmoke({ outcome: 'denied' })

    expect(result.broker_outcome).toBe('denied')
    expect(result.operations).toEqual(['browser.action.credential'])
    expect(result.sidecars[0]).toMatchObject({ status: 'ok', result: { outcome: 'denied' } })
  })

  it('signs a broker failure as an error outcome and stops', async () => {
    const result = await runBrokeredSignInReceiptSmoke({ brokerAvailable: false })

    expect(result.broker_outcome).toBe('unavailable')
    expect(result.operations).toEqual(['browser.action.credential'])
    expect(result.sidecars[0]).toMatchObject({
      status: 'error',
      error: { message: 'fixture broker unavailable' },
    })
  })

  it('never writes the credential, site, or item reference into signed records or sidecars', async () => {
    for (const outcome of ['granted', 'denied'] as const) {
      const result = await runBrokeredSignInReceiptSmoke({ outcome })
      const all = JSON.stringify(result)
      expect(all).not.toContain(FIXTURE_CREDENTIAL)
      const signed = JSON.stringify(result.records)
      expect(signed).not.toContain('demo.browser-agent.local')
      expect(signed).not.toContain('fixture-item:demo-account')
      expect(JSON.stringify(result.sidecars)).not.toContain('fixture-item:demo-account')
    }
  })

  it('salts the item commitment per run', async () => {
    const first = await runBrokeredSignInReceiptSmoke()
    const second = await runBrokeredSignInReceiptSmoke()
    expect(first.item_commitment).not.toBe(second.item_commitment)

    const fixed = new Uint8Array(16).fill(7)
    const a = await runBrokeredSignInReceiptSmoke({ itemSalt: fixed })
    const b = await runBrokeredSignInReceiptSmoke({ itemSalt: fixed })
    expect(a.item_commitment).toBe(b.item_commitment)
  })

  it('labels the broker as simulated', async () => {
    const result = await runBrokeredSignInReceiptSmoke()
    expect(result.sidecars[0]!.args).toMatchObject({
      broker_type: 'fixture-broker',
      simulated: true,
    })
    expect(result.caveats.join(' ')).toContain('local fixture')
  })
})
