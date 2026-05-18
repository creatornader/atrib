/**
 * Wycheproof Ed25519 test vectors (§1.4.4).
 *
 * Validates our Ed25519 implementation against the C2SP Wycheproof test suite.
 * Any "invalid" vector accepted is a security defect.
 * Any "valid" vector rejected is a compatibility defect.
 *
 * We fetch the vectors from the C2SP/wycheproof repository at test time.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import * as ed from '@noble/ed25519'
import { sha512 } from '@noble/hashes/sha2.js'
import { hexDecode } from '../src/hash.js'

// Ensure sha512 is configured
ed.hashes.sha512 = sha512

interface WycheproofTestVector {
  tcId: number
  comment: string
  msg: string // hex
  sig: string // hex
  result: 'valid' | 'invalid' | 'acceptable'
}

interface WycheproofTestGroup {
  publicKey: {
    pk: string // hex
  }
  tests: WycheproofTestVector[]
}

interface WycheproofTestFile {
  algorithm: string
  testGroups: WycheproofTestGroup[]
}

let testData: WycheproofTestFile | null = null

beforeAll(async () => {
  const url =
    'https://raw.githubusercontent.com/C2SP/wycheproof/main/testvectors_v1/ed25519_test.json'
  const res = await fetch(url)
  if (!res.ok) {
    console.warn(`Failed to fetch Wycheproof vectors (${res.status}), skipping`)
    return
  }
  testData = (await res.json()) as WycheproofTestFile
})

describe('Wycheproof Ed25519 vectors', () => {
  it('fetched test data successfully', () => {
    // If we couldn't fetch, skip remaining tests but flag it
    if (!testData) {
      console.warn('Wycheproof vectors not available. skipping')
      return
    }
    expect(testData.algorithm).toBe('EDDSA')
    expect(testData.testGroups.length).toBeGreaterThan(0)
  })

  it('passes all valid vectors and rejects all invalid vectors', async () => {
    if (!testData) return

    let validCount = 0
    let invalidCount = 0
    const failures: string[] = []

    for (const group of testData.testGroups) {
      const pk = hexDecode(group.publicKey.pk)

      for (const test of group.tests) {
        const msg = hexDecode(test.msg)
        const sig = hexDecode(test.sig)

        let verified: boolean
        try {
          verified = ed.verify(sig, msg, pk)
        } catch {
          verified = false
        }

        if (test.result === 'valid') {
          validCount++
          if (!verified) {
            failures.push(`tcId=${test.tcId}: expected valid, got rejected. ${test.comment}`)
          }
        } else if (test.result === 'invalid') {
          invalidCount++
          if (verified) {
            failures.push(`tcId=${test.tcId}: expected invalid, got accepted. ${test.comment}`)
          }
        }
        // "acceptable" results: either pass or fail is acceptable
      }
    }

    if (failures.length > 0) {
      throw new Error(`Wycheproof failures (${failures.length}):\n${failures.join('\n')}`)
    }

    expect(validCount).toBeGreaterThan(0)
    expect(invalidCount).toBeGreaterThan(0)
    console.log(`Wycheproof: ${validCount} valid, ${invalidCount} invalid vectors passed`)
  })
})
