// SPDX-License-Identifier: Apache-2.0

/**
 * Payments profile detection conformance corpus (P048).
 *
 * Loads every committed case from spec/conformance/payments-profile/detection/
 * and drives the real detectTransaction() from @atrib/agent. The corpus pins
 * the per-rail hooks of payments profile §2 and the §3 SDK detection
 * contract; the inline vectors in transaction-corpus.test.ts remain the
 * developer-facing companion, this file is the shared cross-implementation
 * contract.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { detectTransaction } from '../src/transaction.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const CORPUS = join(HERE, '../../../spec/conformance/payments-profile/detection')

interface DetectionCase {
  name: string
  corpus: string
  rail: string
  profile_section: string
  description: string
  input: {
    tool_name: string
    response: unknown
    headers?: Record<string, string>
  }
  expected: {
    detected: boolean
    protocol: string | null
    checkout_url?: string
  }
}

interface Manifest {
  corpus: string
  profile_version: string
  rails: string[]
  cases: { file: string; name: string; rail: string }[]
}

const manifest = JSON.parse(readFileSync(join(CORPUS, 'manifest.json'), 'utf8')) as Manifest

describe('payments profile detection conformance: manifest', () => {
  it('pins the six-rail enumeration and every committed case', () => {
    expect(manifest.corpus).toBe('payments-profile/detection')
    expect(manifest.rails).toEqual(['ACP', 'UCP', 'x402', 'MPP', 'AP2', 'a2a-x402'])
    // Every manifest case exists on disk and self-describes.
    for (const entry of manifest.cases) {
      const parsed = JSON.parse(readFileSync(join(CORPUS, entry.file), 'utf8')) as DetectionCase
      expect(parsed.name).toBe(entry.name)
      expect(parsed.rail).toBe(entry.rail)
      expect(parsed.corpus).toBe('payments-profile/detection')
    }
    // Every case file on disk is declared in the manifest.
    const onDisk = readdirSync(join(CORPUS, 'cases')).filter((f: string) => f.endsWith('.json'))
    expect(onDisk.length).toBe(manifest.cases.length)
  })
})

describe('payments profile detection conformance: cases', () => {
  const cases = manifest.cases.map((entry) => {
    const parsed = JSON.parse(readFileSync(join(CORPUS, entry.file), 'utf8')) as DetectionCase
    return [entry.file, parsed] as const
  })

  it.each(cases)('%s', (_file, c) => {
    const result = detectTransaction(c.input.tool_name, c.input.response, c.input.headers)
    expect(result.detected).toBe(c.expected.detected)
    expect(result.protocol).toBe(c.expected.protocol)
    if (c.expected.checkout_url !== undefined) {
      expect(result.checkoutUrl).toBe(c.expected.checkout_url)
    }
  })
})
