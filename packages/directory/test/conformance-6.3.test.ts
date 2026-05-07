// §6.3 verifier conformance corpus reference test.
//
// Replays every case in spec/conformance/6.3/verifier/ against the
// @atrib/directory verifier surface and asserts the boolean matches
// expected.verifies. The corpus is the contract; this test is the
// reference implementation that proves the contract is met by the
// shipped surface.

import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

import {
  verifyLookupProof,
  verifyAuditProof,
} from '../src/index.js'

const CORPUS_ROOT = resolve(__dirname, '../../../spec/conformance/6.3/verifier')
const CASES_DIR = join(CORPUS_ROOT, 'cases')

interface ManifestCase {
  file: string
  name: string
  kind: 'lookup' | 'audit'
}

interface Manifest {
  spec_section: string
  cases: ManifestCase[]
  backend: { vrf_public_key_b64u: string }
}

interface LookupCase {
  kind: 'lookup'
  description: string
  input: {
    vrf_public_key_b64u: string
    root_hash_hex: string
    current_epoch: number
    label: string
    proof_b64u: string
  }
  expected: { verifies: boolean }
}

interface AuditCase {
  kind: 'audit'
  description: string
  input: {
    root_hashes_hex: string[]
    proof_b64u: string
  }
  expected: { verifies: boolean }
}

function b64uToBytes(s: string): Uint8Array {
  const padLen = (4 - (s.length % 4)) % 4
  return new Uint8Array(Buffer.from(s + '='.repeat(padLen), 'base64url'))
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

function loadManifest(): Manifest {
  return JSON.parse(readFileSync(join(CORPUS_ROOT, 'manifest.json'), 'utf8')) as Manifest
}

function loadCase(file: string): LookupCase | AuditCase {
  const path = join(CORPUS_ROOT, file)
  return JSON.parse(readFileSync(path, 'utf8')) as LookupCase | AuditCase
}

describe('§6.3 verifier conformance corpus', () => {
  const manifest = loadManifest()

  it('manifest case count matches case files on disk', () => {
    const filesOnDisk = readdirSync(CASES_DIR).filter(f => f.endsWith('.json')).sort()
    const manifestFiles = manifest.cases.map(c => c.file.replace(/^cases\//, '')).sort()
    expect(filesOnDisk).toEqual(manifestFiles)
  })

  for (const entry of manifest.cases) {
    it(`case: ${entry.name} (${entry.kind})`, async () => {
      const c = loadCase(entry.file)
      expect(c.kind).toBe(entry.kind)

      if (c.kind === 'lookup') {
        const result = verifyLookupProof({
          vrfPublicKey: b64uToBytes(c.input.vrf_public_key_b64u),
          rootHash: hexToBytes(c.input.root_hash_hex),
          currentEpoch: c.input.current_epoch,
          label: c.input.label,
          proof: b64uToBytes(c.input.proof_b64u),
        })
        expect(result).toBe(c.expected.verifies)
      } else {
        // Audit case. Special-case the count-mismatch fixture: passing 1
        // hash for a 2-epoch chain throws on input validation rather than
        // returning false. The expected.verifies=false is honored either
        // way (a thrown error and a false return both mean "verification
        // did not succeed"); this test allows both.
        if (c.input.root_hashes_hex.length === 1 && !c.expected.verifies) {
          let threwOrReturnedFalse = false
          try {
            const r = await verifyAuditProof({
              rootHashes: c.input.root_hashes_hex.map(hexToBytes),
              proof: b64uToBytes(c.input.proof_b64u),
            })
            threwOrReturnedFalse = r === false
          } catch {
            threwOrReturnedFalse = true
          }
          expect(threwOrReturnedFalse).toBe(true)
          return
        }

        const result = await verifyAuditProof({
          rootHashes: c.input.root_hashes_hex.map(hexToBytes),
          proof: b64uToBytes(c.input.proof_b64u),
        })
        expect(result).toBe(c.expected.verifies)
      }
    })
  }
})
